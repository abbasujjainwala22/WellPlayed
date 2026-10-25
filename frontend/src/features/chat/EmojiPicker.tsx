import { Clock, Flag, Hand, Hash, Lightbulb, PawPrint, Pizza, Plane, Search, Smile, Volleyball, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { GROUPS, TONES, getRecent, getTone, loadEmoji, pushRecent, saveTone, withTone, type Emoji } from "./emoji";

const COLS = 8;
const RECENT = -1;
const ICONS: LucideIcon[] = [Smile, Hand, PawPrint, Pizza, Volleyball, Plane, Lightbulb, Hash, Flag];
const TONE_SAMPLE: Emoji = { emoji: "✋", label: "raised hand", group: 1, search: "", skins: 1 };

/** Emoji search, categories, recents and skin tone. Arrow keys move through the grid. */
export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [data, setData] = useState<Emoji[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState(getRecent);
  const [cat, setCat] = useState(() => (getRecent().length ? RECENT : 0));
  const [tone, setTone] = useState(getTone);
  const [toneOpen, setToneOpen] = useState(false);
  const [preview, setPreview] = useState<Emoji | null>(null);
  const [active, setActive] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    loadEmoji()
      .then((rows) => live && setData(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [attempt]);

  const byEmoji = useMemo(() => new Map((data ?? []).map((e) => [e.emoji, e])), [data]);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!data) return [];
    if (q) {
      const terms = q.split(/\s+/);
      return data.filter((e) => e.emoji === q || terms.every((t) => e.search.includes(t))).slice(0, 240);
    }
    if (cat === RECENT) return recent.map((b) => byEmoji.get(b)).filter((e): e is Emoji => !!e);
    return data.filter((e) => e.group === cat);
  }, [data, q, cat, recent, byEmoji]);

  useEffect(() => {
    setActive(0);
    grid.current?.scrollTo?.({ top: 0 });
  }, [q, cat]);

  const pick = (e: Emoji) => {
    onPick(withTone(e, tone));
    pushRecent(e.emoji); // the Recent tab refreshes next time it's opened, so nothing jumps under the cursor
  };

  const focusCell = (i: number) => {
    const cells = grid.current?.querySelectorAll<HTMLButtonElement>("button[data-cell]");
    if (!cells?.length) return;
    const n = Math.max(0, Math.min(cells.length - 1, i));
    setActive(n);
    cells[n].focus();
  };

  const onGridKey = (ev: KeyboardEvent<HTMLDivElement>) => {
    const i = Number((ev.target as HTMLElement).dataset.cell);
    if (Number.isNaN(i)) return;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS };
    if (ev.key === "ArrowUp" && i < COLS) {
      ev.preventDefault();
      searchRef.current?.focus();
    } else if (ev.key in moves) {
      ev.preventDefault();
      focusCell(i + moves[ev.key]);
    } else if (ev.key === "Home" || ev.key === "End") {
      ev.preventDefault();
      focusCell(ev.key === "Home" ? 0 : shown.length - 1);
    }
  };

  const chooseTone = (t: number) => {
    setTone(t);
    saveTone(t);
    setToneOpen(false);
  };


  return (
    <div className="emoji-picker">
      <label className="picker-search">
        <Search size={15} aria-hidden />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search emoji"
          aria-label="Search emoji"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              focusCell(0);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (shown[0]) pick(shown[0]);
            }
          }}
        />
      </label>

      <div className="emoji-cats" aria-label="Emoji categories">
        <button
          type="button"
          className={`ghost icon sm ${cat === RECENT && !q ? "on" : ""}`}
          aria-pressed={cat === RECENT && !q}
          aria-label="Recently used"
          title="Recently used"
          onClick={() => {
            setRecent(getRecent());
            setCat(RECENT);
            setQuery("");
          }}
        >
          <Clock size={16} />
        </button>
        {GROUPS.map((g, i) => {
          const Icon = ICONS[i];
          return (
            <button
              key={g}
              type="button"
              className={`ghost icon sm ${cat === i && !q ? "on" : ""}`}
              aria-pressed={cat === i && !q}
              aria-label={g}
              title={g}
              onClick={() => {
                setCat(i);
                setQuery("");
              }}
            >
              <Icon size={16} />
            </button>
          );
        })}
      </div>

      <div className="emoji-heading" aria-live="polite">
        {q ? (shown.length ? `Results for “${query.trim()}”` : "") : cat === RECENT ? "Recently used" : GROUPS[cat]}
      </div>
      <div className="emoji-grid" ref={grid} role="group" aria-label={q ? "Emoji search results" : cat === RECENT ? "Recently used emoji" : `${GROUPS[cat]} emoji`} onKeyDown={onGridKey}>
        {shown.map((e, i) => {
          const glyph = withTone(e, tone);
          return (
            <button
              key={e.emoji}
              type="button"
              data-cell={i}
              tabIndex={i === active ? 0 : -1}
              aria-label={e.label}
              title={e.label}
              onClick={() => pick(e)}
              onMouseEnter={() => setPreview(e)}
              onMouseLeave={() => setPreview(null)}
              onBlur={() => setPreview(null)}
              onFocus={() => (setActive(i), setPreview(e))}
            >
              {glyph}
            </button>
          );
        })}
      </div>
      {!data && !failed && <p className="picker-note" role="status">Loading emoji…</p>}
      {failed && (
        <p className="picker-note" role="alert">
          Couldn't load emoji.{" "}
          <button type="button" className="link" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </p>
      )}
      {data && !shown.length && <p className="picker-note">{q ? "No emoji match that search." : "Emoji you use will show up here."}</p>}

      <div className="emoji-foot">
        <div className="emoji-preview" aria-hidden>
          {preview ? (
            <>
              <span className="glyph">{withTone(preview, tone)}</span>
              <span className="label">{preview.label}</span>
            </>
          ) : (
            <span className="label">Pick an emoji</span>
          )}
        </div>
        <div className="emoji-tones">
          {toneOpen ? (
            <div role="radiogroup" aria-label="Skin tone" className="tone-options">
              {TONES.map((name, t) => (
                <button
                  key={name}
                  type="button"
                  role="radio"
                  aria-checked={tone === t}
                  aria-label={`${name} skin tone`}
                  title={`${name} skin tone`}
                  className={`ghost icon sm ${tone === t ? "on" : ""}`}
                  onClick={() => chooseTone(t)}
                  onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setToneOpen(false))}
                >
                  {withTone(TONE_SAMPLE, t)}
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="ghost icon sm"
              aria-label={`Skin tone: ${TONES[tone]}. Change`}
              title="Skin tone"
              onClick={() => setToneOpen(true)}
            >
              {withTone(TONE_SAMPLE, tone)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
