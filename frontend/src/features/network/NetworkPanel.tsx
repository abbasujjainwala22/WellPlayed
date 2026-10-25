import { Pause, Wifi } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";

import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";

interface Row {
  id: string;
  name: string;
  bufferS: number;
  predictedS: number;
  buffering: boolean;
  bandwidthKbps: number | null;
}

export const useNetwork = create<{ rows: Row[]; planned: boolean }>(() => ({ rows: [], planned: false }));

function useNetworkSetup() {
  const { socket } = useRoom();
  useEffect(
    () => socket.on("buffer:status", (d) => useNetwork.setState({ rows: d.members, planned: d.planned })),
    [socket],
  );
}

const color = (s: number) => (s < 1 ? "var(--danger)" : s < 4 ? "var(--warning)" : "var(--success)");

function NetworkPanel() {
  const { rows, planned } = useNetwork();
  return (
    <div className="stack">
      <p className="muted">
        WellPlayed watches everyone’s buffer and, if someone is about to stall, preloads further and pauses the room briefly — before
        a stall — then resumes when they’ve caught up.
      </p>
      {planned && <div className="banner">
          <Pause size={16} aria-hidden /> Planned pause: waiting for the slowest connection…
        </div>}
      {rows.length === 0 && <p className="muted">Start playback to see connection health.</p>}
      {rows.map((r) => (
        <div key={r.id}>
          <div className="row">
            <strong>{r.name}</strong>
            <span className="muted">
              {r.bufferS}s buffered · in 10s: {r.predictedS}s{r.bandwidthKbps ? ` · ${(r.bandwidthKbps / 1000).toFixed(1)} Mbps` : ""}
            </span>
          </div>
          <div className="meter">
            <div style={{ width: `${Math.min(100, (r.bufferS / 30) * 100)}%`, background: color(r.predictedS) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export const networkPanel: Panel = { id: "net", title: "Network", icon: Wifi, group: "tools", description: "Buffer forecasting protects the weakest connection before it stalls.", component: NetworkPanel, useSetup: useNetworkSetup };
