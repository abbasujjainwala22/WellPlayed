import { Clapperboard, GraduationCap, Headphones, Trophy, type LucideIcon } from "lucide-react";

import type { Mode } from "./types";

export const MODES: Record<Mode, { label: string; icon: LucideIcon; blurb: string; long: string }> = {
  movie: {
    label: "Movie night",
    icon: Clapperboard,
    blurb: "Households, swipe voting, coverage planning",
    long: "Sync whole households, vote on what to watch and need fewer subscriptions.",
  },
  study: {
    label: "Study",
    icon: GraduationCap,
    blurb: "Lectures, quiz breaks, AI notes",
    long: "Work through lectures together with quiz breaks and AI notes.",
  },
  sports: {
    label: "Sports",
    icon: Trophy,
    blurb: "Spoiler-safe live sync, predictions",
    long: "Everyone sees the goal at the same moment. No spoilers from a friend’s cheer.",
  },
  hangout: {
    label: "Hangout",
    icon: Headphones,
    blurb: "Shared queue, audio-first",
    long: "A shared queue in the background, with friends front and centre.",
  },
};

export const MODE_ORDER: Mode[] = ["movie", "study", "sports", "hangout"];
