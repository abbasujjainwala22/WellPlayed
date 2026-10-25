import { Film, Trash2, Tv } from "lucide-react";
import { useState } from "react";

import type { Rec } from "./recs-api";

// sized in em so the icon follows .rec-tile-emoji's font size
const KIND_ICON = { movie: <Film size="1em" strokeWidth={1.5} />, series: <Tv size="1em" strokeWidth={1.5} /> } as const;

function tileVariant(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 4;
}

export function RecCard({
  rec,
  demo = false,
  emoji,
  featured = false,
  onVote,
  onDelete,
}: {
  rec: Rec;
  demo?: boolean;
  emoji?: string;
  /** The newest pick: a wider card with a "Fresh pick" ribbon. */
  featured?: boolean;
  onVote?: (option: number) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [localVote, setLocalVote] = useState<number | null>(null); // demo only, never sent anywhere
  const [posterFailed, setPosterFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const myVote = demo ? localVote : rec.myVote;
  const counts = rec.counts.map((c, i) => c + (demo && localVote === i ? 1 : 0));
  const total = counts.reduce((a, b) => a + b, 0);
  const voted = myVote !== null && myVote !== undefined;
  const meta = [rec.genre, rec.year].filter(Boolean).join(" · ");

  const run = async (fn?: () => Promise<void>) => {
    if (!fn) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const vote = (i: number) => (demo ? setLocalVote(i) : void run(onVote && (() => onVote(i))));

  return (
    <article className={featured ? "rec-card featured" : "rec-card"}>
      <div className="rec-art">
        {rec.poster_url && !posterFailed ? (
          <img
            src={rec.poster_url}
            alt={`${rec.title} poster`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setPosterFailed(true)}
          />
        ) : (
          <div className={`rec-tile v${tileVariant(rec.id)}`} aria-hidden="true">
            <span className="rec-tile-emoji">{emoji ?? KIND_ICON[rec.kind]}</span>
            <span className="rec-tile-title">{rec.title}</span>
          </div>
        )}
        <span className="rec-kind">{rec.kind}</span>
        {featured && <span className="rec-fresh">Fresh pick</span>}
        {demo && <span className="rec-demo">DEMO</span>}
      </div>

      <div className="rec-body">
        <div className="rec-head">
          <h3 className="rec-title">{rec.title}</h3>
          {rec.mine && onDelete && (
            <button
              className="ghost icon sm danger"
              aria-label={`Delete your recommendation ${rec.title}`}
              title="Delete"
              disabled={busy}
              onClick={() => window.confirm(`Delete “${rec.title}”?`) && void run(onDelete)}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
        <p className="rec-meta">
          {meta}
          {!demo && `${meta ? " · " : ""}by ${rec.submitted_by_name}`}
        </p>
        {rec.description && <p className="rec-desc">{rec.description}</p>}

        {rec.poll_question && rec.poll_options.length > 0 && (
          <div className="rec-poll">
            <p className="rec-q">{rec.poll_question}</p>
            {rec.poll_options.map((o, i) => {
              const pct = total ? Math.round((counts[i] / total) * 100) : 0;
              return (
                <button
                  key={o}
                  className={`opt rec-opt ${myVote === i ? "mine" : ""}`}
                  disabled={voted || busy}
                  onClick={() => vote(i)}
                  style={voted ? { backgroundSize: `${pct}% 100%` } : undefined}
                >
                  <span>{o}</span>
                  {voted && <strong>{pct}%</strong>}
                </button>
              );
            })}
            <p className="faint">
              {voted
                ? `${total} ${demo ? "sample votes (not real)" : total === 1 ? "vote" : "votes"}`
                : demo
                  ? "Tap an answer to try it. Demo votes stay on this device."
                  : "Vote to see the results."}
            </p>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </article>
  );
}
