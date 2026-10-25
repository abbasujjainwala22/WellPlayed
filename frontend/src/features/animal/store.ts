import { useEffect } from "react";
import { create } from "zustand";

import { toast } from "../../components/ui";
import { useRoom } from "../../lib/room-context";
import { type AnimalId, animalInfo, withArticle } from "./animals";

/** Shared transformation state from the server. Never frames or landmarks. */
export interface AnimalEffect {
  id: string;
  targetId: string;
  targetName: string;
  animal: AnimalId;
  byId: string;
  byName: string;
  version: number;
  createdMs: number;
  /** Set while the target's connection is gone; the effect is kept for the grace period. */
  missingSinceMs: number | null;
}

interface Change {
  kind: "apply" | "reset" | "expired" | "left";
  effect: AnimalEffect;
  byId?: string;
}

interface AnimalState {
  effects: Record<string, AnimalEffect>;
  graceSeconds: number;
  /** Local preference: don't draw anyone's animal on this screen. */
  hidden: boolean;
  dialogOpen: boolean;
  /** "Someone turned you into …" card for the target. */
  notice: AnimalEffect | null;
  setHidden: (hidden: boolean) => void;
  setDialogOpen: (open: boolean) => void;
  dismissNotice: () => void;
}

const HIDE_KEY = "wp:animal-hidden";

const readHidden = () => {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
};

export const useAnimal = create<AnimalState>((set) => ({
  effects: {},
  graceSeconds: 60,
  hidden: readHidden(),
  dialogOpen: false,
  notice: null,
  setHidden(hidden) {
    set({ hidden });
    try {
      localStorage.setItem(HIDE_KEY, hidden ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  },
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
  dismissNotice: () => set({ notice: null }),
}));

/** Keeps the effect list in sync with the room. Mount once, always (it lives in the camera strip). */
export function useAnimalSetup(): void {
  const { socket, me } = useRoom();
  useEffect(
    () =>
      socket.on("animal:state", (d: { effects: AnimalEffect[]; graceSeconds: number; change: Change | null }) => {
        const effects = Object.fromEntries(d.effects.map((e) => [e.targetId, e]));
        const { notice } = useAnimal.getState();
        const change = d.change;
        let next = notice && effects[notice.targetId]?.id === notice.id ? notice : null;
        if (change?.kind === "apply") {
          const e = change.effect;
          const name = withArticle(animalInfo(e.animal).name);
          if (e.targetId === me.id && e.byId !== me.id) next = e;
          else if (e.byId === me.id) toast(e.targetId === me.id ? `You’re ${name} now` : `${e.targetName} is ${name} now`, "info");
        } else if (change?.kind === "reset" && change.effect.targetId === me.id && change.byId !== me.id) {
          toast("Your animal was reset", "info");
        }
        useAnimal.setState({ effects, graceSeconds: d.graceSeconds, notice: next });
      }),
    [socket, me.id],
  );
}

export function useAnimalActions() {
  const { socket } = useRoom();
  return {
    apply: (targetId: string, animal: AnimalId, announce: boolean) => socket.send("animal:apply", { targetId, animal, announce }),
    reset: (effect: AnimalEffect) => socket.send("animal:reset", { targetId: effect.targetId, version: effect.version }),
  };
}

export const prefersReducedMotion = () =>
  document.documentElement.classList.contains("reduce-motion") || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
