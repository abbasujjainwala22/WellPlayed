"""Spoiler-safe fan-out for live sports.

Every viewer's screen is `lag` seconds behind the fastest feed. An event produced by a sender
at server time W refers to content-time C = W - lag_sender. A receiver sees content-time C at
wall-clock C + lag_receiver, so delivery is delayed by max(0, lag_receiver - lag_sender).
Receivers that are *ahead* of the sender have already seen the moment, so nothing is held back.
"""

import asyncio
import logging

from app.hub import hub
from app.rooms import Room

log = logging.getLogger(__name__)
MAX_LAG_S = 120.0
_tasks: set[asyncio.Task] = set()


def lags(room: Room) -> dict[str, dict]:
    return room.ext.setdefault("lag", {})


def lag_of(room: Room, member_id: str) -> float:
    return float(lags(room).get(member_id, {}).get("lag", 0.0))


def delay_for(room: Room, sender_id: str, receiver_id: str) -> float:
    if not room.settings.get("spoilerSafe"):
        return 0.0
    return max(0.0, lag_of(room, receiver_id) - lag_of(room, sender_id))


async def _later(code: str, member_id: str, delay: float, type_: str, data: dict) -> None:
    await asyncio.sleep(delay)
    await hub.send_to_member(code, member_id, type_, data)


async def broadcast(room: Room, sender_id: str, type_: str, data: dict) -> None:
    """Deliver to everyone, holding events back for viewers who are behind the sender."""
    members = {c.member_id for c in hub.rooms.get(room.code, {}).values()}
    for mid in members:
        delay = delay_for(room, sender_id, mid)
        if delay <= 0.01:
            await hub.send_to_member(room.code, mid, type_, data)
        else:
            t = asyncio.create_task(_later(room.code, mid, delay, type_, data))
            _tasks.add(t)
            t.add_done_callback(_tasks.discard)
