import { ExternalLink, Film, Gavel, Play, Popcorn, Skull, Trophy, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { create } from "zustand";

import { youtubeId } from "../../lib/players/youtube";
import { useRoom } from "../../lib/room-context";
import { PartyCelebration, ReelyMascot } from "../personality";
import "./rounds.css";

type Kind = "movie" | "series";
type Vote = "yes" | "no";

interface Candidate {
  id: string;
  title: string;
  kind: Kind;
  year: number | null;
  addedBy: string;
  addedByName: string;
  myVote: Vote | null;
  /** Tallies arrive only once the host reveals the results. */
  yes: number | null;
  no: number | null;
}
interface RoundState {
  round: { id: string; number: number; status: "setup" | "voting" | "closed"; winners: string[] };
  candidates: Candidate[];
  progress: { finished: number; voters: number };
  max: number;
}

const useRounds = create<{ state: RoundState | null; error: string }>(() => ({ state: null, error: "" }));

/** Keeps the round in sync from the moment we join, even while the panel is closed. */
export function useRoundsSetup(enabled: boolean) {
  const { socket } = useRoom();
  useEffect(() => {
    if (!enabled) return;
    const offs = [
      socket.on("round:state", (s: RoundState) => useRounds.setState({ state: s, error: "" })),
      socket.on("round:error", (e: { message: string }) => useRounds.setState({ error: e.message })),
    ];
    return () => offs.forEach((o) => o());
  }, [socket, enabled]);
}

const NOPE = "NOPE. ABSOLUTELY NOT. 💀";
const YES = "PUT IT ON THE SCREEN. 🍿";
const SWIPE_AT = 100;

const meta = (c: Pick<Candidate, "kind" | "year">) => [c.kind === "series" ? "Series" : "Movie", c.year].filter(Boolean).join(" · ");

function reducedMotion(): boolean {
  return document.documentElement.classList.contains("reduce-motion") || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function send(socket: ReturnType<typeof useRoom>["socket"], type: string, data: object = {}) {
  useRounds.setState({ error: "" });
  socket.send(type, data);
}

/* ───────── Setup ───────── */

function Setup({ state }: { state: RoundState }) {
  const { socket, isHost, me } = useRoom();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Kind>("movie");
  const [year, setYear] = useState("");
  const pending = useRef<string | null>(null);
  const [added, setAdded] = useState(0);
  const n = state.candidates.length;
  const full = n >= state.max;

  // clear the form once the server has accepted what we sent (a duplicate keeps it for editing)
  useEffect(() => {
    const p = pending.current;
    if (p && state.candidates.some((c) => c.addedBy === me.id && c.title.toLowerCase() === p)) {
      pending.current = null;
      setTitle("");
      setYear("");
      setAdded(Date.now());
    }
  }, [state.candidates, me.id]);
  useEffect(() => {
    if (!added) return;
    const t = window.setTimeout(() => setAdded(0), 3500);
    return () => window.clearTimeout(t);
  }, [added]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim().replace(/\s+/g, " ");
    if (!t || full) return;
    pending.current = t.toLowerCase();
    send(socket, "round:add", { title: t, kind, year: year ? Number(year) : null });
  };

  return (
    <div className="stack">
      <form className="rounds-add" onSubmit={add}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          disabled={full}
          placeholder={full ? "The deck is full" : "Movie or series, e.g. Interstellar"}
          aria-label="Movie or series name"
        />
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} disabled={full} aria-label="Type">
            <option value="movie">Movie</option>
            <option value="series">Series</option>
          </select>
          <input
            className="rounds-year"
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            disabled={full}
            inputMode="numeric"
            placeholder="Year (optional)"
            aria-label="Release year (optional)"
          />
          <button type="submit" disabled={!title.trim() || full}>
            Add
          </button>
        </div>
      </form>
      <p className="faint" aria-live="polite">
        {n}/{state.max} contenders
      </p>
      {added > 0 && (
        <p className="rounds-added" role="status">
          <Gavel size={14} aria-hidden /> Added to the courtroom. Let the group judge it.
        </p>
      )}
      <ul className="rounds-list">
        {state.candidates.map((c) => (
          <li key={c.id}>
            <span className="grow truncate">
              <strong>{c.title}</strong> <span className="faint">{meta(c)} · {c.addedByName}</span>
            </span>
            {(isHost || c.addedBy === me.id) && (
              <button className="ghost icon sm" aria-label={`Remove ${c.title}`} onClick={() => send(socket, "round:remove", { candidateId: c.id })}>
                <X size={14} />
              </button>
            )}
          </li>
        ))}
        {n === 0 && <li className="rounds-empty faint">No contenders yet. Everyone can add one.</li>}
      </ul>
      {isHost ? (
        <button className="primary block" disabled={n < 2} onClick={() => send(socket, "round:start")}>
          {n < 2 ? "Add at least 2 to start" : `Start voting on ${n}`}
        </button>
      ) : (
        <p className="muted">Waiting for the host to start voting.</p>
      )}
    </div>
  );
}

/* ───────── Swipe ───────── */

function Swipe({ state }: { state: RoundState }) {
  const { socket, isHost } = useRoom();
  // votes we've sent but the server hasn't echoed yet, so the next card shows straight away
  const [local, setLocal] = useState<Record<string, Vote>>({});
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const voted = (c: Candidate) => c.myVote ?? local[c.id] ?? null;
  const next = state.candidates.find((c) => !voted(c));
  const done = state.candidates.filter((c) => voted(c)).length;
  const p = state.progress;
  const reduce = reducedMotion();

  const vote = (v: Vote) => {
    if (!next) return;
    setLocal((l) => ({ ...l, [next.id]: v }));
    setDx(0);
    send(socket, "round:vote", { candidateId: next.id, vote: v });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable) return;
      if (e.key === "ArrowLeft") vote("no");
      if (e.key === "ArrowRight") vote("yes");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nope = Math.min(1, Math.max(0, -dx / SWIPE_AT));
  const yes = Math.min(1, Math.max(0, dx / SWIPE_AT));

  return (
    <div className="stack">
      <p className="faint" aria-live="polite">
        {p.finished} of {p.voters} {p.voters === 1 ? "person has" : "people have"} finished judging. Votes stay hidden until the host reveals them.
      </p>
      {next ? (
        <>
          <div
            key={next.id}
            className="rounds-card"
            tabIndex={0}
            role="group"
            aria-label={`${next.title}, ${meta(next)}. Left arrow to reject, right arrow to approve.`}
            style={{ transform: `translateX(${dx}px)${reduce ? "" : ` rotate(${dx / 18}deg)`}`, transition: start.current === null ? undefined : "none" }}
            onPointerDown={(e) => {
              start.current = e.clientX;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => start.current !== null && setDx(e.clientX - start.current)}
            onPointerUp={() => {
              start.current = null;
              if (dx > SWIPE_AT) vote("yes");
              else if (dx < -SWIPE_AT) vote("no");
              else setDx(0);
            }}
            onPointerCancel={() => {
              start.current = null;
              setDx(0);
            }}
          >
            <span className="rounds-stamp nope" style={{ opacity: nope }} aria-hidden>
              {NOPE}
            </span>
            <span className="rounds-stamp yes" style={{ opacity: yes }} aria-hidden>
              {YES}
            </span>
            <Film size={30} className="rounds-card-icon" aria-hidden />
            <h2>{next.title}</h2>
            <div className="muted">{meta(next)}</div>
            <div className="faint">
              Added by {next.addedByName} · {done + 1}/{state.candidates.length}
            </div>
          </div>
          <div className="rounds-actions">
            <button className="rounds-nope" onClick={() => vote("no")}>
              {NOPE}
            </button>
            <button className="rounds-yes" onClick={() => vote("yes")}>
              {YES}
            </button>
          </div>
          <p className="faint center-text">Drag the card or use the ← → keys.</p>
        </>
      ) : (
        <p className="muted">You’ve judged every contender. Waiting for the others.</p>
      )}
      {isHost && (
        <div className="row">
          <button className="primary grow" onClick={() => send(socket, "round:close")}>
            Reveal results
          </button>
          <button
            className="ghost sm"
            onClick={() => window.confirm("Throw this vote away and start a new one?") && send(socket, "round:new")}
          >
            Start over
          </button>
        </div>
      )}
    </div>
  );
}

/* ───────── Results ───────── */

function WinnerLoader({ winner }: { winner: Candidate }) {
  const { socket, room } = useRoom();
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const hangout = room.mode === "hangout";

  useEffect(
    () =>
      socket.on("round:watched", (d: { candidateId: string; queued: boolean }) => {
        if (d.candidateId !== winner.id) return;
        setUrl("");
        setSent(d.queued ? "Added to the queue. It plays after what’s on now." : hangout ? "Playing now in the queue." : "Sent to the shared player.");
      }),
    [socket, winner.id, hangout],
  );

  const load = (e: FormEvent) => {
    e.preventDefault();
    const src = url.trim();
    if (!src) return;
    if (hangout && !youtubeId(src)) return setErr("The queue takes YouTube links. Copy the link from the video’s Share button.");
    setErr("");
    setSent(null);
    send(socket, "round:watch", { candidateId: winner.id, url: src });
  };
  const search = `https://www.youtube.com/results?search_query=${encodeURIComponent([winner.title, winner.year].filter(Boolean).join(" "))}`;

  return (
    <div className="card inner rounds-loader">
      <strong>Okay, cinema committee. Load the winner 🎬</strong>
      <p className="faint">
        Paste a viewing link for {winner.title}
        {hangout ? " (YouTube only in a hangout)" : ""}. WellPlayed doesn’t search for videos on its own.
      </p>
      <form className="row" onSubmit={load}>
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setErr("");
          }}
          placeholder={hangout ? "Paste a YouTube link" : "Paste a YouTube link or video URL"}
          aria-label={`Viewing link for ${winner.title}`}
        />
        <button type="submit" className="primary" disabled={!url.trim()}>
          <Play size={16} /> {hangout ? "Queue it" : "Load winner"}
        </button>
      </form>
      <a className="rounds-search" href={search} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={13} /> Find it on YouTube
      </a>
      {err && <p className="error">{err}</p>}
      {sent && (
        <p className="rounds-sent" role="status">
          {sent}
        </p>
      )}
    </div>
  );
}

function Results({ state }: { state: RoundState }) {
  const { socket, isHost } = useRoom();
  const winners = state.round.winners;
  const tie = winners.length > 1;
  const [pick, setPick] = useState<string | null>(null);
  const rows = [...state.candidates].sort((a, b) => (b.yes ?? 0) - (a.yes ?? 0) || (a.no ?? 0) - (b.no ?? 0));
  const chosen = state.candidates.find((c) => c.id === (tie ? pick : winners[0]));
  const solo = !tie && chosen;

  return (
    <div className="stack">
      {winners.length > 0 && (
        <PartyCelebration eventKey={`round-${state.round.id}`}>
          {tie ? "A tie. Democracy has failed, spectacularly." : "The people have spoken. Their taste will be investigated later."}
        </PartyCelebration>
      )}
      <div className="rounds-trophy">
        <ReelyMascot mood={winners.length && !tie ? "celebrating" : "thinking"} size={76} />
      </div>
      <p className="rounds-headline">
        {!winners.length
          ? "Everything got rejected. Brutal. 💀"
          : tie
            ? "It’s a tie. The group can’t decide (shocking)."
            : `${solo ? solo.title : "The winner"} wins. The group has spoken. 🏆`}
      </p>
      <ul className="rounds-list results">
        {rows.map((c, i) => {
          const win = winners.includes(c.id);
          return (
            <li key={c.id} className={win ? "win" : ""} style={{ animationDelay: `${200 + i * 90}ms` }}>
              <div className="row">
                <span className="grow truncate">
                  {win && (
                    <>
                      <Trophy size={14} className="inline-icon" color="var(--warning)" aria-label="Winner" role="img" />{" "}
                    </>
                  )}
                  <strong>{c.title}</strong> <span className="faint">{meta(c)}</span>
                </span>
                <span className="mono rounds-tally">
                  <Popcorn size={13} className="inline-icon" role="img" aria-label="Yes votes" /> {c.yes} ·{" "}
                  <Skull size={13} className="inline-icon" role="img" aria-label="No votes" /> {c.no}
                </span>
              </div>
              {tie && win && isHost && (
                <button className={`chip ${pick === c.id ? "on" : ""}`} aria-pressed={pick === c.id} onClick={() => setPick(c.id)}>
                  Pick this one
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {isHost && chosen && <WinnerLoader key={chosen.id} winner={chosen} />}
      {isHost ? (
        <div className="row">
          {tie && (
            <button className="primary" onClick={() => send(socket, "round:new", { tiebreak: true })}>
              Tie-breaker round
            </button>
          )}
          <button onClick={() => send(socket, "round:new")}>{winners.length ? "New vote" : "Add new contenders"}</button>
        </div>
      ) : (
        winners.length > 0 && <p className="muted">The host will put {tie ? "the pick" : "it"} on the screen.</p>
      )}
    </div>
  );
}

/* ───────── Panel section ───────── */

export function GroupVote() {
  const state = useRounds((s) => s.state);
  const error = useRounds((s) => s.error);
  return (
    <section className="rounds" aria-labelledby="rounds-h">
      <div>
        <h3 id="rounds-h">
          What are we watching? 👀{state && <span className="rounds-round"> · Round {state.round.number}</span>}
        </h3>
        <p className="faint">Add up to five contenders. The group decides their fate.</p>
      </div>
      {!state ? (
        <div className="spinner sm" />
      ) : state.round.status === "setup" ? (
        <Setup state={state} />
      ) : state.round.status === "voting" ? (
        <Swipe key={state.round.id} state={state} />
      ) : (
        <Results key={state.round.id} state={state} />
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
