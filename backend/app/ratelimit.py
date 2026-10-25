"""Small in-memory sliding-window rate limiter.

Single-process, like the rest of the room state. Keys are free-form strings such as "chat:<member>"
or "join:<ip>"; each bucket has its own (limit, window) pair defined in LIMITS.
"""

import time
from collections import deque

from starlette.requests import HTTPConnection

# bucket -> (max events, window seconds)
LIMITS: dict[str, tuple[int, float]] = {
    "create": (10, 600.0),  # rooms created per client IP
    "join": (30, 600.0),  # joins per client IP (a household behind one NAT shares this)
    "chat": (6, 5.0),
    "reaction": (20, 5.0),
    "media": (12, 60.0),  # media changes, queue adds, countdowns
}

TOO_OFTEN = "You're doing that too often. Please wait a moment."


class SlidingWindow:
    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = {}

    def hit(self, key: str, limit: int, window_s: float, now: float | None = None) -> float:
        """Record an attempt. Returns 0 when allowed, otherwise the seconds until the next slot frees up."""
        now = time.monotonic() if now is None else now
        q = self.hits.setdefault(key, deque())
        while q and now - q[0] >= window_s:
            q.popleft()
        if len(q) >= limit:
            return max(0.1, window_s - (now - q[0]))
        q.append(now)
        return 0.0

    def prune(self, now: float | None = None) -> None:
        """Drop keys whose newest hit is older than the longest window (called by the room sweeper)."""
        now = time.monotonic() if now is None else now
        longest = max(w for _, w in LIMITS.values())
        for key in [k for k, q in self.hits.items() if not q or now - q[-1] >= longest]:
            self.hits.pop(key, None)

    def clear(self) -> None:
        self.hits.clear()


limiter = SlidingWindow()


def check(bucket: str, who: str) -> float:
    """0 if allowed, else seconds to wait."""
    limit, window = LIMITS[bucket]
    return limiter.hit(f"{bucket}:{who}", limit, window)


_LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def client_ip(conn: HTTPConnection) -> str:
    """The caller's IP. Forwarded headers are trusted only from a local proxy (tunnel, dev server),
    so a remote client can't dodge the limit by inventing its own X-Forwarded-For."""
    peer = conn.client.host if conn.client else "unknown"
    if peer in _LOOPBACK:
        fwd = conn.headers.get("cf-connecting-ip") or conn.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if fwd:
            return fwd
    return peer
