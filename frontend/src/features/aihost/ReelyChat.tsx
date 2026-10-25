/** Reely chat building blocks shared by the in-room panel and the general /ai page. */
import {
  Check,
  Clock,
  Copy,
  Flame,
  Gamepad2,
  MessagesSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SendHorizontal,
  Shuffle,
  Vote,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { toast } from "../../components/ui";
import { ApiError } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { type ReelyVibe, REELY_INTERVALS, useSettings } from "../../lib/settings";

export type Vibe = ReelyVibe;

export interface ReelyPoll {
  question: string;
  options: string[];
  shared: boolean;
  dismissed: boolean;
}

export interface ReelyMessage {
  id: string;
  role: "user" | "reely";
  text: string;
  source: "offline" | "llm" | null;
  ts: number;
  kind?: "chat" | "commentary";
  poll: ReelyPoll | null;
}

/** What to resend when the user hits Retry. */
export interface ReelyRetry {
  text: string;
  kind: "chat" | "commentary";
}

export const MAX_TEXT = 500;
export const VIBES: [Vibe, string][] = [
  ["quiet", "Quiet"],
  ["normal", "Normal"],
  ["chaotic", "Chaotic"],
];
const Q_MAX = 140;
const OPT_MAX = 60;
const OPT_MIN = 2;
const OPT_LIMIT = 6;

/** Friendly copy for anything that went wrong talking to Reely. The server already words its own errors. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.message && !/^Request failed/.test(e.message)) return e.message;
    if (e.status === 401 || e.status === 403) return "Your room session has expired. Rejoin the room to keep chatting with Reely.";
    if (e.status === 429) return "Reely needs a breather. Try again in a minute.";
    if (e.status === 504 || e.status === 408) return "Reely took too long to answer. Your message is still here, so try again.";
    if (e.status >= 500) return "Reely is having a moment. Try again shortly.";
    return e.message;
  }
  if (e instanceof TypeError) return "Couldn't reach WellPlayed. Check your connection and retry.";
  return e instanceof Error && e.message ? e.message : "Something went wrong. Try again.";
}

/* ───────── Poll draft ───────── */

function checkPoll(question: string, options: string[]): string {
  const q = question.trim();
  const opts = options.map((o) => o.trim());
  if (q.length < 3 || q.length > Q_MAX) return `The question needs 3-${Q_MAX} characters.`;
  if (opts.length < OPT_MIN || opts.length > OPT_LIMIT) return `Polls need ${OPT_MIN} to ${OPT_LIMIT} answers.`;
  if (opts.some((o) => !o)) return "Answers can't be empty.";
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return "Answers must all be different.";
  return "";
}

export interface DraftActions {
  /** Publish to the room, with the (possibly edited) text. Rejects with a readable error. */
  share: (id: string, edit: { question: string; options: string[] }) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

function PollDraft({ id, poll, actions }: { id: string; poll: ReelyPoll; actions?: DraftActions }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(poll.question);
  const [options, setOptions] = useState(poll.options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (poll.dismissed) return <p className="reely-poll-note">Poll draft dismissed.</p>;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setEditing(false);
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  };

  const share = () => {
    const problem = checkPoll(question, options);
    if (problem) return setError(problem);
    void run(() => actions!.share(id, { question: question.trim(), options: options.map((o) => o.trim()) }));
  };

  const copyPoll = async () => {
    const ok = await copyText(`${poll.question}\n${poll.options.map((o) => `• ${o}`).join("\n")}`);
    toast(ok ? "Poll copied" : "Copy unavailable. Select the text to copy it.", ok ? "success" : "error");
  };

  const live = poll.shared;
  return (
    <div className={`reely-poll${live ? " live" : ""}`}>
      <span className="reely-poll-kicker">
        {live ? "Live in the room" : !actions ? "Poll draft" : editing ? "Edit before sharing" : "Poll draft"}
      </span>
      {editing ? (
        <div className="reely-poll-edit">
          <input aria-label="Poll question" value={question} maxLength={Q_MAX} disabled={busy} onChange={(e) => setQuestion(e.target.value)} />
          {options.map((o, i) => (
            <div key={i} className="reely-poll-opt">
              <input
                aria-label={`Answer ${i + 1}`}
                value={o}
                maxLength={OPT_MAX}
                disabled={busy}
                onChange={(e) => setOptions((all) => all.map((x, n) => (n === i ? e.target.value : x)))}
              />
              <button
                type="button"
                className="ghost icon sm"
                aria-label={`Remove answer ${i + 1}`}
                disabled={busy || options.length <= OPT_MIN}
                onClick={() => setOptions((all) => all.filter((_, n) => n !== i))}
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {options.length < OPT_LIMIT && (
            <button type="button" className="ghost sm" disabled={busy} onClick={() => setOptions((all) => [...all, ""])}>
              <Plus size={14} /> Add answer
            </button>
          )}
        </div>
      ) : (
        <>
          <strong>{poll.question}</strong>
          <ul>
            {poll.options.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </>
      )}
      {!actions ? (
        <div className="reely-poll-actions">
          <button type="button" className="sm" onClick={() => void copyPoll()}>
            <Copy size={14} /> Copy poll
          </button>
          <span className="reely-poll-note">Polls go live from Reely inside a party.</span>
        </div>
      ) : live ? (
        <span className="reely-poll-note">
          <Check size={13} /> Shared to the room
        </span>
      ) : (
        <div className="reely-poll-actions">
          <button type="button" className="primary sm" disabled={busy} onClick={share}>
            <Vote size={14} /> {busy ? "Sharing…" : "Share to room"}
          </button>
          {editing ? (
            <button
              type="button"
              className="ghost sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setQuestion(poll.question);
                setOptions(poll.options);
                setError("");
              }}
            >
              Cancel
            </button>
          ) : (
            <button type="button" className="ghost sm" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil size={13} /> Edit
            </button>
          )}
          {!editing && (
            <button type="button" className="ghost sm" disabled={busy} onClick={() => void run(() => actions.dismiss(id))}>
              <X size={14} /> Dismiss
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="reely-poll-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ───────── Messages ───────── */

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ghost sm reely-act"
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        } else toast("Copy unavailable. Select the text to copy it.", "error");
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : "Copy"}
    </button>
  );
}

export function ReelyBubble({ m, avatar, drafts }: { m: ReelyMessage; avatar: ReactNode; drafts?: DraftActions }) {
  const mine = m.role === "user";
  return (
    <div className={`reely-msg${mine ? " mine" : ""}`}>
      {!mine && avatar}
      <div className="reely-bubble">
        {!mine && (
          <span className="reely-who">
            Reely
            {m.kind === "commentary" && (
              <span className="reely-tag">
                <Clock size={10} /> Timed prompt
              </span>
            )}
          </span>
        )}
        {m.text}
        {m.poll && <PollDraft id={m.id} poll={m.poll} actions={drafts} />}
        {!mine && (
          <div className="reely-acts">
            <CopyButton text={m.text} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ReelyTyping() {
  return (
    <div className="reely-cooking" role="status">
      <span aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      Reely is cooking…
    </div>
  );
}

export function ReelyErrorBox({ error, onRetry, busy }: { error: string; onRetry?: () => void; busy: boolean }) {
  return (
    <div className="reely-error" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button type="button" className="sm" disabled={busy} onClick={onRetry}>
          <RotateCcw size={13} /> Retry
        </button>
      )}
    </div>
  );
}

/* ───────── Empty state: starters + daily drama ───────── */

const STARTERS = [
  {
    icon: Flame,
    title: "Roast the plot",
    caption: "That decision belongs in court.",
    prompt: "Roast a fictional plot decision for me. Ask me for the title and the decision first, no spoilers.",
  },
  {
    icon: MessagesSquare,
    title: "Start a debate",
    caption: "Villain, or just misunderstood?",
    prompt: "Start an unnecessary but spoiler-free movie debate, with a poll so we can pick sides.",
  },
  {
    icon: Vote,
    title: "Prediction poll",
    caption: "Call it before it happens.",
    prompt: "Draft a spoiler-safe prediction poll. Ask what we're watching and how far in, unless you already know.",
  },
  {
    icon: Zap,
    title: "Hot takes",
    caption: "Put my favourite genre on trial.",
    prompt: "Give me a playful movie hot take. Ask me for a genre if you need one.",
  },
  {
    icon: Search,
    title: "Cast Detective",
    caption: "That actor. From that thing.",
    prompt: "Cast Detective: help me figure out an actor. Ask me for a title, character or description, and only state facts you're sure of.",
  },
  {
    icon: Gamepad2,
    title: "Mini-game",
    caption: "Who's actually paying attention?",
    prompt: "Start a quick spoiler-free movie mini-game. Explain the rules and wait for my answer.",
  },
];

const DRAMA = [
  "If the villain explains their entire plan, why does nobody simply leave?",
  "Which fictional character would be banned from your family group chat?",
  "What movie opinion would get you kicked out of this friend group?",
  "Which film plot only exists because one person made a terrible decision?",
  "Is it rude to check your phone during a movie someone else picked?",
  "Who is the most overrated sidekick in movie history?",
  "Should the person who picks the movie also have to bring the snacks?",
  "Is any movie allowed to be longer than two and a half hours?",
];

export function ReelyStarters({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  return (
    <div className="reely-starters">
      {STARTERS.map(({ icon: Icon, title, caption, prompt }) => (
        <button key={title} type="button" className="reely-starter" disabled={disabled} onClick={() => onSend(prompt)}>
          <Icon size={16} aria-hidden="true" />
          <strong>{title}</strong>
          <span>{caption}</span>
        </button>
      ))}
    </div>
  );
}

export function ReelyDrama({ onSend, disabled }: { onSend: (text: string) => void; disabled: boolean }) {
  const [index, setIndex] = useState(() => Math.floor(Date.now() / 86_400_000) % DRAMA.length);
  const q = DRAMA[index];
  return (
    <section className="reely-drama" aria-label="Today's Unnecessary Drama">
      <div className="reely-drama-head">
        <span className="reely-poll-kicker">Today’s Unnecessary Drama</span>
        <button type="button" className="ghost sm" disabled={disabled} onClick={() => setIndex((i) => (i + 1) % DRAMA.length)}>
          <Shuffle size={13} /> Another
        </button>
      </div>
      <button type="button" className="reely-drama-q" disabled={disabled} onClick={() => onSend(`Today's Unnecessary Drama, spoiler-free: ${q}`)}>
        {q}
      </button>
    </section>
  );
}

/* ───────── Controls ───────── */

export function ReelyControls({
  vibe,
  setVibe,
  spoilerSafe,
  setSpoilerSafe,
  llm,
}: {
  vibe: Vibe;
  setVibe: (v: Vibe) => void;
  spoilerSafe: boolean;
  setSpoilerSafe: (v: boolean) => void;
  llm: boolean | null;
}) {
  const { reelyTimed, reelyEvery, set } = useSettings();
  return (
    <div className="reely-controls">
      <div className="reely-vibes" role="radiogroup" aria-label="Reely's personality">
        {VIBES.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={vibe === v} onClick={() => setVibe(v)}>
            {label}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={spoilerSafe} onChange={(e) => setSpoilerSafe(e.target.checked)} />
        Spoiler-safe
      </label>
      <label className="reely-timed" title="Reely drops an occasional prompt after your first message, only while this chat is visible.">
        <Clock size={13} aria-hidden="true" />
        <select
          aria-label="Timed prompts"
          value={reelyTimed ? String(reelyEvery) : "off"}
          onChange={(e) => (e.target.value === "off" ? set({ reelyTimed: false }) : set({ reelyTimed: true, reelyEvery: Number(e.target.value) }))}
        >
          <option value="off">Timed prompts off</option>
          {REELY_INTERVALS.map((n) => (
            <option key={n} value={n}>
              Every {n} min
            </option>
          ))}
        </select>
      </label>
      {llm === false && (
        <span className="reely-offline" title="No AI key is configured on this server, so Reely runs on built-in prompts.">
          <WifiOff size={11} /> Offline mode
        </span>
      )}
    </div>
  );
}

export function ReelyComposer({
  text,
  setText,
  onSend,
  busy,
  disabled,
  note,
  placeholder = "Say something to Reely…",
}: {
  text: string;
  setText: (t: string) => void;
  onSend: (t: string) => void;
  busy: boolean;
  disabled?: boolean;
  note: ReactNode;
  placeholder?: string;
}) {
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend(text);
      }}
    >
      <div className="box">
        <input placeholder={placeholder} aria-label="Message Reely" value={text} maxLength={MAX_TEXT} disabled={disabled} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="primary icon sm" aria-label="Send to Reely" disabled={busy || disabled || !text.trim()}>
          <SendHorizontal size={16} />
        </button>
      </div>
      <div className="faint">
        <span>{note}</span>
        {text.length > MAX_TEXT - 100 && <span>{MAX_TEXT - text.length} left</span>}
      </div>
    </form>
  );
}

export function NewChatButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="ghost sm" onClick={onClick} disabled={disabled}>
      <Plus size={13} /> New chat
    </button>
  );
}

/* ───────── Timed prompts ───────── */

/**
 * Opt-in timed commentary. Fires `fire` after `minutes` of quiet, only when `ready` (the user has
 * sent a message), the tab is visible and nothing is in flight. Hidden time doesn't count.
 */
export function useTimedPrompts(opts: { enabled: boolean; minutes: number; ready: boolean; idle: boolean; activity: number; fire: () => void }) {
  const latest = useRef(opts);
  latest.current = opts;
  const last = useRef(Date.now());

  useEffect(() => {
    last.current = Math.max(last.current, opts.activity);
  }, [opts.activity]);

  useEffect(() => {
    if (!opts.enabled) return;
    last.current = Date.now();
    const onVisible = () => {
      if (document.visibilityState === "visible") last.current = Date.now();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      const o = latest.current;
      if (document.visibilityState !== "visible" || !o.ready || !o.idle) return;
      if (Date.now() - last.current < o.minutes * 60_000) return;
      last.current = Date.now();
      o.fire();
    }, 15_000);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [opts.enabled, opts.minutes]);
}
