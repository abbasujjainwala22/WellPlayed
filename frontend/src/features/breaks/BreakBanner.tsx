import { Coffee, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { useRoom } from "../../lib/room-context";

interface Break {
  id: string;
  state: "requested" | "countdown";
  requesterId: string;
  requesterName: string;
  seconds: number;
  resumeAtMs: number | null;
  autoApproveAtMs: number;
  extensions: number;
}

const useBreak = create<{ br: Break | null }>(() => ({ br: null }));

/** "I need a break" — asks the host instead of pausing everyone. Hidden while a break is in progress. */
export function BreakButton({ className = "" }: { className?: string }) {
  const { socket } = useRoom();
  const br = useBreak((s) => s.br);
  if (br) return null;
  return (
    <button className={`break-btn ${className}`} onClick={() => socket.send("break:request", { seconds: 120 })} title="Ask the room for a 2-minute pause">
      <Coffee size={16} /> I need a break
    </button>
  );
}

/** Owns the break:state listener; keep it mounted. Shows the request / countdown banner. */
export function BreakBanner() {
  const { socket, me, isHost } = useRoom();
  const br = useBreak((s) => s.br);
  const [, tick] = useState(0);
  useEffect(() => {
    const off = socket.on("break:state", (d) => useBreak.setState({ br: d.break }));
    return () => {
      off();
      useBreak.setState({ br: null });
    };
  }, [socket]);
  useEffect(() => {
    if (!br) return;
    const t = window.setInterval(() => tick((n) => n + 1), 250);
    return () => window.clearInterval(t);
  }, [br?.id, br?.state]);

  const left = (serverMs: number | null) =>
    serverMs ? Math.max(0, Math.ceil((socket.clock.toLocal(serverMs) - Date.now()) / 1000)) : 0;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  if (!br) return null;
  const mine = br.requesterId === me.id;
  if (br.state === "requested")
    return (
      <div className="banner warn" role="status">
        <Coffee size={18} />
        <span>
          <strong>{mine ? "You" : br.requesterName}</strong> asked for a break. Auto-approving in {left(br.autoApproveAtMs)}s.
        </span>
        {isHost && (
          <span className="actions">
            <button className="primary sm" onClick={() => socket.send("break:decision", { approve: true })}>
              Approve
            </button>
            <button className="sm" onClick={() => socket.send("break:decision", { approve: false })}>
              Decline
            </button>
          </span>
        )}
      </div>
    );
  return (
    <div className="banner brand" role="status">
      <Timer size={18} />
      <span>
        Resuming in <span className="countdown">{fmt(left(br.resumeAtMs))}</span> — {br.requesterName} needs a break
      </span>
      <span className="actions">
        {(mine || isHost) && (
          <button className="sm primary" onClick={() => socket.send("break:return")}>
            {mine ? "I’m back" : "Resume now"}
          </button>
        )}
        {isHost && br.extensions < 3 && (
          <button className="sm" onClick={() => socket.send("break:extend")}>
            +1 min
          </button>
        )}
      </span>
    </div>
  );
}
