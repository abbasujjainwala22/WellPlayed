import { Popcorn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { toast } from "../../components/ui";
import { api, loadSession } from "../../lib/api";
import { usePlayback } from "../../lib/playback-store";
import { useRoom } from "../../lib/room-context";
import { getSettings, useSettings } from "../../lib/settings";
import type { Panel } from "../panels";
import { ReelyMascot as ReelyDrawing } from "../personality";
import {
  type DraftActions,
  friendlyError,
  NewChatButton,
  ReelyBubble,
  ReelyComposer,
  ReelyControls,
  ReelyDrama,
  ReelyErrorBox,
  type ReelyMessage,
  type ReelyRetry,
  ReelyStarters,
  ReelyTyping,
  useTimedPrompts,
} from "./ReelyChat";
import "./reely.css";

export type { ReelyMessage, Vibe } from "./ReelyChat";

const QUICK: [string, string][] = [
  ["Trivia", "Trivia question"],
  ["Prediction", "Spoiler-free prediction"],
  ["Make a poll", "Make a poll"],
  ["Mini-game", "Mini-game"],
  ["Conversation starter", "Conversation starter"],
  ["Recap the chat", "Recap the chat so far"],
];
export const REELY_HELLO = "Yo, I'm Reely. Your movie nights are about to get questionable. 🍿";

interface ReelyState {
  code: string;
  messages: ReelyMessage[] | null;
  llm: boolean | null;
  busy: boolean;
  error: string;
  retry: ReelyRetry | null;
  spoilerSafe: boolean;
  /** Last time anything happened in this chat, for timed prompts. */
  activity: number;
  set: (p: Partial<ReelyState>) => void;
}

/** Lives outside the component so a half-finished reply survives switching sidebar tabs. */
export const useReely = create<ReelyState>((set) => ({
  code: "",
  messages: null,
  llm: null,
  busy: false,
  error: "",
  retry: null,
  spoilerSafe: getSettings().aiSpoilerSafe,
  activity: 0,
  set: (p) => set(p),
}));

const headers = (code: string) => ({ "x-member-token": loadSession(code)?.token ?? "" });
const base = (code: string) => `/api/rooms/${code}/aihost`;

function load(code: string) {
  api<{ messages: ReelyMessage[]; llm: boolean }>(base(code), { headers: headers(code) })
    .then((d) => useReely.getState().set({ messages: d.messages, llm: d.llm, error: "", retry: null }))
    .catch((e: unknown) => useReely.getState().set({ messages: [], error: friendlyError(e), retry: null }));
}

function useReelySetup() {
  const { room } = useRoom();
  useEffect(() => {
    const st = useReely.getState();
    if (st.code !== room.code)
      st.set({ code: room.code, messages: null, llm: null, error: "", retry: null, spoilerSafe: getSettings().aiSpoilerSafe });
    if (useReely.getState().messages === null) load(room.code);
  }, [room.code]);
}

export function ReelyMascot({ size = 28, float = false }: { size?: number; float?: boolean }) {
  return (
    <span className={`reely-mascot${float ? " float" : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <ReelyDrawing size={Math.round(size * 0.9)} />
    </span>
  );
}

function replaceMessage(m: ReelyMessage) {
  const s = useReely.getState();
  s.set({ messages: (s.messages ?? []).map((x) => (x.id === m.id ? m : x)) });
}

function ReelyPanel() {
  const { room } = useRoom();
  const { messages, llm, busy, error, retry, spoilerSafe, activity, set } = useReely();
  const { reelyVibe: vibe, reelyTimed, reelyEvery } = useSettings();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages?.length || busy) end.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, busy, error]);

  const send = async (raw: string, kind: ReelyRetry["kind"] = "chat") => {
    const t = raw.trim();
    if ((kind === "chat" && !t) || useReely.getState().busy) return;
    set({ busy: true, error: "", retry: null, activity: Date.now() });
    const pb = usePlayback.getState();
    try {
      const d = await api<{ messages: ReelyMessage[]; llm: boolean }>(base(room.code), {
        method: "POST",
        headers: headers(room.code),
        json: { text: t, vibe, spoilerSafe: useReely.getState().spoilerSafe, position: pb.active ? pb.position : null, kind },
      });
      const s = useReely.getState();
      s.set({ messages: [...(s.messages ?? []), ...d.messages], llm: d.llm, activity: Date.now() });
      if (kind === "chat") setText((cur) => (cur.trim() === t ? "" : cur));
    } catch (e) {
      // a failed timed prompt stays quiet; it will try again later
      if (kind === "chat") set({ error: friendlyError(e), retry: { text: t, kind } });
    }
    set({ busy: false });
  };

  const clearChat = async () => {
    if (!window.confirm("Start a new chat? This clears your private Reely messages in this room. The group chat isn't affected.")) return;
    set({ busy: true, error: "", retry: null });
    try {
      await api(base(room.code), { method: "DELETE", headers: headers(room.code) });
      set({ messages: [], activity: Date.now() });
      setText("");
    } catch (e) {
      set({ error: friendlyError(e) });
    }
    set({ busy: false });
  };

  const drafts: DraftActions = {
    share: async (id, edit) => {
      const d = await api<{ message: ReelyMessage }>(`${base(room.code)}/drafts/${encodeURIComponent(id)}/share`, {
        method: "POST",
        headers: headers(room.code),
        json: edit,
      });
      replaceMessage(d.message);
      toast("Poll shared to the room");
    },
    dismiss: async (id) => {
      const d = await api<{ message: ReelyMessage }>(`${base(room.code)}/drafts/${encodeURIComponent(id)}/dismiss`, {
        method: "POST",
        headers: headers(room.code),
      });
      replaceMessage(d.message);
    },
  };

  useTimedPrompts({
    enabled: reelyTimed,
    minutes: reelyEvery,
    ready: !!messages?.some((m) => m.role === "user"),
    idle: !busy && !error && !text.trim(),
    activity,
    fire: () => void send("", "commentary"),
  });

  const empty = messages !== null && messages.length === 0;
  return (
    <div className="reely">
      <div className="reely-head">
        <div className="reely-head-row">
          <ReelyControls
            vibe={vibe}
            setVibe={(v) => useSettings.getState().set({ reelyVibe: v })}
            spoilerSafe={spoilerSafe}
            setSpoilerSafe={(v) => set({ spoilerSafe: v })}
            llm={llm}
          />
          <NewChatButton onClick={() => void clearChat()} disabled={busy || !messages?.length} />
        </div>
        <p className="reely-note">
          Private to you. Reely knows the title, the room chat and (if uploaded) the transcript up to where you are — not what’s on screen.
        </p>
      </div>

      <div className="reely-msgs" aria-live="polite" aria-busy={busy}>
        {messages === null ? (
          <p className="faint">Loading your chat with Reely…</p>
        ) : (
          empty && (
            <>
              <div className="reely-msg">
                <ReelyMascot size={26} />
                <div className="reely-bubble">
                  <span className="reely-who">Reely</span>
                  {REELY_HELLO} Pick a starter, or ask me for trivia, a poll, a spoiler-free prediction or a roast of the plot.
                </div>
              </div>
              <ReelyStarters onSend={(p) => void send(p)} disabled={busy} />
              <ReelyDrama onSend={(p) => void send(p)} disabled={busy} />
            </>
          )
        )}
        {messages?.map((m) => <ReelyBubble key={m.id} m={m} avatar={<ReelyMascot size={26} />} drafts={drafts} />)}
        {busy && <ReelyTyping />}
        <div ref={end} />
      </div>

      {!empty && (
        <div className="reely-chips" aria-label="Quick prompts">
          {QUICK.map(([label, prompt]) => (
            <button key={label} className="chip" disabled={busy} onClick={() => void send(prompt)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <ReelyErrorBox
          error={error}
          busy={busy}
          onRetry={retry ? () => void send(retry.text, retry.kind) : messages === null || !messages.length ? () => load(room.code) : undefined}
        />
      )}
      <ReelyComposer text={text} setText={setText} onSend={(t) => void send(t)} busy={busy} note="Only you can see this chat." />
    </div>
  );
}

export const reelyPanel: Panel = {
  id: "reely",
  title: "Reely",
  icon: Popcorn,
  flush: true,
  description: "Your private AI watch-party host: trivia, polls, games and recaps.",
  component: ReelyPanel,
  useSetup: useReelySetup,
  companion: true,
};
