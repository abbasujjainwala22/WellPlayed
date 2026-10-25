import { ArrowDown, ArrowUp, ListMusic, Music2, Plus, SkipForward, Vote, X } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";
import { GroupVote, useRoundsSetup } from "../rounds/GroupVote";

interface Item {
  id: string;
  title: string;
  url: string;
  addedByName: string;
}
interface Queue {
  items: Item[];
  current: Item | null;
  votes: number;
  needed: number;
  voters: string[];
}

export const useQueue = create<{ queue: Queue }>(() => ({ queue: { items: [], current: null, votes: 0, needed: 1, voters: [] } }));

function useQueueSetup() {
  const { socket, room } = useRoom();
  useRoundsSetup(room.mode === "hangout");
  useEffect(() => socket.on("queue:state", (d) => useQueue.setState({ queue: d.queue })), [socket]);
}

function HangoutPanel() {
  const [view, setView] = useState<"queue" | "vote">("queue");
  return (
    <div>
      <nav className="tabs">
        <button className={view === "queue" ? "active" : ""} onClick={() => setView("queue")}>
          <ListMusic size={14} aria-hidden />
          Queue
        </button>
        <button className={view === "vote" ? "active" : ""} onClick={() => setView("vote")}>
          <Vote size={14} aria-hidden />
          Group vote
        </button>
      </nav>
      {view === "queue" ? <QueueView /> : <GroupVote />}
    </div>
  );
}

function QueueView() {
  const { socket, me, isHost, settings } = useRoom();
  const q = useQueue((s) => s.queue);
  const [url, setUrl] = useState("");
  const add = () => {
    if (!url.trim()) return;
    socket.send("queue:add", { url: url.trim() });
    setUrl("");
  };
  const voted = q.voters.includes(me.id);
  return (
    <div className="stack">
      <div className="row">
        <input placeholder="Add a YouTube link…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <button className="primary" onClick={add} disabled={!url.trim()}>
          <Plus size={16} />
          Add
        </button>
      </div>
      {q.current && (
        <div className="card inner">
          <div className="faint">
            <Music2 size={12} style={{ verticalAlign: -1 }} /> Now playing · added by {q.current.addedByName}
          </div>
          <strong>{q.current.title}</strong>
          <div className="row">
            <button className={voted ? "chip on" : "chip"} onClick={() => socket.send("queue:skip-vote")}>
              <SkipForward size={14} aria-hidden />
              Vote skip ({q.votes}/{q.needed})
            </button>
            {isHost && <button onClick={() => socket.send("queue:skip")}>Skip now</button>}
          </div>
        </div>
      )}
      <h3>Up next ({q.items.length})</h3>
      {q.items.length === 0 && <p className="faint">The queue is empty. Paste a YouTube link above to add something.</p>}
      <ol className="board">
        {q.items.map((it) => (
          <li key={it.id}>
            <span className="grow truncate">
              {it.title} <span className="faint">· {it.addedByName}</span>
            </span>
            {isHost && (
              <>
                <button className="ghost icon sm" aria-label="Move up" onClick={() => socket.send("queue:move", { id: it.id, delta: -1 })}><ArrowUp size={14} /></button>
                <button className="ghost icon sm" aria-label="Move down" onClick={() => socket.send("queue:move", { id: it.id, delta: 1 })}><ArrowDown size={14} /></button>
              </>
            )}
            {(isHost || it.addedByName === me.name) && (
              <button className="ghost icon sm danger" aria-label="Remove" onClick={() => socket.send("queue:remove", { id: it.id })}><X size={14} /></button>
            )}
          </li>
        ))}
      </ol>
      {isHost && (
        <label className="check">
          <input type="checkbox" checked={settings.audioFirst} onChange={(e) => socket.send("settings:set", { audioFirst: e.target.checked })} />
          Audio-first (shrink the video)
        </label>
      )}
      <p className="muted">Drop in or out any time — the queue and playback carry on without you.</p>
    </div>
  );
}

export const hangoutPanel: Panel = { id: "hangout", title: "Queue", icon: ListMusic, description: "Everyone adds videos, and the room votes to skip.", component: HangoutPanel, useSetup: useQueueSetup, modes: ["hangout"], companion: true };
