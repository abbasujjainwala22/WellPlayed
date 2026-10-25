"""Healthy watching: opt-in avatar states and the next-episode stretch lock.

Privacy: camera frames never reach the server. Clients send only a small derived state
("shrimp", "fish", ...). The server never stores history of these states, only a running total of
slouch minutes (🦐/🥔) per opted-in member, for the end-of-party awards.
"""

import asyncio
import os
from typing import Any

from app import stats
from app.chat import system_message
from app.clock import now_ms
from app.hub import hub
from app.media_meta import fill_title_later
from app.playback import check_media, limit_media, publish_timeline
from app.realtime import Ctx, join_hooks, leave_hooks, on
from app.rooms import Room

STATES = ("normal", "shrimp", "fish", "potato", "animal")
SLOUCH = ("shrimp", "potato")  # counted towards "The Emotional Support Potato" award
STRETCH_SECONDS = int(os.environ.get("WP_STRETCH_SECONDS", "30"))


def opted(room: Room) -> dict[str, dict]:
    return room.ext.setdefault("wellbeing", {})


def _tally(room: Room, member_id: str, entry: dict) -> None:
    """Add the time just spent slouching to the member's running total."""
    if entry["state"] in SLOUCH:
        stats.bump(room, "slouch_ms", member_id, max(0.0, now_ms() - entry["since"]))


def public(room: Room) -> dict:
    return {mid: {"state": v["state"], "since": v["since"]} for mid, v in opted(room).items()}


async def publish(room: Room) -> None:
    await hub.broadcast(room.code, "wellbeing:members", {"members": public(room)})


@on("wellbeing:opt")
async def opt(ctx: Ctx, data: dict[str, Any]) -> None:
    w = opted(ctx.room)
    if data["enabled"]:
        w.setdefault(ctx.member.id, {"state": "normal", "since": now_ms()})
    else:
        old = w.pop(ctx.member.id, None)
        if old:
            _tally(ctx.room, ctx.member.id, old)
        lock = ctx.room.ext.get("lock")
        if lock:
            lock["required"].discard(ctx.member.id)
            await _maybe_release(ctx.room)
    await publish(ctx.room)


@on("wellbeing:state")
async def state(ctx: Ctx, data: dict[str, Any]) -> None:
    w = opted(ctx.room)
    if ctx.member.id not in w:
        return  # silently ignore: the member has not opted in
    new = data["state"]
    if new not in STATES:
        raise ValueError(f"state must be one of {STATES}")
    if w[ctx.member.id]["state"] != new:
        _tally(ctx.room, ctx.member.id, w[ctx.member.id])
        w[ctx.member.id] = {"state": new, "since": now_ms()}
        await publish(ctx.room)


# ---------- next-episode lock ----------

def lock_public(room: Room) -> dict | None:
    lock = room.ext.get("lock")
    if not lock:
        return None
    names = {m.id: m.name for m in room.members.values()}
    return {
        "title": lock["media"].get("title"),
        "seconds": STRETCH_SECONDS,
        "seatedOnly": room.settings["seatedOnly"],
        "required": [{"id": m, "name": names.get(m, "?"), "done": m in lock["done"]} for m in sorted(lock["required"])],
    }


async def _publish_lock(room: Room) -> None:
    await hub.broadcast(room.code, "lock:status", {"lock": lock_public(room)})


async def _release(room: Room) -> None:
    lock = room.ext.pop("lock")
    await set_media_for_room(room, lock["media"])
    await _publish_lock(room)
    await system_message(room, f"Everyone stretched — starting {lock['media'].get('title', 'the next episode')}!")


async def set_media_for_room(room: Room, media: dict) -> None:
    room.media = {"kind": media["kind"], "url": str(media["url"]), "title": str(media.get("title") or media["url"]),
                  "id": str(media.get("id") or int(now_ms())), "live": bool(media.get("live"))}
    room.timeline.play(now_ms(), at=0.0)
    await hub.broadcast(room.code, "media:state", {"media": room.media})
    await publish_timeline(room)
    fill_title_later(room)


async def _maybe_release(room: Room) -> None:
    lock = room.ext.get("lock")
    if lock and lock["required"] <= lock["done"]:
        await _release(room)
    elif lock:
        await _publish_lock(room)


@on("episode:next")
async def episode_next(ctx: Ctx, data: dict[str, Any]) -> None:
    room = ctx.room
    if not room.can_control(ctx.member.id):
        return await ctx.error("only the host can start the next episode")
    limit_media(ctx)
    media = {"kind": data["kind"], "url": check_media(ctx, data), "title": data.get("title")}
    online = ctx.hub.online(room.code)
    required = {m for m in opted(room) if m in online} if room.settings["stretchLock"] else set()
    room.timeline.pause(now_ms(), note="Stretch break" if required else None)
    await publish_timeline(room)
    if not required:
        await set_media_for_room(room, media)
        return
    room.ext["lock"] = {"media": media, "required": required, "done": set()}
    await _publish_lock(room)
    await system_message(room, "Next episode unlocks when everyone has stood up and stretched 🧘")


@on("stretch:done")
async def stretch_done(ctx: Ctx, data: dict[str, Any]) -> None:
    last = ctx.room.ext.setdefault("stretch_last", {})
    if now_ms() - last.get(ctx.member.id, 0) > 10_000:  # gate + panel can both report one stretch
        stats.bump(ctx.room, "stretches", ctx.member.id)
    last[ctx.member.id] = now_ms()
    lock = ctx.room.ext.get("lock")
    if not lock or ctx.member.id not in lock["required"]:
        return
    lock["done"].add(ctx.member.id)
    await _maybe_release(ctx.room)


@on("lock:excuse")
async def excuse(ctx: Ctx, data: dict[str, Any]) -> None:
    """Host excuses one member (or everyone with memberId=None) from the stretch."""
    lock = ctx.room.ext.get("lock")
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can excuse a stretch")
    if not lock:
        return
    mid = data.get("memberId")
    if mid is None:
        lock["required"] = set()
    else:
        lock["required"].discard(mid)
    await _maybe_release(ctx.room)


async def on_join(ctx: Ctx) -> None:
    await ctx.reply("wellbeing:members", {"members": public(ctx.room)})
    await ctx.reply("lock:status", {"lock": lock_public(ctx.room)})


async def on_leave(ctx: Ctx) -> None:
    """A required member who disconnects no longer holds the group back."""
    room = ctx.room
    if ctx.member.id in ctx.hub.online(room.code):
        return  # still connected on another device
    lock = room.ext.get("lock")
    if lock and ctx.member.id in lock["required"]:
        lock["required"].discard(ctx.member.id)
        await asyncio.sleep(0)
        await _maybe_release(room)


join_hooks.append(on_join)
leave_hooks.append(on_leave)
