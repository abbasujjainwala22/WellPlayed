import { useEffect, useState, type ReactNode } from "react";

import { PartyDoodle } from "./PartyDoodle";
import "./personality.css";

/** The in-app "Reduce motion" setting (html.reduce-motion) or the OS preference. */
export function prefersReducedMotion(): boolean {
  return (
    document.documentElement.classList.contains("reduce-motion") || !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

const PREFIX = "wp:celebrated:";
const COLORS = ["var(--brand)", "var(--violet)", "var(--warning)", "var(--success)", "var(--grad-start)"];
const PIECES = Array.from({ length: 18 }, (_, i) => ({
  left: 3 + ((i * 37) % 94),
  delay: (i % 6) * 0.12,
  color: COLORS[i % COLORS.length],
  spin: i % 2 ? 1 : -1,
  wide: i % 3 === 0,
}));

/** True once per `key` in this tab: the first time it is seen, it is marked in sessionStorage. */
function claim(key: string): boolean {
  try {
    if (sessionStorage.getItem(PREFIX + key)) return false;
    sessionStorage.setItem(PREFIX + key, "1");
  } catch {
    /* storage unavailable: celebrate anyway */
  }
  return true;
}

/**
 * A celebratory banner with a short burst of CSS confetti. The burst plays once per `eventKey` per tab
 * (so re-opening a panel doesn't replay it) and never under reduced motion; the banner itself always shows.
 */
export function PartyCelebration({ eventKey, children, className = "" }: { eventKey: string; children: ReactNode; className?: string }) {
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!eventKey || !claim(eventKey) || prefersReducedMotion()) return;
    setBurst(true);
  }, [eventKey]);

  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(false), 3200);
    return () => window.clearTimeout(t);
  }, [burst]);

  return (
    <div className={`party-celebration ${className}`}>
      <PartyDoodle kind="confetti" className="party-celebration-doodle left" />
      <PartyDoodle kind="confetti" className="party-celebration-doodle right" />
      {burst && (
        <span className="party-confetti" aria-hidden="true">
          {PIECES.map((p, i) => (
            <i
              key={i}
              className={p.wide ? "wide" : ""}
              style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, background: p.color, ["--spin" as string]: p.spin }}
            />
          ))}
        </span>
      )}
      <p role="status">{children}</p>
    </div>
  );
}
