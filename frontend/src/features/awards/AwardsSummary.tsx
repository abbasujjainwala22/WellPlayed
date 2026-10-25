import { Award as AwardIcon, Medal, Star, Trophy } from "lucide-react";
import type { ReactNode } from "react";

import "./awards.css";
import type { Award, ReviewSummary } from "./history";

// Gold, silver, bronze; the rest get a plain rosette. The potato keeps its potato: it is the joke.
const MEDALS = [
  <Trophy key="gold" size={24} color="var(--warning)" />,
  <Medal key="silver" size={24} color="var(--muted)" />,
  <Medal key="bronze" size={24} color="var(--brand-hover)" />,
];

function medalFor(award: Award, index: number): ReactNode {
  if (award.id === "potato") return "🥔";
  return MEDALS[index] ?? <AwardIcon size={24} color="var(--violet)" />;
}

function names(winners: Award["winners"]): string {
  const n = winners.map((w) => w.name);
  return n.length <= 2 ? n.join(" & ") : `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
}

export function AwardCard({ award, rank, delay }: { award: Award; rank: number; delay?: number }) {
  return (
    <article
      className={`award-card ${award.kind === "peer" ? "peer" : ""}`}
      style={delay !== undefined ? { animationDelay: `${delay}ms` } : undefined}
    >
      <span className="award-rank" aria-hidden="true">
        {rank}
      </span>
      <span className="award-medal" aria-hidden="true">
        {medalFor(award, rank - 1)}
      </span>
      <div className="award-emoji" aria-hidden="true">
        {award.emoji}
      </div>
      <h3 className="award-name">{award.name}</h3>
      <p className="award-blurb">{award.blurb}</p>
      <p className="award-winner">
        <span className="sr-only">Won by </span>
        {names(award.winners)}
      </p>
      <p className="award-stat">
        {award.kind === "peer" && <span className="tag violet">Voted by the room</span>}
        <span>{award.stat}</span>
      </p>
    </article>
  );
}

export function Stars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="award-stars" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= Math.round(value) ? "on" : ""} />
      ))}
    </span>
  );
}

export function ReviewBlock({ review }: { review: ReviewSummary }) {
  if (!review.count || review.avg === null) return null;
  return (
    <div className="award-review">
      <div className="award-review-head">
        <strong className="award-review-avg">{review.avg.toFixed(1)}</strong>
        <div>
          <Stars value={review.avg} />
          <div className="faint">
            {review.count} {review.count === 1 ? "review" : "reviews"} from the room
          </div>
        </div>
      </div>
      {review.takes && review.takes.length > 0 && (
        <ul className="award-takes">
          {review.takes.map((t, i) => (
            <li key={i}>
              <q>{t.take}</q>
              <span className="faint">
                {t.name} · <Stars value={t.stars} size={12} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Award cards (rank numeral, medal, name, blurb, winner, stat) plus the room's review, if any. */
export function AwardsSummary({
  awards,
  review,
  animate = false,
  compact = false,
}: {
  awards: Award[];
  review?: ReviewSummary;
  /** Stagger the cards in, for the live reveal. Disabled under reduced motion. */
  animate?: boolean;
  /** Single column, for the narrow sidebar. */
  compact?: boolean;
}) {
  return (
    <div className={`awards-summary ${animate ? "animate" : ""}`}>
      {awards.length === 0 ? (
        <p className="muted">Nobody earned an award this time. React, chat and play predictions next party to get on the board.</p>
      ) : (
        <div className={`award-grid ${compact ? "compact" : ""}`}>
          {awards.map((a, i) => (
            <AwardCard key={a.id} award={a} rank={i + 1} delay={animate ? 250 + i * 180 : undefined} />
          ))}
        </div>
      )}
      {review && <ReviewBlock review={review} />}
    </div>
  );
}
