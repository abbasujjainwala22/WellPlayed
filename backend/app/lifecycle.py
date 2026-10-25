"""Party lifecycle: ending a party, leaving it, host hand-off and expiry of idle or old rooms."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI

from app import ratelimit
from app.chat import system_message
from app.clock import now_ms
from app.config import get_settings
from app.diagnostics import log_event
from app.hub import hub
from app.realtime import Ctx, join_hooks, leave_hooks
from app.rooms import CLOSE_ENDED, CLOSE_SESSION, ENDED_MESSAGES, HOST_AWAY_MS, Member, Room, manager

log = logging.getLogger(__name__)

# Run just before everyone is told the party ended (room state is still intact), e.g. to send a summary.
end_hooks: list[Callable[[Room, str], Awaitable[None]]] = []
# Run after a member left for good (e.g. to drop them from the voice call). Failures are logged only.
left_hooks: list[Callable[[Room, Member], Awaitable[None]]] = []


async def _close_member(room: Room, member_id: str, code: int) -> None:
    for conn in [c for c in hub.rooms.get(room.code, {}).values() if c.member_id == member_id]:
        with contextlib.suppress(Exception):
            await conn.ws.close(code=code)


async def end_room(room: Room, reason: str, by: Member | None = None) -> None:
    """Tell everyone, close every socket with CLOSE_ENDED and forget the room."""
    if manager.rooms.get(room.code) is not room:
        return  # already ended
    manager.end(room.code, reason)
    log_event("end", room.code, by.id if by else None, reason=reason)
    room.timeline.pause(now_ms(), note="Party ended")
    for hook in end_hooks:
        try:
            await hook(room, reason)
        except Exception:
            log.exception("end hook failed")
    await hub.broadcast(room.code, "room:ended", {
        "reason": reason,
        "by": by.name if by else None,
        "message": ENDED_MESSAGES.get(reason, "This party has ended."),
    })
    for conn in list(hub.rooms.get(room.code, {}).values()):
        with contextlib.suppress(Exception):
            await conn.ws.close(code=CLOSE_ENDED)
    # the Room is no longer referenced by the manager; its chat, polls and reactions go with it


async def broadcast_members(room: Room) -> None:
    await hub.broadcast(room.code, "members:state", {
        "members": [m.public() for m in room.members.values()],
        "hostId": room.host_id,
    })


async def leave(room: Room, member: Member) -> dict[str, Any]:
    """Remove a member for good. A departing host hands over to the longest-present member."""
    online = hub.online(room.code) - {member.id}
    new_host = room.next_host(online, exclude=member.id) if member.id == room.host_id else None
    room.members.pop(member.id, None)
    log_event("leave", room.code, member.id)
    await _close_member(room, member.id, CLOSE_SESSION)  # other devices (a paired phone) leave too
    for hook in left_hooks:
        try:
            await hook(room, member)
        except Exception:
            log.exception("left hook failed")
    if not room.members:
        await end_room(room, "empty")
        return {"ended": True}
    if new_host:
        room.set_host(new_host.id)
        log_event("host-change", room.code, new_host.id, previous=member.id, reason="left")
    await broadcast_members(room)
    await hub.broadcast(room.code, "presence", {"online": sorted(hub.online(room.code))})
    if new_host:
        await system_message(room, f"{member.name} left. {new_host.name} is the host now.")
    else:
        await system_message(room, f"{member.name} left the party.")
    return {"ended": False, "hostId": room.host_id}


async def hand_over_if_host_away(room: Room, now: float | None = None) -> Member | None:
    """A host who just closes the tab (rather than leaving) would strand the host-only controls. Once
    they have been offline for HOST_AWAY_MS, the longest-present member who is here takes over.
    If the old host comes back, they carry on as a guest."""
    now = now_ms() if now is None else now
    online = hub.online(room.code)
    old_id = room.host_id
    old = room.members.get(old_id)
    if old_id in online or (old and now - old.last_seen_ms < HOST_AWAY_MS):
        return None
    new_host = room.next_host(online, exclude=old_id)
    if not new_host or new_host.id not in online:
        return None  # nobody here to hand over to; whoever comes back first sorts it out
    room.set_host(new_host.id)
    log_event("host-change", room.code, new_host.id, previous=old_id, reason="away")
    await broadcast_members(room)
    await hub.broadcast(room.code, "host:changed", {"hostId": new_host.id, "previousHostId": old_id, "reason": "away"})
    who = old.name if old else "The host"
    await system_message(room, f"{who} has been away for a couple of minutes, so {new_host.name} is the host now.")
    return new_host


async def prune_departed(room: Room, now: float | None = None) -> list[Member]:
    """Forget members who have been gone for hours, so stale seats and tokens don't pile up."""
    hours = get_settings().wp_prune_member_hours
    if hours <= 0:
        return []
    gone = manager.prune(room, hub.online(room.code), hours * 3_600_000, now)
    for m in gone:
        log_event("prune", room.code, m.id)
    if gone:
        await broadcast_members(room)
    return gone


# ── presence bookkeeping for expiry and seat counting ──

async def _on_join(ctx: Ctx) -> None:
    ctx.member.last_seen_ms = now_ms()
    ctx.room.empty_since_ms = None


async def _on_leave(ctx: Ctx) -> None:
    now = now_ms()
    ctx.member.last_seen_ms = now
    if not hub.online(ctx.room.code):
        ctx.room.empty_since_ms = now


join_hooks.append(_on_join)
leave_hooks.append(_on_leave)


async def sweep(now: float | None = None) -> list[str]:
    """End rooms nobody has been in for a while, and rooms past their maximum age. In the rooms that
    carry on, hand over from a host who went away and forget members who left hours ago."""
    s = get_settings()
    now = now_ms() if now is None else now
    idle_ms, max_age_ms = s.wp_idle_room_minutes * 60_000, s.wp_room_max_age_hours * 3_600_000
    ended = []
    for room in list(manager.rooms.values()):
        idle = room.empty_since_ms is not None and not hub.online(room.code) and now - room.empty_since_ms >= idle_ms
        if idle or now - room.created_ms >= max_age_ms:
            await end_room(room, "expired")
            ended.append(room.code)
            continue
        try:
            await hand_over_if_host_away(room, now)
            await prune_departed(room, now)
        except Exception:  # one bad room must not stop the sweep of the others
            log.exception("room upkeep failed")
    ratelimit.limiter.prune()
    return ended


async def _sweeper() -> None:
    while True:
        await asyncio.sleep(get_settings().wp_sweep_interval_s)
        try:
            await sweep()
        except Exception:  # never let one bad room stop the sweeper
            log.exception("room sweep failed")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    task = asyncio.create_task(_sweeper())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
