import { create } from "zustand";

import { usePlayback } from "../../lib/playback-store";
import { usePrefs } from "../../lib/prefs";

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const useCues = create<{ cues: Cue[]; error: string; set: (cues: Cue[], error?: string) => void }>((set) => ({
  cues: [],
  error: "",
  set: (cues, error = "") => set({ cues, error }),
}));

export function SubtitleOverlay() {
  const position = usePlayback((s) => s.position);
  const cues = useCues((s) => s.cues);
  const size = usePrefs((s) => s.subtitleSize);
  const cue = cues.find((c) => position >= c.start && position < c.end);
  if (!cue) return null;
  return (
    <div className="subtitle" style={{ fontSize: size }}>
      <span>{cue.text}</span>
    </div>
  );
}
