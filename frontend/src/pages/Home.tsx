import {
  ArrowRight,
  CheckCircle2,
  Coffee,
  Globe2,
  HeartPulse,
  History,
  LogIn,
  Smartphone,
  Sparkles,
  Vote,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { PartyBackdrop, ReelyAside } from "../features/personality";
import { api, errorText, LANGUAGES, preferredLanguage, saveSession } from "../lib/api";
import { parseInviteCode } from "../lib/invite";
import { MODE_ORDER, MODES } from "../lib/modes";
import { addRecent, getRecent, type RecentRoom } from "../lib/settings";
import type { Mode, Session } from "../lib/types";
import "./home.css";

const FEATURES = [
  { icon: Zap, title: "Frame-accurate sync", text: "One authoritative timeline keeps every screen within milliseconds, and drift is corrected quietly in the background." },
  { icon: Coffee, title: "Breaks without the chaos", text: "Ask for a break instead of pausing everyone. The host approves, and a countdown brings the room back." },
  { icon: Globe2, title: "Everyone’s own language", text: "Chat is translated for each reader, and every viewer picks their own subtitle language and size." },
  { icon: Smartphone, title: "Your phone is the remote", text: "Scan a QR code to chat, react and vote from your phone, so the big screen stays clean." },
  { icon: HeartPulse, title: "“Are you still human?”", text: "Opt-in, on-device posture and blink nudges, plus a stretch break before the next episode." },
  { icon: Vote, title: "Polls, quizzes, reactions", text: "Predictions, quiz breaks and a reaction heatmap show where the room laughed, cheered or gasped." },
];

const STEPS = [
  { title: "Start a party", text: "Pick a mode and name your room. You’re the host, and nobody needs an account." },
  { title: "Share the invite", text: "Send the link, the six-letter code or a QR code. Friends join with just a name." },
  { title: "Watch in sync", text: "Load a video and press play. Everyone stays in step, chatting in their own language." },
];

const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function when(at: number): string {
  const mins = Math.round((at - Date.now()) / 60000);
  if (mins > -1) return "just now";
  if (mins > -60) return ago.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours > -24) return ago.format(hours, "hour");
  return ago.format(Math.round(hours / 24), "day");
}

function RecentRooms() {
  const [recent, setRecent] = useState<RecentRoom[]>([]);
  useEffect(() => setRecent(getRecent()), []);
  return (
    <section className="section home-block" aria-labelledby="recent-h">
      <div className="home-block-head">
        <h2 id="recent-h">Recent rooms</h2>
        <span className="faint">On this device</span>
      </div>
      {recent.length === 0 ? (
        <div className="recent-empty">
          <History size={24} />
          <strong>No rooms yet</strong>
          <span>Parties you start or join on this device will show up here, so you can hop back in.</span>
        </div>
      ) : (
        <ul className="recent-grid">
          {recent.map((r) => {
            const m = MODES[r.mode] ?? MODES.movie;
            return (
              <li key={r.code}>
                <Link to={`/room/${r.code}`} className="recent-card">
                  <span className="recent-icon">
                    <m.icon size={18} />
                  </span>
                  <span className="grow">
                    <strong className="truncate">{r.name}</strong>
                    <span className="faint">
                      {m.label} · <span className="mono">{r.code}</span> · {when(r.at)}
                    </span>
                  </span>
                  <ArrowRight size={16} className="recent-go" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="section home-block" aria-labelledby="how-h">
      <div className="home-block-head">
        <h2 id="how-h">How it works</h2>
      </div>
      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span className="how-num">{String(i + 1).padStart(2, "0")}</span>
            <h4>{s.title}</h4>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Home() {
  const nav = useNavigate();
  // links elsewhere (e.g. Discover's "Let the group decide") can preselect a mode with /?mode=movie
  const [params] = useSearchParams();
  const linkedMode = MODE_ORDER.find((m) => m === params.get("mode"));
  const startCard = useRef<HTMLElement>(null);
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [mode, setMode] = useState<Mode>(linkedMode ?? "movie");
  const [language, setLanguage] = useState(preferredLanguage());
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const s = await api<Session>("/api/rooms", {
        method: "POST",
        json: { display_name: name.trim() || "Host", name: roomName.trim() || `${MODES[mode].label} with friends`, mode, language },
      });
      saveSession(s);
      addRecent({ code: s.code, name: roomName.trim() || `${MODES[mode].label} with friends`, mode, as: s.name });
      nav(`/room/${s.code}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  // arriving with a mode picked means "start one now": bring the form into view (it sits below the hero on phones)
  useEffect(() => {
    if (linkedMode) startCard.current?.scrollIntoView({ block: "center" });
  }, [linkedMode]);
  const join = () => {
    const parsed = parseInviteCode(code);
    if (!parsed) return setError("That doesn’t look like a room code. Paste the invite link, or type the 6-character code.");
    setError("");
    nav(`/join/${parsed}`);
  };

  return (
    <div className="home">
      <div className="hero party-host" id="start">
        <PartyBackdrop scene="home" />
        <section>
          <span className="eyebrow">
            <Sparkles size={14} /> The watch party, rebuilt for real groups
          </span>
          <h1>
            Whatever you’re watching, <span className="grad">watch it together.</span>
          </h1>
          <p className="lede">
            Movie nights across five homes, a study group working through a lecture, mates following the match. WellPlayed keeps
            everyone in sync, in their own language, without everyone needing their own subscription.
          </p>
          <div className="trust">
            <div>
              <CheckCircle2 size={18} /> No accounts needed. Share a link and you’re in.
            </div>
            <div>
              <CheckCircle2 size={18} /> Everyone plays from their own legal source. Nothing is restreamed.
            </div>
            <div>
              <CheckCircle2 size={18} /> Camera features run on your device. No video ever leaves it.
            </div>
          </div>
          <ReelyAside className="home-reely">Bring friends. I brought opinions.</ReelyAside>
        </section>

        <section className="start-card" aria-label="Start a watch party" ref={startCard}>
          <h2>Start a watch party</h2>
          <p className="sub">Set up in seconds, then invite people with a link or code.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <div className="form-grid">
              <label className="field">
                <span>Your name</span>
                <input placeholder="e.g. Alex" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" maxLength={40} />
              </label>
              <label className="field">
                <span>Your language</span>
                <select value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {Object.entries(LANGUAGES).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field full">
                <span>Room name</span>
                <input placeholder={`${MODES[mode].label} with friends`} value={roomName} onChange={(e) => setRoomName(e.target.value)} maxLength={60} />
              </label>
            </div>
            <span className="label">What are you watching?</span>
            <div className="modes" role="radiogroup" aria-label="Room mode">
              {MODE_ORDER.map((id) => {
                const m = MODES[id];
                const Icon = m.icon;
                return (
                  <button
                    type="button"
                    key={id}
                    role="radio"
                    aria-checked={mode === id}
                    className={mode === id ? "mode active" : "mode"}
                    onClick={() => setMode(id)}
                  >
                    <span className="mode-head">
                      <span className="mode-icon">
                        <Icon size={16} />
                      </span>
                      {m.label}
                    </span>
                    <span className="blurb">{m.blurb}</span>
                  </button>
                );
              })}
            </div>
            <button type="submit" className="primary lg block" disabled={busy}>
              {busy ? <span className="spinner sm" /> : null}
              Create room
              {!busy && <ArrowRight size={18} />}
            </button>
          </form>

          <div className="or">or join with a code</div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <input
              className="code-input"
              placeholder="ABC123 or invite link"
              aria-label="Room code or invite link"
              value={code}
              // a pasted invite link collapses to its code; typed codes keep their spaces and dashes until Join
              onChange={(e) => setCode(/[/.]/.test(e.target.value) ? (parseInviteCode(e.target.value) ?? e.target.value) : e.target.value.toUpperCase())}
              maxLength={300}
            />
            <button type="submit" disabled={!code.trim()}>
              <LogIn size={16} />
              Join
            </button>
          </form>
          {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
        </section>
      </div>

      <RecentRooms />
      <HowItWorks />

      <section className="section" id="features">
        <div className="section-head">
          <h2>Everything a group needs to actually watch together</h2>
          <p>Sync and chat are only the start. WellPlayed handles the awkward parts of group viewing, so nobody has to.</p>
        </div>
        <div className="features">
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
      </section>

      <section className="section" id="modes">
        <div className="section-head">
          <h2>A mode for how your group watches</h2>
          <p>Lectures, live matches and movie nights need different tools. Pick a mode and the room adapts.</p>
        </div>
        <div className="mode-strip">
          {MODE_ORDER.map((id) => {
            const m = MODES[id];
            return (
              <article key={id} className="mode-card">
                <m.icon size={24} />
                <h4>{m.label}</h4>
                <p>{m.long}</p>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
