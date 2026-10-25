import { Clapperboard, Compass, type LucideIcon, Settings, Sparkles, Trophy } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  /** Shorter label for the mobile bottom bar. */
  short?: string;
  icon: LucideIcon;
  /** Match the path exactly (needed for "/"). */
  end?: boolean;
  /** Display position, so new pages can be appended to the list in any order. */
  order: number;
}

/**
 * Main navigation for the app shell (top nav on desktop, bottom bar on phones, 2–5 items).
 * To add a page, append one entry, e.g.
 *   { to: "/discover", label: "Discover", icon: Compass, order: 10 }
 *   { to: "/ai", label: "Reely AI", short: "Reely", icon: Sparkles, order: 30 }
 *   { to: "/hall-of-fame", label: "Hall of Fame", short: "Fame", icon: Trophy, order: 40 }
 */
const ITEMS: NavItem[] = [
  { to: "/", label: "Watch Party", short: "Party", icon: Clapperboard, end: true, order: 20 },
  { to: "/discover", label: "Discover", icon: Compass, order: 10 },
  { to: "/ai", label: "Reely AI", short: "Reely", icon: Sparkles, order: 30 },
  { to: "/hall-of-fame", label: "Hall of Fame", short: "Fame", icon: Trophy, order: 40 },
  { to: "/settings", label: "Settings", icon: Settings, order: 90 },
];

export const NAV: NavItem[] = [...ITEMS].sort((a, b) => a.order - b.order);
