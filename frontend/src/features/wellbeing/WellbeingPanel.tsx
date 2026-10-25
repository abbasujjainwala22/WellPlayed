import { HeartPulse } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { useRoom } from "../../lib/room-context";
import { WellbeingController, type WellbeingStatus } from "../../lib/wellbeing/controller";
import { type AvatarState, EMOJI, type Flags } from "../../lib/wellbeing/signals";
import type { Panel } from "../panels";

export interface Lock {
  title: string | null;
  seconds: number;
  seatedOnly: boolean;
  required: { id: string; name: string; done: boolean }[];
}

export const useWellbeing = create<{
  members: Record<string, { state: AvatarState }>;
  lock: Lock | null;
  optedIn: boolean;
  status: WellbeingStatus | null;
  controller: WellbeingController | null;
}>(() => ({ members: {}, lock: null, optedIn: false, status: null, controller: null }));

function useWellbeingSetup() {
  const { socket, room } = useRoom();
  useEffect(() => {
    const ctl = new WellbeingController(
      (state) => socket.send("wellbeing:state", { state }),
      (status) => useWellbeing.setState({ status }),
      { focusChecks: room.mode === "study", onStretchDone: () => socket.send("stretch:done") },
    );
    useWellbeing.setState({ controller: ctl, optedIn: false, status: ctl.status });
    const offs = [
      socket.on("wellbeing:members", (d) => useWellbeing.setState({ members: d.members })),
      socket.on("lock:status", (d) => useWellbeing.setState({ lock: d.lock })),
    ];
    return () => {
      offs.forEach((o) => o());
      ctl.stopCamera();
    };
  }, [socket, room.mode]);
}

const SIM: [keyof Flags, string][] = [
  ["slouch", "Slouch"],
  ["staring", "Stop blinking"],
  ["potato", "Sit for hours"],
  ["phone", "Pick up phone (study)"],
  ["dozing", "Doze off (study)"],
];

function WellbeingPanel() {
  const { socket, settings, isHost, room } = useRoom();
  const { optedIn, status, controller } = useWellbeing();
  const [sim, setSim] = useState<Partial<Flags>>({});
  if (!controller || !status) return null;

  const toggleOpt = (enabled: boolean) => {
    socket.send("wellbeing:opt", { enabled });
    useWellbeing.setState({ optedIn: enabled });
    if (!enabled) {
      controller.stopCamera();
      setSim({});
    }
  };

  return (
    <div className="stack">
      <div className="card inner" style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <span style={{ fontSize: 34, lineHeight: 1 }}>{EMOJI[status.state]}</span>
        <div>
          <strong>Are you still human?</strong>
          <div className="faint">{optedIn ? (status.running ? "Camera on · analysed on this device" : "Opted in · camera off") : "Not joined yet"}</div>
        </div>
      </div>
      <p className="muted">
        Opt-in. Your camera is analysed <strong>on this device only</strong>. No video, images or body data are ever uploaded —
        only a tiny label like “shrimp” that others can see.
      </p>
      <label className="check">
        <input type="checkbox" checked={optedIn} onChange={(e) => toggleOpt(e.target.checked)} />
        Join healthy-watching
      </label>
      {optedIn && (
        <>
          <div className="row">
            {!status.running ? (
              <button className="primary" disabled={status.loading} onClick={() => void controller.startCamera()}>
                {status.loading ? "Loading models…" : "Start camera"}
              </button>
            ) : (
              <>
                <button onClick={() => controller.stopCamera()}>Stop camera</button>
                <button onClick={() => controller.recalibrate()}>Recalibrate posture</button>
              </>
            )}
          </div>
          {status.running && !status.calibrated && <p className="muted">Sit upright for a few seconds to calibrate…</p>}
          {status.error && <p className="error">{status.error}</p>}
          <h3>No camera? Try the simulator</h3>
          <div className="chips">
            {SIM.map(([flag, label]) => (
              <button
                key={flag}
                className={sim[flag] ? "chip on" : "chip"}
                onClick={() => {
                  const on = !sim[flag];
                  setSim((s) => ({ ...s, [flag]: on }));
                  controller.simulate(flag, on);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {isHost && (
        <div className="stack">
          <h3>Room settings</h3>
          {(
            [
              ["stretchLock", "Next episode only starts after everyone stretches"],
              ["seatedOnly", "Seated stretch routine for everyone"],
              ["playfulTransforms", "Show playful transformations to the group"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check">
              <input type="checkbox" checked={settings[key]} onChange={(e) => socket.send("settings:set", { [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      )}
      {room.mode === "study" && <p className="muted">Study mode also notices phones and dozing, shown as a 🐨.</p>}
    </div>
  );
}

export const wellbeingPanel: Panel = { id: "well", title: "Wellbeing", icon: HeartPulse, group: "tools", description: "Are you still human? Opt-in posture, blink and stretch nudges.", component: WellbeingPanel, useSetup: useWellbeingSetup };
