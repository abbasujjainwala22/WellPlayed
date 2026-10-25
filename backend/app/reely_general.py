"""General Reely chat on /ai: no room, no accounts.

Like the Discover recommendations (app.recs), the browser sends a random device id; only a salted
hash of it is kept. Each device gets its own small JSON file under WP_DATA_DIR/reely/, holding its
conversations (a title plus the last MAX_MESSAGES messages each). Files are rewritten atomically,
and a conversation is only ever returned to the device that started it.

Replies come from the same brain as the in-room host (app.aihost): the LLM when a key is set,
otherwise the rule-based offline Reely, here without any room context.
"""

import hashlib
import hmac
import json
import logging
import os
import secrets
import tempfile
import threading
import time
from pathlib import Path

from app import aihost
from app.clock import now_ms
from app.config import get_settings
from app.recs import DEVICE_RE, SlidingWindow

log = logging.getLogger(__name__)

MAX_MESSAGES = 40  # kept per conversation
MAX_CONVOS = 30  # kept per device; the least recently used are dropped
PAGE_SIZE = 20
TITLE_MAX = 60
STALE_DAYS = 180  # device files untouched this long are removed at startup
CONVO_ID_LEN = 12

LIMITS = {
    "device_min": SlidingWindow(6, 60),
    "device_hour": SlidingWindow(60, 3600),
    "ip_min": SlidingWindow(20, 60),  # a fresh device id per request shouldn't dodge the budget
    "ip_hour": SlidingWindow(200, 3600),
    "commentary": SlidingWindow(1, 150),
}


def data_dir() -> Path:
    base = get_settings().wp_data_dir.strip()
    root = Path(base) if base else Path(__file__).resolve().parents[1] / "var"
    return root / "reely"


def _write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".reely-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def check_device(device_id: str | None) -> str:
    if not device_id or not DEVICE_RE.match(device_id):
        raise aihost.ReelyError(400, "Missing or invalid device id. Reload the page and try again.")
    return device_id


def _summary(c: dict) -> dict:
    return {"id": c["id"], "title": c["title"], "updated": c["updated"], "count": len(c["messages"])}


class ReelyStore:
    def __init__(self, root: Path):
        self.root = root
        self.lock = threading.RLock()
        self.salt = self._load_salt()
        self._prune_stale()

    def _load_salt(self) -> str:
        path = self.root / "salt.json"
        try:
            salt = json.loads(path.read_text(encoding="utf-8")).get("salt")
            if isinstance(salt, str) and len(salt) >= 16:
                return salt
        except FileNotFoundError:
            pass
        except Exception as e:
            log.warning("could not read %s (%s); starting a new salt", path, e)
        salt = secrets.token_hex(16)
        _write_atomic(path, {"salt": salt})
        return salt

    def _prune_stale(self) -> None:
        cutoff = time.time() - STALE_DAYS * 86400
        for f in self.root.glob("d-*.json"):
            try:
                if f.stat().st_mtime < cutoff:
                    f.unlink()
            except OSError:
                pass

    def device_hash(self, device_id: str) -> str:
        return hmac.new(self.salt.encode(), device_id.encode(), hashlib.sha256).hexdigest()

    def _file(self, me: str) -> Path:
        return self.root / f"d-{me}.json"

    def _load(self, me: str) -> list[dict]:
        """This device's conversations, most recently used first."""
        try:
            convos = json.loads(self._file(me).read_text(encoding="utf-8"))["convos"]
            return [c for c in convos if isinstance(c, dict) and c.get("id") and isinstance(c.get("messages"), list)]
        except FileNotFoundError:
            return []
        except Exception as e:
            log.warning("unreadable Reely file for a device (%s); starting fresh", type(e).__name__)
            return []

    def _save(self, me: str, convos: list[dict]) -> None:
        convos.sort(key=lambda c: -c["updated"])
        del convos[MAX_CONVOS:]
        if convos:
            _write_atomic(self._file(me), {"version": 1, "convos": convos})
        else:
            self._file(me).unlink(missing_ok=True)

    def page(self, device_id: str, offset: int = 0, limit: int = PAGE_SIZE) -> dict:
        with self.lock:
            convos = self._load(self.device_hash(device_id))
        offset, limit = max(0, offset), max(1, min(limit, 50))
        items = convos[offset:offset + limit]
        return {"items": [_summary(c) for c in items], "more": offset + limit < len(convos)}

    def get(self, device_id: str, convo_id: str) -> dict:
        with self.lock:
            c = next((c for c in self._load(self.device_hash(device_id)) if c["id"] == convo_id), None)
        if c is None:
            raise aihost.ReelyError(404, "That conversation isn't on this device any more. Start a new chat.")
        return c

    def delete(self, device_id: str, convo_id: str) -> None:
        with self.lock:
            me = self.device_hash(device_id)
            convos = self._load(me)
            kept = [c for c in convos if c["id"] != convo_id]
            if len(kept) == len(convos):
                raise aihost.ReelyError(404, "That conversation isn't on this device any more.")
            self._save(me, kept)

    def append(self, device_id: str, convo_id: str | None, title: str, new: list[dict], seen: dict) -> dict:
        """Add messages to a conversation (creating it if needed) and return its summary."""
        with self.lock:
            me = self.device_hash(device_id)
            convos = self._load(me)
            c = next((c for c in convos if c["id"] == convo_id), None) if convo_id else None
            if c is None:  # new chat (or it was deleted while Reely was thinking)
                c = {"id": secrets.token_hex(CONVO_ID_LEN // 2), "title": title or "New chat",
                     "created": now_ms(), "messages": [], "seen": {}}
                convos.append(c)
            c["messages"] = (c["messages"] + new)[-MAX_MESSAGES:]
            c["seen"] = seen
            c["updated"] = now_ms()
            self._save(me, convos)
            return _summary(c)


def _rate_limit(me: str, ip: str, commentary: bool) -> None:
    ok = LIMITS["device_min"].allow(me) and LIMITS["device_hour"].allow(me) \
        and LIMITS["ip_min"].allow(ip) and LIMITS["ip_hour"].allow(ip)
    if ok and commentary:
        ok = LIMITS["commentary"].allow(me)
    if not ok:
        raise aihost.ReelyError(429, "Reely needs a breather. Try again in a minute.")


async def chat(device_id: str | None, ip: str, convo_id: str | None, text: str, vibe: str,
               spoiler_safe: bool, kind: str = "chat") -> dict:
    device_id = check_device(device_id)
    s = store()
    commentary = kind == "commentary"
    past: list[dict] = []
    seen: dict = {}
    if convo_id:
        c = s.get(device_id, convo_id)
        past, seen = c["messages"], dict(c.get("seen") or {})
    if commentary:
        if not any(m.get("role") == "user" for m in past):
            raise aihost.ReelyError(409, "Say something to Reely first; timed prompts start after your first message.")
        text = ""
    else:
        try:
            text = aihost.check_text(text)
        except ValueError as exc:
            raise aihost.ReelyError(422, str(exc)) from exc
    vibe = vibe if vibe in aihost.VIBES else "normal"
    _rate_limit(s.device_hash(device_id), ip or "unknown", commentary)

    o = aihost.Offline(seed=f"general:{convo_id or secrets.token_hex(4)}", seen=seen, turns=len(past))
    reply, poll, source = await aihost.answer(aihost.GENERAL_SYSTEM,
                                              lambda: aihost.build_general_prompt(past, text, vibe, spoiler_safe, kind),
                                              lambda: aihost.offline_answer(o, text, vibe, kind))

    ts = now_ms()
    new = []
    if not commentary:
        new.append({"id": secrets.token_hex(4), "role": "user", "text": text, "ts": ts})
    new.append({"id": secrets.token_hex(4), "role": "reely", "text": reply, "source": source, "ts": ts,
                **({"kind": "commentary"} if commentary else {}), **({"poll": poll} if poll else {})})
    summary = s.append(device_id, convo_id, text[:TITLE_MAX], new, seen)
    return {"conversation": summary, "messages": [aihost.public(m) for m in new]}


def conversation(device_id: str | None, convo_id: str) -> dict:
    c = store().get(check_device(device_id), convo_id)
    return {"conversation": _summary(c), "messages": [aihost.public(m) for m in c["messages"]]}


_store: ReelyStore | None = None
_store_lock = threading.Lock()


def store() -> ReelyStore:
    global _store
    with _store_lock:
        if _store is None:
            _store = ReelyStore(data_dir())
        return _store
