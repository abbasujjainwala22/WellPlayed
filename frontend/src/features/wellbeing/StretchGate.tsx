import { CircleCheck, Hourglass, PersonStanding } from "lucide-react";
import { useEffect, useState } from "react";

import { useRoom } from "../../lib/room-context";
import { useWellbeing } from "./WellbeingPanel";

/** Shown while the next episode is locked behind everyone's stretch. */
export function StretchGate() {
  const { socket, me, isHost } = useRoom();
  const { lock, controller, status } = useWellbeing();
  const [mode, setMode] = useState<"idle" | "camera" | "timer">("idle");
  const [left, setLeft] = useState(0);
  const mine = lock?.required.find((r) => r.id === me.id);

  useEffect(() => {
    if (!lock) {
      setMode("idle");
      controller?.endStretch();
    }
  }, [lock, controller]);
  useEffect(() => {
    if (mode !== "timer") return;
    const end = Date.now() + (lock?.seconds ?? 30) * 1000;
    const t = window.setInterval(() => {
      const s = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) {
        window.clearInterval(t);
        socket.send("stretch:done");
        setMode("idle");
      }
    }, 250);
    return () => window.clearInterval(t);
  }, [mode, lock?.seconds, socket]);

  if (!lock) return null;
  const startCamera = () => {
    controller?.beginStretch(lock.seatedOnly, lock.seconds);
    setMode("camera");
  };
  const st = status?.stretch;
  return (
    <div className="banner gate">
      <strong className="row" style={{ gap: 8 }}>
        <PersonStanding size={18} color="var(--violet)" /> “{lock.title ?? "Next episode"}” unlocks when everyone stretches
      </strong>
      <div>
        {lock.required.map((r) => (
          <span key={r.id} className={r.done ? "tag success" : "tag"}>
            {r.done ? <CircleCheck role="img" aria-label="Done" /> : <Hourglass role="img" aria-label="Waiting" />} {r.name}
          </span>
        ))}
      </div>
      {mine && !mine.done && mode === "idle" && (
        <div className="row">
          {status?.running && (
            <button className="primary" onClick={startCamera}>
              Start stretch (camera checks you)
            </button>
          )}
          <button onClick={() => setMode("timer")}>Guided {lock.seconds}s timer</button>
          <span className="muted">{lock.seatedOnly ? "Seated routine: raise both arms overhead 6 times." : "Stand up and raise both arms overhead 6 times."}</span>
        </div>
      )}
      {mode === "camera" && st && (
        <span>
          {st.phase === "waiting-stand" ? "Stand up so the camera can see you… " : "Keep stretching! "}
          {Math.round(st.progress * 100)}% · {st.reps}/6 arm raises
        </span>
      )}
      {mode === "timer" && <span>Stretch! {left}s left</span>}
      {isHost && (
        <button onClick={() => socket.send("lock:excuse", { memberId: null })} title="Start the episode regardless">
          Skip for everyone
        </button>
      )}
    </div>
  );
}
