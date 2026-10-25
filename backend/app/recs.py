"""Community recommendations for the Discover page.

Rooms live in memory, but recommendations are meant to outlast a restart, so the whole store is
kept in one small JSON file that is rewritten atomically after every change.

There are no user accounts. The browser makes up a random device id and sends it with each call;
only a salted hash of it is kept here, which is enough to allow one vote per device and to let
the author delete their own recommendation.
"""

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import tempfile
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from app.config import get_settings

log = logging.getLogger(__name__)

MAX_RECS = 500  # oldest are dropped beyond this
LIST_LIMIT = 60
TITLE_MAX, GENRE_MAX, NAME_MAX = 100, 40, 40
DESCRIPTION_MAX, QUESTION_MAX, OPTION_MAX = 300, 140, 60
POSTER_MAX = 500
DEVICE_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_CONTROL = re.compile(r"[\u0000-\u001f\u007f]")


class RecError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def data_file() -> Path:
    base = get_settings().wp_data_dir.strip()
    root = Path(base) if base else Path(__file__).resolve().parents[1] / "var"
    return root / "recs.json"


# ───────────────────────── validation ─────────────────────────


def _text(value: object, max_len: int, label: str, required: bool = False) -> str:
    if value is not None and not isinstance(value, str):
        raise RecError(400, f"{label} is invalid.")
    s = re.sub(r"\s+", " ", _CONTROL.sub(" ", value or "")).strip()
    if required and not s:
        raise RecError(400, f"{label} can't be empty.")
    if len(s) > max_len:
        raise RecError(400, f"{label} must be {max_len} characters or fewer.")
    return s


def _year(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, str) and value.strip().isdigit():
        value = int(value.strip())
    if not isinstance(value, int) or isinstance(value, bool) or not 1888 <= value <= datetime.now(UTC).year + 5:
        raise RecError(400, "Year looks invalid.")
    return value


def _poster(value: object) -> str:
    if value is None or value == "":
        return ""
    if not isinstance(value, str):
        raise RecError(400, "Poster link is invalid.")
    url = value.strip()
    parts = urlsplit(url)
    if len(url) > POSTER_MAX or parts.scheme != "https" or not parts.hostname or re.search(r"[\s\"'<>]", url):
        raise RecError(400, "Poster must be an https:// image link.")
    return url


def validate(body: dict) -> dict:
    """Turn an untrusted request body into a clean recommendation (minus server-side fields)."""
    if not isinstance(body, dict):
        raise RecError(400, "Invalid request.")
    kind = body.get("kind") or "movie"
    if kind not in ("movie", "series"):
        raise RecError(400, "Kind must be movie or series.")
    question = _text(body.get("poll_question"), QUESTION_MAX, "Poll question")
    raw_options = body.get("poll_options") or []
    if not isinstance(raw_options, list) or len(raw_options) > 10:
        raise RecError(400, "Poll answers are invalid.")
    options = [o for o in (_text(o, OPTION_MAX, "Poll answer") for o in raw_options) if o]
    if question or options:
        if not question:
            raise RecError(400, "Add a poll question, or clear the answers.")
        if not 2 <= len(options) <= 3:
            raise RecError(400, "Polls need 2 or 3 answers.")
        if len({o.casefold() for o in options}) != len(options):
            raise RecError(400, "Poll answers must all be different.")
    return {
        "title": _text(body.get("title"), TITLE_MAX, "Title", required=True),
        "kind": kind,
        "genre": _text(body.get("genre"), GENRE_MAX, "Genre"),
        "year": _year(body.get("year")),
        "description": _text(body.get("description"), DESCRIPTION_MAX, "Description"),
        "poster_url": _poster(body.get("poster_url")),
        "poll_question": question,
        "poll_options": options,
        "submitted_by_name": _text(body.get("name"), NAME_MAX, "Name") or "Someone",
    }


def check_device(device_id: str | None) -> str:
    if not device_id or not DEVICE_RE.match(device_id):
        raise RecError(400, "Missing or invalid device id. Reload the page and try again.")
    return device_id


# ───────────────────────── rate limiting ─────────────────────────


class SlidingWindow:
    """At most `limit` hits per `window` seconds for each key. In memory, reset on restart."""

    def __init__(self, limit: int, window: float):
        self.limit, self.window = limit, window
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self.lock:
            q = self.hits[key]
            while q and q[0] <= now - self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self.hits) > 10_000:  # forget idle keys so the table can't grow forever
                for k in [k for k, v in self.hits.items() if not v or v[-1] <= now - self.window]:
                    del self.hits[k]
            return True


LIMITS = {
    "create": (SlidingWindow(5, 600), SlidingWindow(20, 600)),  # (per device, per IP)
    "vote": (SlidingWindow(30, 60), SlidingWindow(90, 60)),
    "delete": (SlidingWindow(20, 600), SlidingWindow(60, 600)),
}


def rate_limit(action: str, device_hash: str, ip: str) -> None:
    per_device, per_ip = LIMITS[action]
    if not per_device.allow(device_hash) or not per_ip.allow(ip or "unknown"):
        raise RecError(429, "Slow down a little and try again in a minute.")


# ───────────────────────── store ─────────────────────────


class RecStore:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.salt = ""
        self.recs: list[dict] = []  # oldest first
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            recs = data["recs"]
            if not isinstance(recs, list) or not isinstance(data.get("salt"), str):
                raise ValueError("unexpected shape")
            self.salt = data["salt"]
            self.recs = [r for r in recs if isinstance(r, dict) and r.get("id") and r.get("title")][-MAX_RECS:]
        except FileNotFoundError:
            pass
        except Exception as e:  # corrupt or unreadable: keep a copy for inspection, start fresh
            log.warning("could not read %s (%s); starting with no recommendations", self.path, e)
            try:
                self.path.replace(self.path.with_name(f"{self.path.name}.corrupt-{int(time.time())}"))
            except OSError:
                pass
        if not self.salt:
            self.salt = secrets.token_hex(16)

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({"version": 1, "salt": self.salt, "recs": self.recs}, ensure_ascii=False)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".recs-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def device_hash(self, device_id: str) -> str:
        return hmac.new(self.salt.encode(), device_id.encode(), hashlib.sha256).hexdigest()

    @staticmethod
    def public(rec: dict, me: str | None) -> dict:
        votes: dict[str, int] = rec.get("votes", {})
        counts = [0] * len(rec["poll_options"])
        for option in votes.values():
            if 0 <= option < len(counts):
                counts[option] += 1
        out = {k: v for k, v in rec.items() if k not in ("owner", "votes")}
        out["counts"] = counts
        out["mine"] = bool(me) and rec.get("owner") == me
        out["myVote"] = votes.get(me) if me else None
        return out

    def _find(self, rec_id: str) -> dict:
        for r in self.recs:
            if r["id"] == rec_id:
                return r
        raise RecError(404, "That recommendation no longer exists.")

    def list(self, device_id: str | None = None) -> list[dict]:
        with self.lock:
            me = self.device_hash(device_id) if device_id and DEVICE_RE.match(device_id) else None
            return [self.public(r, me) for r in reversed(self.recs[-LIST_LIMIT:])]

    def create(self, body: dict, device_id: str) -> dict:
        clean = validate(body)
        with self.lock:
            me = self.device_hash(device_id)
            rec = {
                "id": uuid.uuid4().hex[:12],
                **clean,
                "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "owner": me,
                "votes": {},
            }
            self.recs.append(rec)
            del self.recs[:-MAX_RECS]
            self._save()
            return self.public(rec, me)

    def vote(self, rec_id: str, option: object, device_id: str) -> dict:
        with self.lock:
            me = self.device_hash(device_id)
            rec = self._find(rec_id)
            if not rec["poll_options"]:
                raise RecError(400, "This recommendation has no poll.")
            if not isinstance(option, int) or isinstance(option, bool) or not 0 <= option < len(rec["poll_options"]):
                raise RecError(400, "Pick one of the poll answers.")
            if me in rec["votes"]:
                raise RecError(409, "You already voted in this poll.")
            rec["votes"][me] = option
            self._save()
            return self.public(rec, me)

    def delete(self, rec_id: str, device_id: str) -> None:
        with self.lock:
            rec = self._find(rec_id)
            if rec.get("owner") != self.device_hash(device_id):
                raise RecError(403, "You can only delete recommendations made on this device.")
            self.recs.remove(rec)
            self._save()


_store: RecStore | None = None
_store_lock = threading.Lock()


def store() -> RecStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = RecStore(data_file())
        return _store


def reset_store() -> None:
    """Forget the in-memory copy so the next call re-reads the file (used on app startup)."""
    global _store
    with _store_lock:
        _store = None
