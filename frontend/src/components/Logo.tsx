import { Link } from "react-router-dom";

/** Brand mark: a Cinematic Red screen outline framing a rounded play triangle, plus the wordmark. */
export function Logo({ size = 28, link = true }: { size?: number; link?: boolean }) {
  const mark = (
    <>
      <svg viewBox="0 0 34 22" width="1.55em" height="1em" aria-hidden="true">
        <rect x="1.1" y="1.1" width="31.8" height="19.8" rx="3.6" fill="none" stroke="#D1495B" strokeWidth="2.2" />
        <path
          d="M14.4 8.3v5.4a1 1 0 0 0 1.5.86l4.4-2.7a1 1 0 0 0 0-1.72l-4.4-2.7A1 1 0 0 0 14.4 8.3z"
          fill="#D1495B"
          stroke="#D1495B"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      <span>WellPlayed</span>
    </>
  );
  return link ? (
    <Link to="/" className="logo" style={{ fontSize: size }} aria-label="WellPlayed home">
      {mark}
    </Link>
  ) : (
    <span className="logo" style={{ fontSize: size }}>
      {mark}
    </span>
  );
}
