import { ArrowDown, Info, Languages, LoaderCircle, MessageSquare, RotateCcw, SendHorizontal, Smile, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";

import { Avatar, colorFor } from "../../components/ui";
import { LANGUAGES } from "../../lib/api";
import { uid } from "../../lib/clipboard";
import { useRoom } from "../../lib/room-context";
import { getSettings } from "../../lib/settings";
import type { RoomSocket } from "../../lib/socket";
import { playBlip } from "../../lib/sound";
import type { Panel } from "../panels";
import "./chat.css";
import { ChatPicker, type PickerTab } from "./ChatPicker";
import { isChatMedia, useGiphyEnabled, type ChatMedia, type GiphyItem } from "./giphy";
import { MediaMessage } from "./MediaMessage";

export interface ChatMessage {
  id: string;
  kind: "user" | "system";
  from: string;
  name: string;
  text: string;
  lang: string;
  translations: Record<string, string>;
  mediaTime: number;
  /** A GIF or sticker; `text` is then only a plain fallback. */
  media?: ChatMedia;
  /** The sender's own id for this send, echoed back so their device can match it. */
  cid?: string;
}

/** A message this device sent that the server hasn't echoed back yet. */
export interface PendingSend {
  cid: string;
  text: string;
  media?: GiphyItem;
  /** waiting = the socket is down, it goes out when we reconnect. */
  status: "sending" | "waiting" | "failed";
  error?: string;
}

interface ChatStore {
  messages: ChatMessage[];
  pending: PendingSend[];
  add: (m: ChatMessage[]) => void;
  reset: () => void;
}

export const useChat = create<ChatStore>((set) => ({
  messages: [],
  pending: [],
  add: (m) => set((s) => ({ messages: [...s.messages, ...m].slice(-300) })),
  reset: () => set({ messages: [] }),
}));

/* ───────── Sending, with an inline failure state instead of losing the draft ───────── */

const ACK_TIMEOUT_MS = 10_000;
const timers = new Map<string, number>();

const patch = (cid: string, p: Partial<PendingSend>) =>
  useChat.setState((s) => ({ pending: s.pending.map((x) => (x.cid === cid ? { ...x, ...p } : x)) }));

function settle(cid: string): void {
  window.clearTimeout(timers.get(cid));
  timers.delete(cid);
  useChat.setState((s) => ({ pending: s.pending.filter((x) => x.cid !== cid) }));
}

function fail(cid: string, error: string): void {
  window.clearTimeout(timers.get(cid));
  timers.delete(cid);
  patch(cid, { status: "failed", error });
}

function transmit(socket: RoomSocket, p: PendingSend): void {
  window.clearTimeout(timers.get(p.cid));
  if (!socket.connected) return patch(p.cid, { status: "waiting", error: undefined });
  patch(p.cid, { status: "sending", error: undefined });
  socket.send(
    "chat:send",
    p.media ? { cid: p.cid, media: { provider: "giphy", kind: p.media.kind, id: p.media.id } } : { cid: p.cid, text: p.text },
  );
  timers.set(p.cid, window.setTimeout(() => fail(p.cid, "No reply from the server. Check your connection."), ACK_TIMEOUT_MS));
}

function sendChat(socket: RoomSocket, input: { text?: string; media?: GiphyItem }): void {
  const p: PendingSend = { cid: uid().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32), text: input.text ?? "", media: input.media, status: "sending" };
  useChat.setState((s) => ({ pending: [...s.pending, p] }));
  transmit(socket, p);
}

function retry(socket: RoomSocket, cid: string): void {
  const p = useChat.getState().pending.find((x) => x.cid === cid);
  if (p) transmit(socket, p);
}

let chatSocket: RoomSocket | null = null; // whose messages the store holds

function useChatSetup() {
  const { socket, me } = useRoom();
  const meId = useRef(me.id);
  useEffect(() => void (meId.current = me.id), [me.id]);
  useEffect(() => {
    // Clear only for a different room/socket: StrictMode re-runs this effect, and the history that
    // arrived before the first run has already been handed over and won't be replayed.
    if (chatSocket !== socket) useChat.setState({ messages: [], pending: [] });
    chatSocket = socket;
    const offs = [
      socket.on("chat:history", (d: { messages: ChatMessage[] }) => {
        useChat.getState().reset();
        useChat.getState().add(d.messages);
        // anything we sent that made it before a reconnect is no longer pending
        const delivered = new Set(d.messages.map((m) => m.cid).filter(Boolean));
        useChat.getState().pending.forEach((p) => delivered.has(p.cid) && settle(p.cid));
      }),
      socket.on("chat:message", (m: ChatMessage) => {
        useChat.getState().add([m]);
        if (m.cid && m.from === meId.current) settle(m.cid);
        if (m.kind === "user" && m.from !== meId.current && getSettings().chatSound) playBlip();
      }),
      socket.on("error", (e: { message: string; cid?: string | null }) => {
        if (e.cid) return fail(e.cid, e.message); // shown on the message itself, with Retry send
        useChat.getState().add([{ id: uid(), kind: "system", from: "", name: "WellPlayed", text: e.message, lang: "en", translations: {}, mediaTime: 0 }]);
      }),
      socket.on("_connected", (up: boolean) => {
        for (const p of useChat.getState().pending) {
          if (up && p.status === "waiting") transmit(socket, p);
          else if (!up && p.status === "sending") fail(p.cid, "Connection lost before this was sent.");
        }
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [socket]);
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const NEAR_BOTTOM_PX = 80;

const asMedia = (item: GiphyItem): ChatMedia => ({
  provider: "giphy",
  kind: item.kind,
  id: item.id,
  title: item.title,
  w: item.w,
  h: item.h,
  url: item.url,
  still: item.still,
});

function ChatPanel() {
  const { socket, me, connected } = useRoom();
  const messages = useChat((s) => s.messages);
  const pending = useChat((s) => s.pending);
  const gifs = useGiphyEnabled();
  const [text, setText] = useState("");
  const [showing, setShowing] = useState<Set<string>>(new Set());
  const [picker, setPicker] = useState<PickerTab | null>(null);
  const [unseen, setUnseen] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<[number, number] | null>(null);
  const stuck = useRef(true); // the reader is at (or near) the newest message

  /* ── stick to the bottom only when the reader is already there ── */
  const toBottom = () => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
    stuck.current = true;
    setUnseen(0);
  };
  const onScroll = () => {
    const el = log.current;
    if (!el) return;
    stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (stuck.current) setUnseen(0);
  };
  useLayoutEffect(toBottom, []);
  const last = messages[messages.length - 1];
  const prevPending = useRef(pending.length);
  useLayoutEffect(() => {
    const sentNow = pending.length > prevPending.current;
    prevPending.current = pending.length;
    if (!last && !sentNow) return;
    if (stuck.current || sentNow || last?.from === me.id) toBottom();
    else if (last && last.kind === "user") setUnseen((n) => n + 1);
  }, [last?.id, pending.length]); // only on a new newest message or a new local send
  const states = pending.map((p) => p.status).join();
  useLayoutEffect(() => {
    if (stuck.current) toBottom(); // a send failing grows its bubble; keep it in view
  }, [states]);

  /* ── composer ── */
  const send = () => {
    if (!text.trim()) return;
    sendChat(socket, { text });
    setText("");
    caret.current = null;
  };
  const insertEmoji = (emoji: string) => {
    const el = input.current;
    const focused = el && document.activeElement === el;
    const [a, b] = focused ? [el.selectionStart ?? text.length, el.selectionEnd ?? text.length] : (caret.current ?? [text.length, text.length]);
    const next = text.slice(0, a) + emoji + text.slice(b);
    if (next.length > 500) return;
    setText(next);
    const at = a + emoji.length;
    caret.current = [at, at];
    requestAnimationFrame(() => el?.setSelectionRange(at, at));
  };
  const sendMedia = (item: GiphyItem) => {
    sendChat(socket, { media: item });
    setPicker(null);
    input.current?.focus();
  };
  const closePicker = useCallback((refocus: boolean) => {
    setPicker(null);
    if (refocus) input.current?.focus();
  }, []);
  const togglePicker = (t: PickerTab) => setPicker((open) => (open === t || (open && t === "gif" && open === "sticker") ? null : t));

  const toggle = (id: string) =>
    setShowing((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const lastFromMe = last?.kind === "user" && last.from === me.id;

  return (
    <div className="chat">
      <div className="chat-log">
        <div className="messages" ref={log} onScroll={onScroll}>
          {messages.length === 0 && pending.length === 0 && (
            <div className="empty">
              <MessageSquare size={28} />
              <strong>No messages yet</strong>
              <span>Say hi! Write in {LANGUAGES[me.language] ?? "your language"} and everyone reads it in theirs.</span>
            </div>
          )}
          {messages.map((m, i) => {
            if (m.kind === "system")
              return (
                <div key={m.id} className="msg system">
                  <span className="pill">
                    <Info size={13} /> {m.text}
                  </span>
                </div>
              );
            const media = isChatMedia(m.media) ? m.media : null;
            const translated = !media && m.from !== me.id ? m.translations[me.language] : undefined;
            const original = showing.has(m.id);
            const shown = translated && !original ? translated : m.text;
            const prev = messages[i - 1];
            const grouped = prev && prev.kind === "user" && prev.from === m.from;
            return (
              <div key={m.id} className={`msg ${grouped ? "grouped" : ""} ${m.from === me.id ? "mine" : ""}`}>
                <Avatar id={m.from} name={m.name} size={30} />
                <div className="body">
                  {!grouped && (
                    <div className="meta">
                      <strong style={m.from === me.id ? undefined : { color: colorFor(m.from) }}>{m.from === me.id ? "You" : m.name}</strong>
                      {m.mediaTime > 0 && <span className="faint">at {fmt(m.mediaTime)}</span>}
                    </div>
                  )}
                  {media ? <MediaMessage media={media} /> : <div className="text">{shown}</div>}
                  {translated && (
                    <div className="translated">
                      <Languages size={12} />
                      {original ? `Original (${LANGUAGES[m.lang] ?? m.lang})` : `Translated from ${LANGUAGES[m.lang] ?? m.lang}`} ·
                      <button className="link" onClick={() => toggle(m.id)}>
                        {original ? "Show translation" : "Show original"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {pending.map((p, i) => {
            const grouped = i > 0 || lastFromMe;
            return (
              <div key={p.cid} className={`msg mine pending ${p.status} ${grouped ? "grouped" : ""}`}>
                <Avatar id={me.id} name={me.name} size={30} />
                <div className="body">
                  {!grouped && (
                    <div className="meta">
                      <strong>You</strong>
                    </div>
                  )}
                  {p.media ? <MediaMessage media={asMedia(p.media)} /> : <div className="text">{p.text}</div>}
                  <div className={`send-state ${p.status}`} role={p.status === "failed" ? "alert" : "status"}>
                    {p.status === "failed" ? (
                      <>
                        <span>Not sent. {p.error}</span>
                        <button type="button" className="link" onClick={() => retry(socket, p.cid)}>
                          <RotateCcw size={12} /> Retry send
                        </button>
                        <button type="button" className="link muted" aria-label="Discard this message" onClick={() => settle(p.cid)}>
                          <X size={12} /> Discard
                        </button>
                      </>
                    ) : p.status === "waiting" ? (
                      <>
                        <WifiOff size={12} /> Waiting for connection…
                      </>
                    ) : (
                      <>
                        <LoaderCircle size={12} className="spin" /> Sending…
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {unseen > 0 && (
          <button type="button" className="chat-jump" onClick={toBottom} aria-label={`${unseen} new ${unseen === 1 ? "message" : "messages"}. Jump to latest`}>
            New messages <ArrowDown size={14} />
          </button>
        )}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        {picker && <ChatPicker tab={picker} onTab={setPicker} gifs={gifs} onEmoji={insertEmoji} onMedia={sendMedia} onClose={closePicker} />}
        <div className="box">
          <input
            ref={input}
            placeholder="Message the room…"
            aria-label="Chat message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onSelect={(e) => (caret.current = [e.currentTarget.selectionStart ?? 0, e.currentTarget.selectionEnd ?? 0])}
            onKeyDown={(e) => e.key === "Escape" && picker && (e.preventDefault(), closePicker(true))}
            maxLength={500}
          />
          <button
            type="button"
            className={`ghost icon sm ${picker === "emoji" ? "on" : ""}`}
            data-picker-launcher
            aria-label="Emoji"
            title="Emoji"
            aria-haspopup="dialog"
            aria-expanded={picker === "emoji"}
            onClick={() => togglePicker("emoji")}
          >
            <Smile size={17} />
          </button>
          {gifs && (
            <button
              type="button"
              className={`ghost sm chat-gif-btn ${picker === "gif" || picker === "sticker" ? "on" : ""}`}
              data-picker-launcher
              aria-label="GIFs and stickers"
              title="GIFs and stickers"
              aria-haspopup="dialog"
              aria-expanded={picker === "gif" || picker === "sticker"}
              onClick={() => togglePicker("gif")}
            >
              GIF
            </button>
          )}
          <button type="submit" className="primary icon sm" aria-label="Send" disabled={!text.trim()}>
            <SendHorizontal size={16} />
          </button>
        </div>
        <div className="faint">
          {connected ? (
            <>
              <Languages size={12} /> Auto-translated for everyone
            </>
          ) : (
            <span className="offline">
              <WifiOff size={12} /> Reconnecting… messages send when you're back online
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

export const chatPanel: Panel = { id: "chat", title: "Chat", icon: MessageSquare, flush: true, description: "Write in your language. Everyone reads it in theirs.", component: ChatPanel, useSetup: useChatSetup, companion: true };
