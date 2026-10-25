"""AI features over a timed transcript: spoiler-safe recap, lecture notes, quiz questions.

Every feature works without an LLM using deterministic extractive fallbacks, so local
testing needs no API key. With ANTHROPIC_API_KEY set, the LLM produces the output instead.
"""

import hashlib
import random
import re
from collections import Counter

from app.llm import llm
from app.rooms import Room
from app.transcript import Cue

LANG_NAMES = {"en": "English", "es": "Spanish", "fr": "French", "de": "German", "pt": "Portuguese", "hi": "Hindi",
              "ml": "Malayalam", "ar": "Arabic", "zh": "Chinese", "ja": "Japanese"}
STOP = set(
    """
a an the and or but if then so of to in on at for with from by as is are was were be been being it
its this that these those i you he she we they them his her our your their my me us not no do does
did have has had will would can could should may might just very about into over under up down out
more most some any all each than too also there here what which who whom when where why how one two
get got
""".split()
)


# ---------- transcript helpers ----------

def get_transcript(room: Room) -> list[Cue]:
    return room.ext.get("transcript", {}).get("cues", [])


def set_transcript(room: Room, language: str, cues: list[Cue]) -> None:
    room.ext["transcript"] = {"language": language, "cues": cues}
    room.ext.pop("ai_cache", None)


def truncate(cues: list[Cue], at: float) -> list[Cue]:
    """Only what has been *fully* spoken by `at`. Nothing later may reach the model or the user."""
    return [c for c in cues if c.end <= at]


def _sentences(cues: list[Cue]) -> list[tuple[float, str]]:
    out, buf, t0 = [], [], 0.0
    for c in cues:
        if not buf:
            t0 = c.start
        buf.append(c.text.strip())
        if re.search(r"[.!?…]['\")\]]*$", c.text.strip()) or len(" ".join(buf)) > 220:
            out.append((t0, " ".join(buf)))
            buf = []
    if buf:
        out.append((t0, " ".join(buf)))
    return out


def _words(text: str) -> list[str]:
    return [w for w in re.findall(r"[A-Za-z][A-Za-z'’-]+", text.lower()) if w not in STOP and len(w) > 2]


def extractive_points(cues: list[Cue], k: int) -> list[tuple[float, str]]:
    sents = _sentences(cues)
    if len(sents) <= k:
        return sents
    freq = Counter(w for _, s in sents for w in _words(s))

    def score(s: str) -> float:
        ws = _words(s)
        return sum(freq[w] for w in ws) / (len(ws) + 5) if ws else 0.0

    best = sorted(sents, key=lambda ts: -score(ts[1]))[:k]
    return sorted(best)


def _fmt(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02}"


def _cached(room: Room, key: tuple):
    return room.ext.setdefault("ai_cache", {}).get(key)


def _store(room: Room, key: tuple, value):
    room.ext.setdefault("ai_cache", {})[key] = value
    return value


# ---------- recap (late joiners) ----------

RECAP_SYSTEM = (
    "You write spoiler-safe catch-up recaps for someone who joined a watch party late. "
    "You are given the transcript up to the viewer's current moment ONLY. Summarise what has happened so far "
    "in 4-6 short bullet points. Never speculate about or hint at what comes next."
)


async def recap(room: Room, at: float, lang: str) -> dict:
    cues = truncate(get_transcript(room), at)
    if not cues:
        return {"bullets": [], "at": at, "source": "none", "note": "Nothing has been said yet."}
    key = ("recap", int(at // 300), lang, len(cues))
    if hit := _cached(room, key):
        return hit
    if llm.available:
        text = "\n".join(f"[{_fmt(c.start)}] {c.text}" for c in cues)[-24000:]
        try:
            out = await llm.json(RECAP_SYSTEM, f"Language: {LANG_NAMES.get(lang, lang)}.\nReturn a JSON array of "
                                 f"bullet strings.\n\nTRANSCRIPT SO FAR:\n{text}")
            if isinstance(out, list) and out:
                return _store(room, key, {"bullets": [str(b) for b in out][:8], "at": at, "source": "llm"})
        except Exception:
            pass  # fall through to the extractive recap
    pts = extractive_points(cues, 5)
    bullets = [f"[{_fmt(t)}] {s}" for t, s in pts]
    return _store(room, key, {"bullets": bullets, "at": at, "source": "extractive"})


# ---------- lecture notes ----------

async def notes(room: Room, lang: str) -> dict:
    cues = get_transcript(room)
    if not cues:
        return {"summary": "", "points": [], "source": "none"}
    key = ("notes", lang, len(cues))
    if hit := _cached(room, key):
        return hit
    if llm.available:
        text = "\n".join(f"[{c.start:.0f}s] {c.text}" for c in cues)[:30000]
        try:
            out = await llm.json(
                "You write concise lecture notes.",
                f"Language: {LANG_NAMES.get(lang, lang)}. Return JSON {{\"summary\": str, \"points\": "
                f"[{{\"t\": seconds, \"text\": str}}]}} with 6-12 key points in time order.\n\n{text}",
            )
            pts = [{"t": float(p["t"]), "text": str(p["text"])} for p in out["points"]]
            return _store(room, key, {"summary": str(out["summary"]), "points": pts, "source": "llm"})
        except Exception:
            pass
    total = cues[-1].end
    k = max(3, min(10, int(total // 120) + 1))
    chunks: list[list[Cue]] = [[] for _ in range(k)]
    for c in cues:
        chunks[min(k - 1, int(c.start / (total or 1) * k))].append(c)
    points = []
    for ch in chunks:
        best = extractive_points(ch, 1) if ch else []
        if best:
            points.append({"t": best[0][0], "text": best[0][1]})
    summary = " ".join(s for _, s in extractive_points(cues, 3))
    return _store(room, key, {"summary": summary, "points": points, "source": "extractive"})


# ---------- quiz questions ----------

def _keyword(sentence: str) -> str | None:
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'’-]+", sentence)
    cands = [w for w in words if w.lower() not in STOP and (len(w) >= 6 or w.isdigit())]
    return max(cands, key=len) if cands else None


def cloze_questions(cues: list[Cue], n: int) -> list[dict]:
    """Deterministic fill-in-the-blank questions spread across the transcript."""
    sents = [(t, s) for t, s in _sentences(cues) if 6 <= len(s.split()) <= 30 and _keyword(s)]
    if not sents:
        return []
    pool = sorted({_keyword(s).lower() for _, s in sents} | {w for _, s in sents for w in _words(s) if len(w) >= 6})
    rng = random.Random(hashlib.sha1(" ".join(s for _, s in sents[:5]).encode()).hexdigest())
    step = max(1, len(sents) // n)
    chosen = sents[step // 2 :: step][:n]
    out = []
    for t, s in chosen:
        kw = _keyword(s)
        distract = [w for w in pool if w != kw.lower() and abs(len(w) - len(kw)) <= 4]
        rng.shuffle(distract)
        opts = [kw.lower(), *distract[:3]]
        while len(opts) < 4:
            opts.append(rng.choice(["nothing", "everything", "another", "something"]))
        rng.shuffle(opts)
        end = next((c.end for c in cues if c.start <= t <= c.end), t)
        # ask once the sentence has been fully heard
        at = max((c.end for c in cues if c.start >= t and c.end <= t + 40 and s.endswith(c.text.strip()[-12:])),
                 default=end)
        out.append({
            "at": round(at, 1),
            "question": re.sub(re.escape(kw), "_____", s, count=1, flags=re.I),
            "options": opts,
            "correct": opts.index(kw.lower()),
        })
    return out


def _valid_q(q: dict) -> bool:
    return (isinstance(q.get("question"), str) and isinstance(q.get("options"), list) and len(q["options"]) == 4
            and isinstance(q.get("correct"), int) and 0 <= q["correct"] < 4 and isinstance(q.get("at"), int | float))


async def quiz_questions(room: Room, n: int) -> list[dict]:
    cues = get_transcript(room)
    if not cues:
        return []
    if llm.available:
        text = "\n".join(f"[{c.end:.0f}s] {c.text}" for c in cues)[:30000]
        try:
            out = await llm.json(
                "You write multiple-choice comprehension questions for a lecture or film.",
                f"Write {n} questions spread across the transcript. Return a JSON array of objects "
                f"{{\"at\": seconds (just after the relevant content has been said), \"question\": str, "
                f"\"options\": [4 strings], \"correct\": index 0-3}}.\n\n{text}",
            )
            good = [q for q in out if _valid_q(q)]
            if good:
                return sorted(
                    ({"at": float(q["at"]), "question": q["question"], "options": [str(o) for o in q["options"]],
                      "correct": q["correct"]} for q in good), key=lambda q: q["at"])
        except Exception:
            pass
    return cloze_questions(cues, n)
