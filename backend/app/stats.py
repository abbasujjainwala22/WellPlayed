"""Per-member running counters that feed the end-of-party awards.

Only aggregate numbers are kept (how many, how long), never the underlying content.
"""

from app.rooms import Room


def counter(room: Room, key: str) -> dict[str, float]:
    return room.ext.setdefault("stats", {}).setdefault(key, {})


def bump(room: Room, key: str, member_id: str, n: float = 1) -> None:
    c = counter(room, key)
    c[member_id] = c.get(member_id, 0) + n
