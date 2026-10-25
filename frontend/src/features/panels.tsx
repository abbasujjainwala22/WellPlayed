import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";

import type { Mode } from "../lib/types";
import { aiPanel } from "./ai/AiPanel";
import { reelyPanel } from "./aihost/ReelyPanel";
import { awardsPanel } from "./awards/AwardsPanel";
import { chatPanel } from "./chat/ChatPanel";
import { moviePanel } from "./movie/MoviePanel";
import { peoplePanel } from "./people/PeoplePanel";
import { pollsPanel } from "./polls/PollsPanel";
import { hangoutPanel } from "./hangout/HangoutPanel";
import { sportsPanel } from "./sports/SportsPanel";
import { wellbeingPanel } from "./wellbeing/WellbeingPanel";
import { networkPanel } from "./network/NetworkPanel";
import { heatmapPanel } from "./reactions/HeatmapPanel";
import { subtitlesPanel } from "./subtitles/SubtitlePanel";

export interface Panel {
  id: string;
  title: string;
  /** Shorter label for the narrow sidebar rail. */
  short?: string;
  icon: LucideIcon;
  /** One line under the panel title explaining what it is for. */
  description?: string;
  component: ComponentType;
  /** Optional always-mounted hook (socket listeners that must outlive tab switches). */
  useSetup?: () => void;
  /** Show only in these modes (default: all). */
  modes?: Mode[];
  /** Also offered on the companion phone. */
  companion?: boolean;
  /** "tools" panels sit below the divider in the sidebar rail. */
  group?: "tools";
  /** The panel manages its own padding and scrolling (chat). */
  flush?: boolean;
}

/** Sidebar tabs, in display order. Each feature appends its panel here. */
export const panels: Panel[] = [
  chatPanel,
  peoplePanel,
  moviePanel,
  sportsPanel,
  hangoutPanel,
  pollsPanel,
  reelyPanel,
  awardsPanel,
  aiPanel,
  wellbeingPanel,
  subtitlesPanel,
  heatmapPanel,
  networkPanel,
];
