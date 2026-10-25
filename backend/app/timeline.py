"""Authoritative room timeline.

position(now) = anchor_media_s + max(0, now - anchor_server_ms) / 1000 * rate  while playing.
Every mutation bumps `version`, so clients can discard stale or duplicated updates.
"""

from dataclasses import dataclass

PLAY_LEAD_MS = 250  # start slightly in the future so every client can schedule the start


@dataclass
class Timeline:
    state: str = "paused"  # "playing" | "paused"
    anchor_server_ms: float = 0.0
    anchor_media_s: float = 0.0
    rate: float = 1.0
    version: int = 0
    note: str | None = None  # why it is paused ("Sam needs a break")

    def position(self, now_ms: float) -> float:
        if self.state != "playing":
            return self.anchor_media_s
        return self.anchor_media_s + max(0.0, now_ms - self.anchor_server_ms) / 1000 * self.rate

    def play(self, now_ms: float, at: float | None = None, lead_ms: float = PLAY_LEAD_MS) -> None:
        pos = self.position(now_ms) if at is None else at
        self.state, self.anchor_media_s = "playing", pos
        self.anchor_server_ms = now_ms + lead_ms
        self.note = None
        self.version += 1

    def pause(self, now_ms: float, at: float | None = None, note: str | None = None) -> None:
        self.anchor_media_s = self.position(now_ms) if at is None else at
        self.state = "paused"
        self.anchor_server_ms = now_ms
        self.note = note
        self.version += 1

    def seek(self, now_ms: float, to: float) -> None:
        was_playing = self.state == "playing"
        self.anchor_media_s = max(0.0, to)
        self.anchor_server_ms = now_ms + (PLAY_LEAD_MS if was_playing else 0)
        self.version += 1

    def set_rate(self, now_ms: float, rate: float) -> None:
        self.anchor_media_s = self.position(now_ms)
        self.anchor_server_ms = now_ms
        self.rate = rate
        self.version += 1

    def snapshot(self) -> dict:
        return {
            "state": self.state,
            "anchorServerMs": self.anchor_server_ms,
            "anchorMediaS": self.anchor_media_s,
            "rate": self.rate,
            "version": self.version,
            "note": self.note,
        }
