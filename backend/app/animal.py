"""Animal Chaos: turn someone's call camera into an animal for everyone.

Only the transformation STATE lives here (who, which animal, who did it, a version number).
Face tracking and drawing happen on each viewer's device; frames and landmarks never reach the server.

Each target has a version counter that goes up on every apply and reset. A reset names the version
it saw, so a slow "undo" can never clear a newer prank someone applied in the meantime.
"""

import asyncio
import contextlib
import secrets
from typing import Any

from app import lifecycle, ratelimit
from app.chat import system_message
from app.clock import now_ms
from app.hub import hub
from app.realtime import Ctx, join_hooks, leave_hooks, on
from app.rooms import Member, Room, manager

ANIMALS = {
    "cat": "cat", "dog": "dog", "fox": "fox", "bunny": "bunny", "panda": "panda", "tiger": "tiger",
    "frog": "frog", "raccoon": "raccoon", "bear": "bear", "lion": "lion", "penguin": "penguin", "owl": "owl",
}
RECONNECT_GRACE_S = 60.0  # a target whose socket dropped keeps their animal this long
RATE = (10, 60.0)  # applies + resets per member per minute

_timers: dict[tuple[str, str], asyncio.Task] = {}  # (room code, target id) -> pending grace expiry


def _state(room: Room) -> dict[str, Any]:
    return room.ext.setdefault("animal", {"effects": {}, "versions": {}})


def effects(room: Room) -> dict[str, dict]:
    return _state(room)["effects"]


def public(room: Room) -> dict[str, Any]:
    return {"effects": list(effects(room).values()), "graceSeconds": RECONNECT_GRACE_S}


async def publish(room: Room, change: dict | None = None) -> None:
    await hub.broadcast(room.code, "animal:state", {**public(room), "change": change})


def _bump(room: Room, target_id: str) -> int:
    versions = _state(room)["versions"]
    versions[target_id] = versions.get(target_id, 0) + 1
    return versions[target_id]


def _cancel_timer(code: str, target_id: str) -> None:
    task = _timers.pop((code, target_id), None)
    if task and task is not asyncio.current_task():
        task.cancel()


def _limited(ctx: Ctx) -> bool:
    limit, window = RATE
    return bool(ratelimit.limiter.hit(f"animal:{ctx.room.code}:{ctx.member.id}", limit, window))


def clear(room: Room, target_id: str) -> dict | None:
    """Remove a target's effect (bumping its version). Returns the removed effect, if any."""
    _cancel_timer(room.code, target_id)
    gone = effects(room).pop(target_id, None)
    if gone:
        _bump(room, target_id)
    return gone


def _article(word: str) -> str:
    return "an" if word[:1] in "aeiou" else "a"


@on("animal:apply")
async def animal_apply(ctx: Ctx, data: dict[str, Any]) -> None:
    room = ctx.room
    animal = str(data.get("animal", ""))
    target_id = str(data.get("targetId", ""))
    if animal not in ANIMALS:
        return await ctx.error("Choose one of the animals in the list.", "invalid")
    target = room.members.get(target_id)
    if target is None or target_id not in hub.online(room.code):
        return await ctx.error("That person isn’t in the room right now. Pick someone else.", "not_found")
    if _limited(ctx):
        return await ctx.error(ratelimit.TOO_OFTEN, "rate_limited")
    _cancel_timer(room.code, target_id)
    effect = {
        "id": secrets.token_hex(4),
        "targetId": target.id,
        "targetName": target.name,
        "animal": animal,
        "byId": ctx.member.id,
        "byName": ctx.member.name,
        "version": _bump(room, target.id),
        "createdMs": now_ms(),
        "missingSinceMs": None,
    }
    effects(room)[target.id] = effect
    await publish(room, {"kind": "apply", "effect": effect})
    if data.get("announce"):
        who = "themself" if target.id == ctx.member.id else target.name
        await system_message(room, f"{ctx.member.name} turned {who} into {_article(animal)} {ANIMALS[animal]}.")


@on("animal:reset")
async def animal_reset(ctx: Ctx, data: dict[str, Any]) -> None:
    room = ctx.room
    target_id = str(data.get("targetId", ""))
    current = effects(room).get(target_id)
    if current is None or current["version"] != data.get("version"):
        # someone reset it already, or replaced it with a newer prank: the stale reset does nothing
        await ctx.reply("animal:state", {**public(room), "change": None})
        return await ctx.error("That effect has already changed. The list is up to date now.", "stale")
    if ctx.member.id not in (current["byId"], current["targetId"]):
        return await ctx.error(
            "Only the person who applied this effect, or the person wearing it, can reset it.", "forbidden"
        )
    if _limited(ctx):
        return await ctx.error(ratelimit.TOO_OFTEN, "rate_limited")
    clear(room, target_id)
    await publish(room, {"kind": "reset", "effect": current, "byId": ctx.member.id})


# ── presence: survive short reconnects, clear when the target leaves or the party ends ──

async def _expire(room: Room, target_id: str, version: int) -> None:
    await asyncio.sleep(RECONNECT_GRACE_S)
    _timers.pop((room.code, target_id), None)
    effect = effects(room).get(target_id)
    if manager.rooms.get(room.code) is not room or not effect or effect["version"] != version:
        return
    if target_id in hub.online(room.code):
        return
    clear(room, target_id)
    await publish(room, {"kind": "expired", "effect": effect})


async def _on_join(ctx: Ctx) -> None:
    room = ctx.room
    effect = effects(room).get(ctx.member.id)
    if effect and effect["missingSinceMs"] is not None:
        _cancel_timer(room.code, ctx.member.id)
        effect["missingSinceMs"] = None
        await publish(room)
    else:
        await ctx.reply("animal:state", {**public(room), "change": None})


async def _on_disconnect(ctx: Ctx) -> None:
    room = ctx.room
    effect = effects(room).get(ctx.member.id)
    if not effect or ctx.member.id in hub.online(room.code) or room.members.get(ctx.member.id) is None:
        return
    if manager.rooms.get(room.code) is not room:
        return  # the party ended
    effect["missingSinceMs"] = now_ms()
    _cancel_timer(room.code, ctx.member.id)
    try:
        task = asyncio.get_running_loop().create_task(_expire(room, ctx.member.id, effect["version"]))
    except RuntimeError:
        return
    _timers[(room.code, ctx.member.id)] = task
    await publish(room)


async def _on_left(room: Room, member: Member) -> None:
    gone = clear(room, member.id)
    if gone:
        await publish(room, {"kind": "left", "effect": gone})


async def _on_end(room: Room, _reason: str) -> None:
    for key in [k for k in _timers if k[0] == room.code]:
        task = _timers.pop(key)
        with contextlib.suppress(Exception):
            task.cancel()
    room.ext.pop("animal", None)


join_hooks.append(_on_join)
leave_hooks.append(_on_disconnect)
lifecycle.left_hooks.append(_on_left)
lifecycle.end_hooks.append(_on_end)
