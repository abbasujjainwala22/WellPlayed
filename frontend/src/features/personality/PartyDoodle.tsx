import type { ReactNode } from "react";

/** Hand-drawn style party doodles. Stroke and tint follow `currentColor`, so callers colour them with tokens. */
const ART = {
  popcorn: (
    <>
      <path d="M18 30h28l-4 26H22z" fill="currentColor" fillOpacity=".12" />
      <path d="M18 30h28l-4 26H22zM27 31l1.5 24M37 31l-1.5 24" />
      <path d="M17 30a6 6 0 0 1 5-9 7 7 0 0 1 11-5 6 6 0 0 1 10 2 6 6 0 0 1 4 12" />
      <path d="M26 21a4 4 0 0 1 6 2M37 19a4 4 0 0 1 4 4" />
    </>
  ),
  ticket: (
    <>
      <path d="M8 20h48v8a4 4 0 0 0 0 8v8H8v-8a4 4 0 0 0 0-8z" fill="currentColor" fillOpacity=".1" />
      <path d="M8 20h48v8a4 4 0 0 0 0 8v8H8v-8a4 4 0 0 0 0-8z" />
      <path d="M43 21v22" strokeDasharray="3 3" />
      <path d="M15 28h20M15 36h13" />
    </>
  ),
  clapper: (
    <>
      <path d="M10 28h44v26H10z" fill="currentColor" fillOpacity=".1" />
      <path d="M10 28h44v26H10zM9 18l42-8 2 9-42 8z" />
      <path d="M19 16l6 9M30 14l6 9M41 12l6 9M17 38h24M17 45h15" />
    </>
  ),
  trophy: (
    <>
      <path d="M22 10h20v14a10 10 0 0 1-20 0z" fill="currentColor" fillOpacity=".12" />
      <path d="M22 10h20v14a10 10 0 0 1-20 0zM22 14h-7v4a8 8 0 0 0 8 8M42 14h7v4a8 8 0 0 1-8 8M32 34v10M26 44h12v8H26zM22 52h20" />
    </>
  ),
  confetti: (
    <>
      <path d="M10 14l5 5M41 8l-2 7M52 31l6-1M14 48l-3 6M36 41l6 6M48 52l3 4M27 9v5" />
      <path d="M13 32l5-2 2 5-5 2zM30 15l3-4 4 3-3 4zM45 22l5 1-1 5-5-1zM24 50l4-3 3 4-4 3z" fill="currentColor" />
      <circle cx="33" cy="30" r="2" fill="currentColor" />
    </>
  ),
  reel: (
    <>
      <circle cx="30" cy="30" r="21" fill="currentColor" fillOpacity=".1" />
      <circle cx="30" cy="30" r="21" />
      <circle cx="30" cy="30" r="3.5" />
      <circle cx="30" cy="17" r="5" />
      <circle cx="43" cy="30" r="5" />
      <circle cx="30" cy="43" r="5" />
      <circle cx="17" cy="30" r="5" />
      <path d="M38 50c6 3 13 3 20 0" />
    </>
  ),
  star: (
    <path
      d="M32 7l7 15 16 2-12 11 3 17-14-8-14 8 3-17L9 24l16-2z"
      fill="currentColor"
      fillOpacity=".12"
    />
  ),
  glasses: (
    <>
      <path d="M9 26h18v13a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3z" fill="currentColor" fillOpacity=".28" />
      <path d="M37 26h18v13a3 3 0 0 1-3 3H40a3 3 0 0 1-3-3z" fill="currentColor" fillOpacity=".1" />
      <path d="M9 26h18v13a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3zM37 26h18v13a3 3 0 0 1-3 3H40a3 3 0 0 1-3-3zM27 30q5-4 10 0M9 26l-4-7M55 26l4-7" />
    </>
  ),
  soda: (
    <>
      <path d="M20 22h24l-3 34H23z" fill="currentColor" fillOpacity=".12" />
      <path d="M20 22h24l-3 34H23zM18 17h28v5H18zM34 17l4-11h6M21.5 37q5-4 10.5 0t10.5 0" />
    </>
  ),
  play: (
    <>
      <rect x="11" y="13" width="42" height="38" rx="9" fill="currentColor" fillOpacity=".1" />
      <rect x="11" y="13" width="42" height="38" rx="9" />
      <path d="M28 24l12 8-12 8z" />
    </>
  ),
  sparkle: (
    <path
      d="M32 8c2 16 6 20 22 24-16 4-20 8-22 24-2-16-6-20-22-24 16-4 20-8 22-24z"
      fill="currentColor"
      fillOpacity=".14"
    />
  ),
  crown: (
    <>
      <path d="M10 46l4-26 10 12 8-18 8 18 10-12 4 26z" fill="currentColor" fillOpacity=".18" />
      <path d="M10 46l4-26 10 12 8-18 8 18 10-12 4 26zM12 53h40" />
      <circle cx="32" cy="38" r="2.5" fill="currentColor" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type DoodleKind = keyof typeof ART;

export function PartyDoodle({ kind, className = "", size }: { kind: DoodleKind; className?: string; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`doodle ${className}`}
    >
      {ART[kind]}
    </svg>
  );
}
