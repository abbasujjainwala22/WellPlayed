import { useState } from "react";

import type { NewRec } from "./recs-api";

const NAME_KEY = "wp:discover-name";
const savedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
};

const empty = () => ({
  title: "",
  kind: "movie" as NewRec["kind"],
  genre: "",
  year: "",
  description: "",
  poster_url: "",
  poll_question: "",
  options: ["", "", ""],
  name: savedName(),
});

export function AddRecForm({ onSubmit, onCancel }: { onSubmit: (rec: NewRec) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof ReturnType<typeof empty>) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const poll_options = f.options.map((o) => o.trim()).filter(Boolean);
    if (!f.title.trim()) return setError("Give it a title.");
    if (f.poster_url.trim() && !/^https:\/\//i.test(f.poster_url.trim())) return setError("Poster must be an https:// image link.");
    if (f.poll_question.trim() || poll_options.length) {
      if (!f.poll_question.trim()) return setError("Add a poll question, or clear the answers.");
      if (poll_options.length < 2) return setError("Polls need 2 or 3 answers.");
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit({ ...f, title: f.title.trim(), poster_url: f.poster_url.trim(), poll_options });
      try {
        localStorage.setItem(NAME_KEY, f.name.trim());
      } catch {
        /* storage unavailable */
      }
      setF(empty());
      onCancel();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="rec-form" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Title *</span>
        <input value={f.title} onChange={set("title")} maxLength={100} required placeholder="e.g. Paddington 2" />
      </label>
      <label className="field">
        <span>Type</span>
        <select value={f.kind} onChange={set("kind")}>
          <option value="movie">Movie</option>
          <option value="series">Series</option>
        </select>
      </label>
      <label className="field">
        <span>Genre</span>
        <input value={f.genre} onChange={set("genre")} maxLength={40} placeholder="Comedy" />
      </label>
      <label className="field">
        <span>Year</span>
        <input value={f.year} onChange={(e) => setF({ ...f, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} inputMode="numeric" placeholder="2017" />
      </label>
      <label className="field full">
        <span>
          Poster image link <span className="hint">optional, https:// only</span>
        </span>
        <input value={f.poster_url} onChange={set("poster_url")} maxLength={500} type="url" placeholder="https://…" />
      </label>
      <label className="field full">
        <span>Why should people watch it?</span>
        <textarea value={f.description} onChange={set("description")} maxLength={300} rows={3} />
        <span className="hint">{300 - f.description.length} characters left</span>
      </label>
      <label className="field full">
        <span>
          Fun poll <span className="hint">optional</span>
        </span>
        <input value={f.poll_question} onChange={set("poll_question")} maxLength={140} placeholder="Best character?" />
      </label>
      <div className="rec-form-options full">
        {f.options.map((o, i) => (
          <input
            key={i}
            aria-label={`Poll answer ${i + 1}`}
            placeholder={i < 2 ? `Answer ${i + 1}` : "Answer 3 (optional)"}
            value={o}
            maxLength={60}
            onChange={(e) => setF({ ...f, options: f.options.map((x, j) => (j === i ? e.target.value : x)) })}
          />
        ))}
      </div>
      <label className="field full">
        <span>Your name</span>
        <input value={f.name} onChange={set("name")} maxLength={40} placeholder="Shown as “by …”" autoComplete="nickname" />
      </label>
      {error && <p className="error full">{error}</p>}
      <div className="rec-form-actions full">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy}>
          {busy && <span className="spinner sm" />}
          Share it
        </button>
      </div>
    </form>
  );
}
