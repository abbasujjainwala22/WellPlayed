import { create } from "zustand";

/** Latest local playback position, shared by features that need media time. */
export const usePlayback = create<{
  position: number;
  driftMs: number;
  /** True once a local player is feeding real positions (false on a companion phone). */
  active: boolean;
  set: (position: number, driftMs: number) => void;
}>((set) => ({
  position: 0,
  driftMs: 0,
  active: false,
  set: (position, driftMs) => set({ position, driftMs, active: true }),
}));
