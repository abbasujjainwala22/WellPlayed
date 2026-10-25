import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { TileOverlayContext } from "../voice/VoiceTile";
import { type AnimalId, animalInfo } from "./animals";
import type { FacePoints } from "./points";
import { renderFace } from "./render";
import { type AnimalEffect, prefersReducedMotion, useAnimal, useAnimalActions } from "./store";
import { retryTracker, useTracker, watchFace } from "./tracker";
import "./animal.css";

const SMOOTH_MS = 70; // time constant for easing towards the newest landmarks
const LOST_MS = 700; // fade the animal out when no face has been seen for this long
const POP_MS = 320;

type Seen = "waiting" | "face" | "none";

function FaceCanvas({ video, animal, mirrored }: { video: HTMLVideoElement; animal: AnimalId; mirrored: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState<Seen>("waiting");

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    let target: FacePoints | null = null;
    let shown: FacePoints | null = null;
    let lastFace = 0;
    let firstFace = 0;
    let state: Seen = "waiting";
    let raf = 0;
    let prev = performance.now();
    let opacity = 0;
    const report = (s: Seen) => {
      if (s !== state) setSeen((state = s));
    };

    const stop = watchFace(video, (points) => {
      const now = performance.now();
      if (points) {
        target = points;
        if (!shown) {
          shown = points.slice();
          firstFace = now;
        }
        lastFace = now;
        report("face");
      } else if (now - lastFace > LOST_MS) {
        report("none");
      }
    });

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(100, now - prev);
      prev = now;
      if (!shown || !target) return;
      const k = reduce ? 1 : 1 - Math.exp(-dt / SMOOTH_MS);
      for (let i = 0; i < shown.length; i++) shown[i] += (target[i] - shown[i]) * k;
      const want = now - lastFace < LOST_MS ? 1 : 0;
      opacity = reduce ? want : opacity + (want - opacity) * Math.min(1, dt / 150);
      el.style.opacity = opacity.toFixed(3);
      if (opacity < 0.01) return;
      const pop = reduce ? 1 : Math.min(1, (now - firstFace) / POP_MS);
      const eased = 1 - (1 - pop) ** 3;
      renderFace(el, video, shown, animal, { pop: eased, wiggle: reduce ? 0 : Math.sin(now / 260) });
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [video, animal]);

  return (
    <>
      <canvas ref={canvas} className={`animal-canvas ${mirrored ? "mirror" : ""}`} aria-hidden="true" />
      {seen === "none" && (
        <span className="animal-chip" title="No face in view. Normal video is shown.">
          {animalInfo(animal).emoji} <span className="truncate">Looking for a face…</span>
        </span>
      )}
    </>
  );
}

function TrackerChip({ effect }: { effect: AnimalEffect }) {
  const { status, error } = useTracker();
  if (status === "loading") {
    return (
      <span className="animal-chip" role="status">
        <span className="spinner sm" /> <span className="truncate">Loading {animalInfo(effect.animal).name.toLowerCase()}…</span>
      </span>
    );
  }
  if (status !== "error") return null;
  return (
    <span className="animal-chip error" role="alert" title={error}>
      {animalInfo(effect.animal).emoji} <span className="truncate">Effects unavailable</span>
      <button type="button" className="ghost icon sm" aria-label="Retry face effects" title="Retry" onClick={retryTracker}>
        <RefreshCw size={12} />
      </button>
    </span>
  );
}

/** The VoiceTile overlay: draws the tile owner's animal, if they have one and this screen shows effects. */
export function AnimalOverlay({ person, video, mirrored }: TileOverlayContext) {
  const effect = useAnimal((s) => s.effects[person.id]);
  const hidden = useAnimal((s) => s.hidden);
  const { reset } = useAnimalActions();
  if (!effect || hidden || !video) return null;
  return (
    <div className={`animal-overlay ${person.local ? "has-shake" : ""}`}>
      <FaceCanvas key={effect.id} video={video} animal={effect.animal} mirrored={mirrored} />
      <TrackerChip effect={effect} />
      {person.local && (
        <button type="button" className="animal-shake sm" onClick={() => reset(effect)} title={`Applied by ${effect.byName}`}>
          Shake it off
        </button>
      )}
    </div>
  );
}
