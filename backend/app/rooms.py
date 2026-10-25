"""In-memory room state. Swap RoomManager's storage for Redis to scale horizontally."""

import re
import secrets
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

from app.clock import now_ms
from app.timeline import Timeline

MODES = ("movie", "study", "sports", "hangout")
_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# WebSocket close codes the client can tell apart (all stop its reconnect loop)
CLOSE_SESSION = 4401  # the room exists but this token isn't (or is no longer) a member
CLOSE_UNKNOWN = 4404  # no such room, e.g. the server restarted
CLOSE_ENDED = 4410  # the party was ended by the host or expired

ACTIVE_GRACE_MS = 5 * 60_000  # an offline member still holds a seat this long (a refresh, a flaky network)
ENDED_MEMORY = 2000  # remember this many ended codes, so late visitors see "ended" rather than "not found"
HOST_AWAY_MS = 2 * 60_000  # a host offline this long hands over to someone who is here
JOIN_KEY_MEMORY = 200  # per room: a retried join with the same key gets the same member back

ENDED_MESSAGES = {
    "host": "This party has ended. The host closed it for everyone.",
    "expired": "This party has ended. It expired after a while with nobody watching.",
    "empty": "This party has ended. Everyone left.",
}


_NOT_CODE = re.compile(r"[^A-Z0-9]")


def normalize_code(code: str) -> str:
    """Accept codes as people type or paste them: any case, with spaces or dashes."""
    return _NOT_CODE.sub("", (code or "").upper())


class RoomGone(KeyError):
    """The room existed but has ended."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason

    @property
    def message(self) -> str:
        return ENDED_MESSAGES.get(self.reason, "This party has ended.")


class RoomFull(ValueError):
    pass


@dataclass
class Member:
    id: str
    name: str
    language: str
    token: str
    is_host: bool = False
    household_id: str | None = None
    joined_ms: float = field(default_factory=now_ms)
    last_seen_ms: float = field(default_factory=now_ms)  # last connect/disconnect

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "language": self.language,
            "isHost": self.is_host,
            "householdId": self.household_id,
        }


@dataclass
class Room:
    code: str
    name: str
    mode: str
    host_id: str
    members: dict[str, Member] = field(default_factory=dict)
    timeline: Timeline = field(default_factory=Timeline)
    media: dict[str, Any] | None = None
    settings: dict[str, Any] = field(
        default_factory=lambda: {
            "membersCanControl": False,
            "spoilerSafe": False,
            "stretchLock": False,  # next episode waits for everyone's stretch
            "seatedOnly": False,  # seated stretch routine for the whole room
            "playfulTransforms": True,  # shrimp/fish/potato avatars visible to the group
            "audioFirst": False,  # hangout: shrink the video, keep the conversation front and centre
        }
    )
    ext: dict[str, Any] = field(default_factory=dict)  # per-feature state, keyed by feature
    join_keys: dict[str, str] = field(default_factory=dict)  # client join key -> member id
    former: dict[str, str] = field(default_factory=dict)  # id -> name of members pruned for inactivity
    created_ms: float = field(default_factory=now_ms)
    empty_since_ms: float | None = field(default_factory=now_ms)  # None while anyone is connected

    def snapshot(self) -> dict[str, Any]:
        t = self.timeline.snapshot()
        return {
            "code": self.code,
            "name": self.name,
            "mode": self.mode,
            "hostId": self.host_id,
            "members": [m.public() for m in self.members.values()],
            "media": self.media,
            "settings": self.settings,
            "timeline": t,
            "serverNowMs": now_ms(),
        }

    def member_name(self, member_id: str, fallback: str = "Someone") -> str:
        """Display name for anyone who has been in the room, including members since pruned."""
        m = self.members.get(member_id)
        return m.name if m else self.former.get(member_id, fallback)

    def can_control(self, member_id: str) -> bool:
        return member_id == self.host_id or bool(self.settings["membersCanControl"])

    def active_count(self, online: set[str], now: float | None = None) -> int:
        """Members holding a seat: connected now, or seen within the grace period."""
        now = now_ms() if now is None else now
        return sum(1 for m in self.members.values() if m.id in online or now - m.last_seen_ms < ACTIVE_GRACE_MS)

    def set_host(self, member_id: str) -> None:
        for m in self.members.values():
            m.is_host = m.id == member_id
        self.host_id = member_id

    def next_host(self, online: set[str], exclude: str) -> Member | None:
        """Longest-present member, preferring people who are connected right now."""
        rest = [m for m in self.members.values() if m.id != exclude]
        if not rest:
            return None
        return min(rest, key=lambda m: (m.id not in online, m.joined_ms))


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.ended: OrderedDict[str, str] = OrderedDict()  # code -> reason

    def _new_code(self) -> str:
        while True:
            code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
            if code not in self.rooms and code not in self.ended:
                return code

    def create(self, name: str, mode: str, host_name: str, language: str) -> tuple[Room, Member]:
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        host = self._member(host_name, language, is_host=True)
        room = Room(code=self._new_code(), name=name, mode=mode, host_id=host.id)
        room.settings["audioFirst"] = mode == "hangout"
        room.members[host.id] = host
        self.rooms[room.code] = room
        return room, host

    def join(
        self, code: str, name: str, language: str, household_id: str | None,
        online: set[str] | None = None, limit: int | None = None, join_key: str | None = None,
    ) -> Member:
        """Add a member. A repeated `join_key` (a retried request, a double click) returns the same member."""
        room = self.get(code)
        if join_key and (existing := room.members.get(room.join_keys.get(join_key, ""))):
            return existing
        if limit is not None and room.active_count(online or set()) >= limit:
            raise RoomFull(f"This party is full ({limit} people). Ask the host to make room, or start your own party.")
        member = self._member(name, language)
        member.household_id = household_id
        room.members[member.id] = member
        if join_key:
            room.join_keys[join_key] = member.id
            while len(room.join_keys) > JOIN_KEY_MEMORY:
                room.join_keys.pop(next(iter(room.join_keys)))
        return member

    @staticmethod
    def prune(room: Room, online: set[str], older_than_ms: float, now: float | None = None) -> list[Member]:
        """Forget members gone for a long time (their token stops working). Their names stay in
        `room.former`, so scores, awards and poll results that mention them still read properly."""
        now = now_ms() if now is None else now
        gone = [m for m in room.members.values()
                if m.id not in online and m.id != room.host_id and now - m.last_seen_ms >= older_than_ms]
        for m in gone:
            room.members.pop(m.id, None)
            room.former[m.id] = m.name
        if gone:
            ids = {m.id for m in gone}
            room.join_keys = {k: v for k, v in room.join_keys.items() if v not in ids}
        return gone

    def get(self, code: str) -> Room:
        code = normalize_code(code)
        if code in self.rooms:
            return self.rooms[code]
        if code in self.ended:
            raise RoomGone(self.ended[code])
        raise KeyError("room not found")

    def end(self, code: str, reason: str) -> Room | None:
        """Forget the room (freeing its memory) and remember that it ended."""
        code = normalize_code(code)
        room = self.rooms.pop(code, None)
        self.ended[code] = reason
        self.ended.move_to_end(code)
        while len(self.ended) > ENDED_MEMORY:
            self.ended.popitem(last=False)
        return room

    def close_code_for(self, code: str) -> int:
        code = normalize_code(code)
        if code in self.rooms:
            return CLOSE_SESSION
        return CLOSE_ENDED if code in self.ended else CLOSE_UNKNOWN

    def authenticate(self, code: str, token: str) -> tuple[Room, Member] | None:
        room = self.rooms.get(normalize_code(code))
        if not room or not token:
            return None
        for m in room.members.values():
            if secrets.compare_digest(m.token, token):
                return room, m
        return None

    @staticmethod
    def _member(name: str, language: str, is_host: bool = False) -> Member:
        return Member(
            id=secrets.token_hex(4),
            name=name.strip()[:40] or "Guest",
            language=language,
            token=secrets.token_urlsafe(24),
            is_host=is_host,
        )


manager = RoomManager()
