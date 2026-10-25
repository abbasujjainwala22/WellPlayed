import { ExternalLink, Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { useRoom } from "../../lib/room-context";
import "./lifecycle.css";

interface Countdown {
  endsAtServerMs: number;
  seconds: number;
  provider: string;
  url: string | null;
  by: string;
}

const GO_HOLD_MS = 4000; // keep "Go!" up for a moment after zero

/** Everyone's screen counts down together (server clock), for sources that play outside the shared player. */
export function GroupCountdown() {
  const { socket } = useRoom();
  const [cd, setCd] = useState<Countdown | null>(null);
  const [, tick] = useState(0);

  useEffect(() => socket.on("countdown:state", (d: Countdown) => setCd(d)), [socket]);
  useEffect(() => {
    if (!cd) return;
    const t = window.setInterval(() => {
      if (socket.clock.serverNow() > cd.endsAtServerMs + GO_HOLD_MS) setCd(null);
      else tick((n) => n + 1);
    }, 200);
    return () => window.clearInterval(t);
  }, [cd, socket]);

  if (!cd) return null;
  const left = Math.max(0, Math.ceil((cd.endsAtServerMs - socket.clock.serverNow()) / 1000));
  return (
    <div className={`banner group-countdown ${left === 0 ? "go" : ""}`} role="status" aria-live="assertive">
      <Timer size={18} />
      <span className="grow">
        {left > 0 ? (
          <>
            <strong>Press play on {cd.provider} in</strong> <span className="countdown">{left}</span>
            <span className="faint"> · started by {cd.by} · not synced, so everyone presses play at zero</span>
          </>
        ) : (
          <strong>Go! Press play now, then come back here for chat and reactions.</strong>
        )}
      </span>
      {cd.url && (
        <a className="countdown-open" href={cd.url} target="_blank" rel="noopener noreferrer">
          Open {cd.provider} <ExternalLink size={13} />
        </a>
      )}
    </div>
  );
}
