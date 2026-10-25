"""GIPHY GIFs and stickers for chat, with the API key kept on the server.

The browser never talks to api.giphy.com: it asks our proxy for trending/search results (rating "g"
only) and sends chat messages that carry just a GIPHY id. Every media URL a client ever renders is
built here from a validated id, so a client can't smuggle an arbitrary URL into the room.
"""

import re
import time
from collections import OrderedDict
from typing import Any, Literal

import httpx

from app.config import get_settings

API = "https://api.giphy.com/v1"
ID_RE = re.compile(r"^[A-Za-z0-9]{1,64}$")
KINDS = ("gif", "sticker")
Kind = Literal["gif", "sticker"]
PAGE = 24
TRENDING_TTL_S = 300.0
SEARCH_TTL_S = 120.0
MAX_TITLE = 140


class GiphyError(Exception):
    """Something the user can act on (or wait out). `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


def enabled() -> bool:
    return bool(get_settings().giphy_api_key)


def valid_id(value: object) -> bool:
    return isinstance(value, str) and bool(ID_RE.match(value))


def urls(gid: str) -> dict[str, str]:
    """Renditions on GIPHY's media CDN, derived only from a validated id."""
    if not valid_id(gid):
        raise ValueError("invalid GIPHY id")
    base = f"https://media.giphy.com/media/{gid}"
    return {
        "url": f"{base}/200.webp",  # fixed height 200, animated
        "still": f"{base}/200_s.gif",  # first frame, for reduced motion
        "preview": f"{base}/200w_d.webp",  # fixed width 200, downsampled (light) for the picker grid
        "previewStill": f"{base}/200w_s.gif",
    }


def _clean_title(title: object, kind: str) -> str:
    text = " ".join(str(title or "").split())[:MAX_TITLE]
    return text or ("Sticker" if kind == "sticker" else "GIF")


def trim(item: dict[str, Any], kind: str) -> dict[str, Any] | None:
    """The few fields the app needs. None for anything malformed or not general-audience."""
    gid = item.get("id")
    if not valid_id(gid) or item.get("rating", "g") != "g":
        return None
    img = (item.get("images") or {}).get("fixed_height") or {}
    try:
        w, h = int(img.get("width") or 0), int(img.get("height") or 0)
    except (TypeError, ValueError):
        w = h = 0
    if w <= 0 or h <= 0:
        w, h = 200, 200
    return {"id": gid, "kind": kind, "title": _clean_title(item.get("title"), kind),
            "w": min(w, 2000), "h": min(h, 2000), **urls(gid)}


class _Ttl:
    """A tiny bounded TTL cache."""

    def __init__(self, size: int) -> None:
        self.size = size
        self.data: OrderedDict[Any, tuple[float, Any]] = OrderedDict()

    def get(self, key: Any) -> Any:
        hit = self.data.get(key)
        if not hit or hit[0] < time.monotonic():
            self.data.pop(key, None)
            return None
        self.data.move_to_end(key)
        return hit[1]

    def put(self, key: Any, value: Any, ttl: float) -> None:
        self.data[key] = (time.monotonic() + ttl, value)
        self.data.move_to_end(key)
        while len(self.data) > self.size:
            self.data.popitem(last=False)

    def clear(self) -> None:
        self.data.clear()


pages = _Ttl(200)  # (kind, query, offset) -> page
items = _Ttl(2000)  # id -> trimmed item, so sending something just browsed needs no extra API call
_blocked_until = 0.0


async def _call(path: str, params: dict[str, Any]) -> dict[str, Any]:
    global _blocked_until
    key = get_settings().giphy_api_key
    if not key:
        raise GiphyError("GIFs aren't set up on this server.", 503)
    if time.monotonic() < _blocked_until:
        raise GiphyError("GIPHY is busy right now. Try again in a minute.", 503)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{API}/{path}", params={"api_key": key, **params})
    except httpx.HTTPError as exc:
        raise GiphyError("Couldn't reach GIPHY. Check your connection and try again.") from exc
    if r.status_code == 429:
        _blocked_until = time.monotonic() + 60
        raise GiphyError("GIPHY is busy right now. Try again in a minute.", 503)
    if r.status_code == 404:
        raise GiphyError("That GIF isn't available any more.", 404)
    if r.status_code != 200:
        raise GiphyError("GIPHY couldn't load results. Try again.")
    return r.json()


async def browse(kind: Kind, query: str = "", offset: int = 0) -> dict[str, Any]:
    """Trending (no query) or search results for gifs or stickers: {items, next}."""
    query = " ".join(query.split())[:50]
    offset = max(0, min(int(offset), 499))
    cache_key = (kind, query.lower(), offset)
    if (cached := pages.get(cache_key)) is not None:
        return cached
    endpoint = f"{'stickers' if kind == 'sticker' else 'gifs'}/{'search' if query else 'trending'}"
    params: dict[str, Any] = {"limit": PAGE, "offset": offset, "rating": "g"}
    if query:
        params |= {"q": query, "lang": "en"}
    data = await _call(endpoint, params)
    found = [t for t in (trim(i, kind) for i in data.get("data") or []) if t]
    for t in found:
        items.put(t["id"], t, 3600)
    pag = data.get("pagination") or {}
    nxt = int(pag.get("offset", offset)) + int(pag.get("count", len(found)))
    total = int(pag.get("total_count", 0) or 0)
    page = {"items": found, "next": nxt if found and nxt < min(total, 500) else None}
    pages.put(cache_key, page, SEARCH_TTL_S if query else TRENDING_TTL_S)
    return page


async def lookup(gid: str, kind: Kind) -> dict[str, Any]:
    """Resolve an id a client wants to post. Rejects anything malformed or not rated "g"."""
    if not valid_id(gid):
        raise GiphyError("That isn't a GIPHY id.", 400)
    cached = items.get(gid)
    if cached:
        return {**cached, "kind": kind}
    data = (await _call(f"gifs/{gid}", {})).get("data") or {}
    found = trim(data, kind) if data.get("id") == gid and data.get("rating") == "g" else None
    if not found:
        raise GiphyError("That GIF isn't available.", 404)
    items.put(gid, found, 3600)
    return found


def reset() -> None:
    global _blocked_until
    pages.clear()
    items.clear()
    _blocked_until = 0.0
