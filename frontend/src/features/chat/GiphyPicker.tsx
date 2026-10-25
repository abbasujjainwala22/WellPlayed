import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { loadSession } from "../../lib/api";
import { useRoom } from "../../lib/room-context";
import { browseGiphy, safeMediaUrl, useReducedMotion, type GiphyItem } from "./giphy";

/** Trending or searched GIFs/stickers from our server's GIPHY proxy. Picking one sends it. */
export function GiphyPicker({ kind, onSend }: { kind: "gif" | "sticker"; onSend: (item: GiphyItem) => void }) {
  const { room } = useRoom();
  const reduce = useReducedMotion();
  const noun = kind === "gif" ? "GIFs" : "stickers";
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<GiphyItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const req = useRef<AbortController | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const load = (offset: number) => {
    req.current?.abort();
    const ctl = new AbortController();
    req.current = ctl;
    setBusy(true);
    setError("");
    browseGiphy(room.code, loadSession(room.code)?.token ?? "", kind, q, offset, ctl.signal)
      .then((page) => {
        if (ctl.signal.aborted) return;
        setItems((old) => (offset ? [...old, ...page.items.filter((i) => !old.some((o) => o.id === i.id))] : page.items));
        setNext(page.next);
      })
      .catch((e: Error) => {
        if (!ctl.signal.aborted) setError(e.message || `Couldn't load ${noun}.`);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setBusy(false);
      });
  };

  useEffect(() => {
    setItems([]);
    setNext(null);
    load(0);
    return () => req.current?.abort();
  }, [kind, q, attempt]);

  return (
    <div className="giphy-picker">
      <label className="picker-search">
        <Search size={15} aria-hidden />
        <input
          type="search"
          placeholder={`Search GIPHY ${noun}`}
          aria-label={`Search GIPHY ${noun}`}
          maxLength={50}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setQ(query.trim());
            }
          }}
        />
      </label>
      <div className="emoji-heading" aria-live="polite">
        {q ? `${kind === "gif" ? "GIFs" : "Stickers"} for “${q}”` : `Trending ${noun}`}
      </div>
      <div className={`giphy-grid ${kind}`} aria-busy={busy} aria-label={q ? `GIPHY ${noun} for ${q}` : `Trending ${noun}`} role="group">
        {items.map((item) => {
          const src = safeMediaUrl(reduce ? item.previewStill : item.preview);
          return (
            <button key={item.id} type="button" title={item.title} aria-label={`Send ${kind === "gif" ? "GIF" : "sticker"}: ${item.title}`} onClick={() => onSend(item)}>
              {src && <img src={src} alt="" loading="lazy" decoding="async" />}
            </button>
          );
        })}
        {busy && !items.length && Array.from({ length: 6 }, (_, i) => <span key={i} className="giphy-skeleton" aria-hidden />)}
      </div>
      {busy && <p className="picker-note" role="status">Loading {noun}…</p>}
      {error && (
        <p className="picker-note error" role="alert">
          {error}{" "}
          <button type="button" className="link" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </p>
      )}
      {!busy && !error && !items.length && <p className="picker-note">No {noun} found. Try another word.</p>}
      {next !== null && !busy && items.length > 0 && (
        <button type="button" className="sm block" onClick={() => load(next)}>
          Load more
        </button>
      )}
      <a className="giphy-attribution" href="https://giphy.com" target="_blank" rel="noopener noreferrer">
        Powered by <strong>GIPHY</strong>
      </a>
    </div>
  );
}
