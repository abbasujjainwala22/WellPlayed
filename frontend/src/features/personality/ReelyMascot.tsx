import type { ReactNode } from "react";

import "./personality.css";

export type ReelyMood = "happy" | "thinking" | "celebrating";

/** Sprocket holes around the reel, clear of the face. */
const HOLES: [number, number][] = [
  [60, 27],
  [86.8, 42.5],
  [33.2, 42.5],
  [86.8, 73.5],
  [33.2, 73.5],
  [60, 89],
];

function Face({ mood }: { mood: ReelyMood }) {
  if (mood === "celebrating")
    return (
      <>
        <path className="mascot-line" d="M41 57q6-8 12 0M67 57q6-8 12 0" />
        <path className="mascot-ink" d="M50 66q10 15 20 0z" />
        <ellipse className="mascot-tongue" cx="60" cy="71.5" rx="4.5" ry="2.4" />
      </>
    );
  const look = mood === "thinking" ? [2, -2.5] : [1, 1];
  return (
    <>
      <circle className="mascot-white" cx="47" cy="55" r="7" />
      <circle className="mascot-white" cx="73" cy="55" r="7" />
      <circle className="mascot-ink" cx={47 + look[0]} cy={55 + look[1]} r="3.6" />
      <circle className="mascot-ink" cx={73 + look[0]} cy={55 + look[1]} r="3.6" />
      <circle className="mascot-white" cx={48.4 + look[0]} cy={53.6 + look[1]} r="1.2" />
      <circle className="mascot-white" cx={74.4 + look[0]} cy={53.6 + look[1]} r="1.2" />
      {mood === "thinking" ? (
        <>
          <path className="mascot-line thin" d="M66 43q7-5 14-1" />
          <path className="mascot-line" d="M53 70q4-3 7 0t7 0" />
        </>
      ) : (
        <path className="mascot-line" d="M51 67q9 9 18 0" />
      )}
    </>
  );
}

function Arms({ mood }: { mood: ReelyMood }) {
  if (mood === "celebrating")
    return (
      <>
        <path className="mascot-arm" d="M25 46q-9-8-12-22M95 46q9-8 12-22" />
        <circle className="mascot-hand" cx="13" cy="23" r="4.5" />
        <circle className="mascot-hand" cx="107" cy="23" r="4.5" />
        <g className="mascot-confetti">
          <rect x="4" y="6" width="5" height="3" rx="1" transform="rotate(-25 6 7)" fill="var(--warning)" />
          <rect x="108" y="4" width="5" height="3" rx="1" transform="rotate(30 110 5)" fill="var(--violet)" />
          <rect x="30" y="4" width="4" height="3" rx="1" transform="rotate(15 32 5)" fill="var(--success)" />
          <rect x="88" y="12" width="4" height="3" rx="1" transform="rotate(-20 90 13)" fill="var(--warning)" />
          <circle cx="22" cy="12" r="1.8" fill="var(--violet)" />
          <circle cx="98" cy="2.5" r="1.8" fill="var(--success)" />
        </g>
      </>
    );
  if (mood === "thinking")
    return (
      <>
        <path className="mascot-arm" d="M23 68q-9 6-11 15M97 70q4 12-21 11" />
        <circle className="mascot-hand" cx="12" cy="84" r="4.5" />
        <circle className="mascot-hand" cx="74" cy="81" r="4.5" />
        <circle cx="103" cy="22" r="2.6" fill="var(--violet)" opacity=".75" />
        <circle cx="110" cy="11" r="4" fill="var(--violet)" opacity=".75" />
      </>
    );
  return (
    <>
      <path className="mascot-arm" d="M23 68q-9 6-11 15M97 52q9-6 11-18" />
      <circle className="mascot-hand" cx="12" cy="84" r="4.5" />
      <circle className="mascot-hand wave" cx="108" cy="33" r="4.5" />
    </>
  );
}

/**
 * Reely, WellPlayed's film-reel host, drawn inline so it follows the theme tokens.
 * Decorative by default; pass `label` when the mascot carries meaning on its own.
 */
export function ReelyMascot({ mood = "happy", size = 96, label, className = "" }: { mood?: ReelyMood; size?: number; label?: string; className?: string }) {
  return (
    <svg
      className={`mascot ${mood} ${className}`}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}
    >
      <ellipse className="mascot-shadow" cx="60" cy="113" rx="28" ry="4" />
      <g className="mascot-body">
        <path className="mascot-strip" d="M82 88c13 13 25 10 30-4" />
        <path className="mascot-strip-holes" d="M82 88c13 13 25 10 30-4" />
        <ellipse className="mascot-foot" cx="47" cy="101" rx="9" ry="5" />
        <ellipse className="mascot-foot" cx="73" cy="101" rx="9" ry="5" />
        <circle className="mascot-reel" cx="60" cy="58" r="40" />
        <circle className="mascot-ring" cx="60" cy="58" r="34" />
        {HOLES.map(([x, y]) => (
          <circle key={`${x}-${y}`} className="mascot-hole" cx={x} cy={y} r="4.5" />
        ))}
        <ellipse className="mascot-cheek" cx="39" cy="65" rx="4" ry="2.5" />
        <ellipse className="mascot-cheek" cx="81" cy="65" rx="4" ry="2.5" />
        <Face mood={mood} />
        <Arms mood={mood} />
      </g>
    </svg>
  );
}

/** Reely with a speech bubble. The words are real text, so screen readers read them; the drawing is hidden. */
export function ReelyAside({
  children,
  mood = "happy",
  size = 72,
  className = "",
}: {
  children: ReactNode;
  mood?: ReelyMood;
  size?: number;
  className?: string;
}) {
  return (
    <div className={`mascot-aside ${className}`}>
      <ReelyMascot mood={mood} size={size} />
      <p className="speech">{children}</p>
    </div>
  );
}
