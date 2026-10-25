import { Crosshair, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { stageRef } from "../../components/Stage";
import { useRoom } from "../../lib/room-context";
import type { Panel } from "../panels";

interface Lag {
  lag: number;
  source: "manual" | "auto" | "marker";
}

export const useSports = create<{ lags: Record<string, Lag>; marker: { id: string; label: string } | null }>(() => ({
  lags: {},
  marker: null,
}));

function useSportsSetup() {
  const { socket } = useRoom();
  useEffect(() => {
    const offs = [
      socket.on("lag:state", (d) => useSports.setState({ lags: d.lags })),
      socket.on("sync:marker", (d) => useSports.setState({ marker: d.id ? d : null })),
    ];
    return () => offs.forEach((o) => o());
  }, [socket]);
  // automatic HLS latency estimate, never overriding a manual or marker calibration
  useEffect(() => {
    const t = window.setInterval(() => {
      const l = stageRef.adapter?.liveLatency?.();
      if (l != null) socket.send("lag:set", { lag: l, source: "auto" });
    }, 5000);
    return () => window.clearInterval(t);
  }, [socket]);
}

/** Shown to everyone while the host runs a calibration marker. */
export function CalibrationPrompt() {
  const { socket } = useRoom();
  const marker = useSports((s) => s.marker);
  if (!marker) return null;
  return (
    <div className="banner">
      <Crosshair size={18} />
      <span>
        Calibrating: tap the moment you see <strong>{marker.label}</strong> on <em>your</em> screen
      </span>
      <span className="actions">
        <button className="primary sm" onClick={() => socket.send("sync:saw", { markerId: marker.id })}>
          I just saw it!
        </button>
      </span>
    </div>
  );
}

function SportsPanel() {
  const { socket, me, members, settings, isHost } = useRoom();
  const lags = useSports((s) => s.lags);
  const mine = lags[me.id];
  const [label, setLabel] = useState("the next whistle");
  const [home, setHome] = useState("Home");
  const [away, setAway] = useState("Away");
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  const predict = (question: string, options: string[], durationS?: number) =>
    socket.send("poll:create", { kind: "prediction", question, options, durationS });

  return (
    <div className="stack">
      <p className="muted">
        Everyone’s stream runs a few seconds apart. Tell WellPlayed how far behind live you are and cheers, chat and results are
        held back until <em>you</em> reach that moment.
      </p>
      {isHost && (
        <label className="check">
          <input type="checkbox" checked={settings.spoilerSafe} onChange={(e) => socket.send("settings:set", { spoilerSafe: e.target.checked })} />
          Spoiler-safe mode
        </label>
      )}
      <label className="stack">
        My delay behind live: {(mine?.lag ?? 0).toFixed(1)}s {mine && <span className="muted">({mine.source})</span>}
        <input
          type="range"
          min={0}
          max={60}
          step={0.5}
          value={mine?.lag ?? 0}
          onChange={(e) => socket.send("lag:set", { lag: +e.target.value, source: "manual" })}
        />
      </label>

      <h3>Calibrate together</h3>
      <div className="row">
        <input value={label} onChange={(e) => setLabel(e.target.value)} disabled={!isHost} />
        {isHost ? (
          <>
            <button onClick={() => socket.send("sync:marker", { label })}>Start</button>
            <button onClick={() => socket.send("sync:marker-end")}>End</button>
          </>
        ) : (
          <span className="muted">Host starts this</span>
        )}
      </div>
      <ul className="plain">
        {members.map((m) => (
          <li key={m.id}>
            {m.name}: {lags[m.id] ? `${lags[m.id].lag.toFixed(1)}s (${lags[m.id].source})` : <span className="muted">not set</span>}
          </li>
        ))}
      </ul>

      {isHost && (
        <>
          <h3>Live predictions</h3>
          <div className="row">
            <input value={home} onChange={(e) => setHome(e.target.value)} />
            <input value={away} onChange={(e) => setAway(e.target.value)} />
          </div>
          <button onClick={() => predict("Who scores next?", [home, away, "Nobody in 5 min"], 300)}>Who scores next? (5 min)</button>
          <button onClick={() => predict("Will there be a goal in the next 10 minutes?", ["Yes", "No"], 600)}>Goal in 10 min?</button>
          <button onClick={() => predict("Who wins?", [home, away, "Draw"])}>Who wins?</button>
          <p className="muted">Predictions close at a point in the match, not on the clock, so slower streams get fair time. Reveal results from the Polls tab.</p>
        </>
      )}
      {Object.keys(lags).length > 0 && <p className="muted">{Object.keys(lags).map(nameOf).join(", ")} calibrated.</p>}
    </div>
  );
}

export const sportsPanel: Panel = { id: "sports", title: "Live sync", icon: Trophy, description: "Line everyone up to the same moment so nobody spoils a goal.", component: SportsPanel, useSetup: useSportsSetup, modes: ["sports"], companion: true };
