import { ArrowRight, Gamepad2, MessageCircle, ShieldCheck, Sparkles, Vote } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { type ConvoSummary, generalReely, rememberConversation, savedConversation } from "../features/aihost/general-api";
import {
  friendlyError,
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
} from "../features/aihost/ReelyChat";
import { REELY_HELLO, ReelyMascot } from "../features/aihost/ReelyPanel";
import { type ConvoList, ReelySidebar } from "../features/aihost/ReelySidebar";
import "../features/aihost/reely.css";
import { getSettings, useSettings } from "../lib/settings";

const FEATURES = [
  {
    icon: MessageCircle,
    title: "Private chat",
    text: "Ask about what you’re watching, get trivia, or a recap of the room chat. Only you see your conversation with Reely.",
  },
  {
    icon: Vote,
    title: "Polls",
    text: "Reely drafts spoiler-free polls and predictions. Like one? Edit it and share it to the whole room with one tap.",
  },
  {
    icon: Gamepad2,
    title: "Games",
    text: "Two truths and a lie, guess the next line, emoji movies and conversation starters, on demand.",
  },
  {
    icon: ShieldCheck,
    title: "Spoiler-safe",
    text: "Pick a Quiet, Normal or Chaotic personality and keep spoilers off. Reely never reads ahead of where you are.",
  },
];

/** The marketing content doubles as the empty state of a new chat. */
function Welcome({ onSend, disabled }: { onSend: (t: string) => void; disabled: boolean }) {
  return (
    <div className="reely-welcome">
      <div className="reely-hero">
        <section>
          <span className="eyebrow">
            <Sparkles size={14} /> Reely, your AI watch-party host
          </span>
          <h1>The hype person your group chat deserves.</h1>
          <p className="lede">
            Chat with Reely right here for movie picks, debates and games, no party needed. Inside a room it also knows the title, the room
            chat and, if the host uploaded subtitles, the transcript up to where you are. It never sees your screen.
          </p>
          <p className="reely-speech">{REELY_HELLO}</p>
        </section>
        <ReelyMascot size={200} float />
      </div>

      <ReelyStarters onSend={onSend} disabled={disabled} />
      <ReelyDrama onSend={onSend} disabled={disabled} />

      <div className="features reely-features">
        {FEATURES.map((f) => (
          <article key={f.title} className="feature">
            <div className="ficon">
              <f.icon size={20} />
            </div>
            <h4>{f.title}</h4>
            <p>{f.text}</p>
          </article>
        ))}
      </div>
      <p className="reely-how">
        Start or join a party, then open <strong>Reely</strong> in the room’s sidebar (or on your phone remote) for room-aware chat and polls
        you can share. No AI key on the server? Reely still works in offline mode with built-in trivia, polls and games.
      </p>
      <div className="reely-ctas">
        <Link to="/" className="reely-cta primary">
          Start a party with Reely <ArrowRight size={18} />
        </Link>
      </div>
    </div>
  );
}

export function ReelyAI() {
  const { reelyVibe: vibe, reelyTimed, reelyEvery } = useSettings();
  const [spoilerSafe, setSpoilerSafe] = useState(() => getSettings().aiSpoilerSafe);
  const [list, setList] = useState<ConvoList>({ items: [], more: false, loading: true, error: "" });
  const [current, setCurrent] = useState<string | null>(null);
  const [messages, setMessages] = useState<ReelyMessage[] | null>(null);
  const [llm, setLlm] = useState<boolean | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<ReelyRetry | null>(null);
  const [activity, setActivity] = useState(0);
  const lock = useRef(false);
  const currentRef = useRef(current);
  currentRef.current = current;
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = "Reely · WellPlayed";
    return () => void (document.title = "WellPlayed: watch anything together");
  }, []);

  const loadList = useCallback(async (offset = 0) => {
    setList((l) => ({ ...l, loading: true, error: "" }));
    try {
      const d = await generalReely.list(offset);
      setLlm(d.llm);
      setList((l) => ({ items: offset ? [...l.items, ...d.items] : d.items, more: d.more, loading: false, error: "" }));
    } catch (e) {
      setList((l) => ({ ...l, loading: false, error: friendlyError(e) }));
    }
  }, []);

  const open = useCallback(async (id: string | null) => {
    setError("");
    setRetry(null);
    setText("");
    setCurrent(id);
    rememberConversation(id);
    if (!id) return setMessages([]);
    setMessages(null);
    try {
      const d = await generalReely.get(id);
      if (currentRef.current !== id) return;
      setMessages(d.messages);
      setLlm(d.llm);
      setActivity(Date.now());
    } catch {
      // gone (deleted elsewhere, or another device's id): fall back to a fresh chat
      if (currentRef.current !== id) return;
      setCurrent(null);
      rememberConversation(null);
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void open(savedConversation());
  }, [loadList, open]);

  useEffect(() => {
    if (messages?.length) end.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, busy, error]);

  const send = async (raw: string, kind: ReelyRetry["kind"] = "chat") => {
    const t = raw.trim();
    if ((kind === "chat" && !t) || lock.current || messages === null) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setRetry(null);
    const convo = currentRef.current;
    try {
      const d = await generalReely.chat({ conversationId: convo, text: t, vibe, spoilerSafe, kind });
      if (currentRef.current === convo) {
        setMessages((m) => [...(m ?? []), ...d.messages].slice(-40));
        setCurrent(d.conversation.id);
        rememberConversation(d.conversation.id);
        if (kind === "chat") setText((cur) => (cur.trim() === t ? "" : cur));
      }
      setLlm(d.llm);
      setActivity(Date.now());
      setList((l) => ({ ...l, items: [d.conversation, ...l.items.filter((c) => c.id !== d.conversation.id)] }));
    } catch (e) {
      if (kind === "chat") {
        setError(friendlyError(e));
        setRetry({ text: t, kind });
      }
    }
    lock.current = false;
    setBusy(false);
  };

  const remove = async (c: ConvoSummary) => {
    if (!window.confirm(`Delete “${c.title}”? This can't be undone.`)) return;
    try {
      await generalReely.remove(c.id);
      setList((l) => ({ ...l, items: l.items.filter((x) => x.id !== c.id) }));
      if (c.id === currentRef.current) void open(null);
    } catch (e) {
      setError(friendlyError(e));
    }
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
    <div className="reely-app">
      <ReelySidebar
        list={list}
        current={current}
        onSelect={(id) => void open(id)}
        onNew={() => void open(null)}
        onDelete={(c) => void remove(c)}
        onMore={() => void loadList(list.items.length)}
        onRetry={() => void loadList()}
        disabled={busy}
      />
      <section className="reely reely-main" aria-label="Chat with Reely">
        <div className="reely-head">
          <ReelyControls vibe={vibe} setVibe={(v) => useSettings.getState().set({ reelyVibe: v })} spoilerSafe={spoilerSafe} setSpoilerSafe={setSpoilerSafe} llm={llm} />
        </div>
        <div className="reely-msgs" aria-live="polite" aria-busy={busy}>
          {messages === null ? <p className="faint">Loading your chat with Reely…</p> : empty && <Welcome onSend={(p) => void send(p)} disabled={busy} />}
          {messages?.map((m) => <ReelyBubble key={m.id} m={m} avatar={<ReelyMascot size={26} />} />)}
          {busy && <ReelyTyping />}
          <div ref={end} />
        </div>
        {error && <ReelyErrorBox error={error} busy={busy} onRetry={retry ? () => void send(retry.text, retry.kind) : undefined} />}
        <ReelyComposer
          text={text}
          setText={setText}
          onSend={(t) => void send(t)}
          busy={busy}
          disabled={messages === null}
          placeholder="Bring a title. Or an extremely bad opinion."
          note="AI can get facts wrong. No room, camera or screen access here. Keeps the last 40 messages per chat."
        />
      </section>
    </div>
  );
}
