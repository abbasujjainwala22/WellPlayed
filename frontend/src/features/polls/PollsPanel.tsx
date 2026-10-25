import { Check, Plus, Sparkles, Trophy, Vote } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";

export interface Poll {
  id: string;
  kind: "poll" | "prediction" | "quiz";
  question: string;
  options: { id: number; text: string }[];
  state: "open" | "locked" | "revealed";
  counts: number[];
  answered: number;
  points: number;
  mine: number | null;
  /** "ai" when a member shared a poll Reely drafted for them. */
  source?: "member" | "ai";
  sharedBy?: string | null;
  correct?: number;
  results?: { memberId: string; name: string; points: number; elapsedMs: number }[];
}
export interface Row {
  memberId: string;
  name: string;
  points: number;
}

export const usePolls = create<{
  polls: Poll[];
  board: Row[];
  upsert: (p: Poll) => void;
  setAll: (p: Poll[]) => void;
  counts: (id: string, counts: number[], answered: number) => void;
  setBoard: (b: Row[]) => void;
}>((set) => ({
  polls: [],
  board: [],
  upsert: (p) =>
    set((s) => {
      const old = s.polls.find((x) => x.id === p.id);
      const next = { ...p, mine: p.mine ?? old?.mine ?? null }; // broadcasts carry no personal answer
      return { polls: old ? s.polls.map((x) => (x.id === p.id ? next : x)) : [...s.polls, next] };
    }),
  setAll: (polls) => set({ polls }),
  counts: (id, counts, answered) => set((s) => ({ polls: s.polls.map((p) => (p.id === id ? { ...p, counts, answered } : p)) })),
  setBoard: (board) => set({ board }),
}));

function usePollsSetup() {
  const { socket } = useRoom();
  useEffect(() => {
    const st = usePolls.getState();
    const offs = [
      socket.on("poll:list", (d) => st.setAll(d.polls)),
      socket.on("poll:state", (d) => usePolls.getState().upsert(d.poll)),
      socket.on("poll:counts", (d) => usePolls.getState().counts(d.id, d.counts, d.answered)),
      socket.on("leaderboard:state", (d) => usePolls.getState().setBoard(d.leaderboard)),
    ];
    return () => offs.forEach((o) => o());
  }, [socket]);
}

function Creator() {
  const { socket } = useRoom();
  const [kind, setKind] = useState("poll");
  const [q, setQ] = useState("");
  const [opts, setOpts] = useState("");
  const [correct, setCorrect] = useState("");
  const submit = () => {
    const options = opts.split("\n").map((o) => o.trim()).filter(Boolean);
    socket.send("poll:create", { kind, question: q, options, correct: correct === "" ? null : Number(correct) - 1 });
    setQ("");
    setOpts("");
    setCorrect("");
  };
  return (
    <details className="card inner" open>
      <summary>
        <Plus size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        New poll, prediction or quiz
      </summary>
      <div className="stack">
      <select value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="poll">Poll</option>
        <option value="prediction">Prediction (scored)</option>
        <option value="quiz">Quiz (fastest correct wins)</option>
      </select>
      <input placeholder="Question" value={q} onChange={(e) => setQ(e.target.value)} />
      <textarea placeholder={"One option per line"} rows={3} value={opts} onChange={(e) => setOpts(e.target.value)} />
      {kind === "quiz" && (
        <input placeholder="Correct option number (1, 2, …)" value={correct} onChange={(e) => setCorrect(e.target.value)} />
      )}
      <button className="primary" onClick={submit} disabled={!q.trim() || opts.split("\n").filter((o) => o.trim()).length < 2}>
        Create
      </button>
      </div>
    </details>
  );
}

export function PollCard({ poll }: { poll: Poll }) {
  const { socket, isHost } = useRoom();
  const showCounts = poll.mine !== null || poll.state !== "open";
  const total = Math.max(1, poll.counts.reduce((a, b) => a + b, 0));
  return (
    <div className="card inner">
      <div className="row" style={{ gap: 6 }}>
        <span className={`tag ${poll.kind === "quiz" ? "violet" : poll.kind === "prediction" ? "brand" : ""}`} style={{ margin: 0 }}>
          {poll.kind}
        </span>
        <span className={`tag ${poll.state === "open" ? "success" : ""}`} style={{ margin: 0 }}>
          {poll.state}
        </span>
        <span className="faint spacer">{poll.answered} answered</span>
      </div>
      {poll.source === "ai" && (
        <span className="faint">
          <Sparkles size={12} className="inline-icon" aria-hidden /> Drafted by Reely · shared by {poll.sharedBy ?? "someone"}
        </span>
      )}
      <strong>{poll.question}</strong>
      {poll.options.map((o) => (
        <button
          key={o.id}
          className={`opt ${poll.mine === o.id ? "mine" : ""} ${poll.correct === o.id ? "correct" : ""}`}
          disabled={poll.state !== "open" || poll.mine !== null}
          onClick={() => socket.send("poll:answer", { pollId: poll.id, option: o.id })}
          style={showCounts ? { backgroundSize: `${(poll.counts[o.id] / total) * 100}% 100%` } : undefined}
        >
          {o.text} {showCounts && <span className="muted">({poll.counts[o.id]})</span>}
        </button>
      ))}
      {poll.state === "revealed" && poll.results && poll.results.length > 0 && (
        <div className="muted">
          {poll.results.map((r) => `${r.name} +${r.points}`).join(" · ")}
        </div>
      )}
      {isHost && poll.state !== "revealed" && (
        <div className="row">
          {poll.state === "open" && <button onClick={() => socket.send("poll:lock", { pollId: poll.id })}>Lock</button>}
          {poll.kind !== "poll" && poll.options.map((o) => (
            <button key={o.id} title="Reveal with this as the correct answer"
              onClick={() => socket.send("poll:reveal", { pollId: poll.id, correct: o.id })}>
              <Check size={14} aria-hidden /> {o.id + 1}
            </button>
          ))}
          {poll.kind === "poll" && <button onClick={() => socket.send("poll:reveal", { pollId: poll.id })}>Close</button>}
        </div>
      )}
    </div>
  );
}

function PollsPanel() {
  const { isHost } = useRoom();
  const polls = usePolls((s) => s.polls);
  const board = usePolls((s) => s.board);
  return (
    <div className="stack">
      {isHost && <Creator />}
      {[...polls].reverse().map((p) => (
        <PollCard key={p.id} poll={p} />
      ))}
      {polls.length === 0 && (
        <div className="empty">
          <Vote size={28} />
          <strong>No polls yet</strong>
          <span>{isHost ? "Create one above to get the room voting." : "The host’s polls and quizzes will appear here. Ask Reely to draft one you can share."}</span>
        </div>
      )}
      <h3>
        <Trophy size={12} style={{ verticalAlign: -1 }} /> Leaderboard
      </h3>
      {board.length === 0 && <p className="faint">Points from predictions and quizzes show up here.</p>}
      <ol className="board">
        {board.map((r) => (
          <li key={r.memberId}>
            {r.name} <strong>{r.points}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const pollsPanel: Panel = { id: "polls", title: "Polls", icon: Vote, description: "Polls, predictions and quizzes, plus the room’s leaderboard.", component: PollsPanel, useSetup: usePollsSetup, companion: true };
