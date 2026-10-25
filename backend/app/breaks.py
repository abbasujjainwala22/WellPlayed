"""Pause requests: "need a break" instead of pausing for everyone.

States: idle -> requested (host decides, or auto-approves after AUTO_APPROVE_S)
        requested -> countdown (room paused, resumes at resume_at) -> idle
"""

import asyncio
import logging
from typing import Any

from app import stats
from app.chat import system_message
from app.clock import now_ms
from app.hub import hub
from app.playback import publish_timeline
from app.realtime import Ctx, join_hooks, on
from app.rooms import Room

log = logging.getLogger(__name__)
AUTO_APPROVE_S = 15.0
DEFAULT_BREAK_S = 120
MAX_BREAK_S = 600
MAX_EXTENSIONS = 3


def _state(room: Room) -> dict | None:
    return room.ext.get("break")


def public(room: Room) -> dict | None:
    b = _state(room)
    if not b:
        return None
    return {k: b[k] for k in ("id", "state", "requesterId", "requesterName", "seconds", "resumeAtMs",
                              "autoApproveAtMs", "extensions")}


async def _publish(room: Room) -> None:
    await hub.broadcast(room.code, "break:state", {"break": public(room)})


def _spawn(room: Room, coro) -> None:
    task = asyncio.create_task(coro)

    def done(t: asyncio.Task) -> None:
        if not t.cancelled() and t.exception():
            log.error("break task failed", exc_info=t.exception())

    task.add_done_callback(done)
    room.ext["break_task"] = task


def _cancel_task(room: Room) -> None:
    task = room.ext.pop("break_task", None)
    if task:
        task.cancel()


async def _end(room: Room, reason: str) -> None:
    b = _state(room)
    _cancel_task(room)
    room.ext["break"] = None
    if b and b["wasPlaying"]:
        room.timeline.play(now_ms())
    elif b:
        room.timeline.pause(now_ms(), note=None)
    await publish_timeline(room)
    await _publish(room)
    await system_message(room, reason)


async def _start_countdown(room: Room) -> None:
    b = _state(room)
    assert b
    _cancel_task(room)
    b["wasPlaying"] = room.timeline.state == "playing"
    b["state"] = "countdown"
    b["resumeAtMs"] = now_ms() + b["seconds"] * 1000
    room.timeline.pause(now_ms(), note=f"{b['requesterName']} needs a break")
    await publish_timeline(room)
    await _publish(room)
    await system_message(room, f"Paused for {b['requesterName']}. Back in {b['seconds']}s.")
    _spawn(room, _resume_later(room, b["id"]))


async def _resume_later(room: Room, break_id: str) -> None:
    while True:
        b = _state(room)
        if not b or b["id"] != break_id:
            return
        remaining = (b["resumeAtMs"] - now_ms()) / 1000
        if remaining <= 0:
            break
        await asyncio.sleep(min(remaining, 0.25))
    room.ext.pop("break_task", None)  # this task is finishing; don't let _end cancel itself
    await _end(room, "Break over — resuming.")


async def _auto_approve(room: Room, break_id: str) -> None:
    await asyncio.sleep(AUTO_APPROVE_S)
    b = _state(room)
    if b and b["id"] == break_id and b["state"] == "requested":
        room.ext.pop("break_task", None)
        await _start_countdown(room)


@on("break:request")
async def request(ctx: Ctx, data: dict[str, Any]) -> None:
    room = ctx.room
    if _state(room):
        return await ctx.error("a break is already in progress")
    seconds = max(1, min(int(data.get("seconds", DEFAULT_BREAK_S)), MAX_BREAK_S))
    stats.bump(room, "breaks", ctx.member.id)
    room.ext["break"] = {
        "id": str(int(now_ms())), "state": "requested", "requesterId": ctx.member.id,
        "requesterName": ctx.member.name, "seconds": seconds, "resumeAtMs": None,
        "autoApproveAtMs": now_ms() + AUTO_APPROVE_S * 1000, "extensions": 0, "wasPlaying": False,
    }
    if ctx.member.id == room.host_id:
        await _start_countdown(room)
        return
    await _publish(room)
    _spawn(room, _auto_approve(room, room.ext["break"]["id"]))


@on("break:decision")
async def decision(ctx: Ctx, data: dict[str, Any]) -> None:
    b = _state(ctx.room)
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can decide")
    if not b or b["state"] != "requested":
        return await ctx.error("no pending break request")
    if data["approve"]:
        await _start_countdown(ctx.room)
    else:
        _cancel_task(ctx.room)
        ctx.room.ext["break"] = None
        await _publish(ctx.room)
        await system_message(ctx.room, f"Host declined {b['requesterName']}'s break request.")


@on("break:return")
async def back(ctx: Ctx, data: dict[str, Any]) -> None:
    """The requester (or host) ends the break early."""
    b = _state(ctx.room)
    if not b or b["state"] != "countdown":
        return
    if ctx.member.id not in (b["requesterId"], ctx.room.host_id):
        return await ctx.error("only the requester or host can end the break")
    await _end(ctx.room, f"{b['requesterName']} is back — resuming.")


@on("break:extend")
async def extend(ctx: Ctx, data: dict[str, Any]) -> None:
    b = _state(ctx.room)
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can extend a break")
    if not b or b["state"] != "countdown":
        return
    if b["extensions"] >= MAX_EXTENSIONS:
        return await ctx.error("break already extended the maximum number of times")
    b["extensions"] += 1
    b["resumeAtMs"] += 60_000
    await _publish(ctx.room)


async def send_state(ctx: Ctx) -> None:
    await ctx.reply("break:state", {"break": public(ctx.room)})


join_hooks.append(send_state)
