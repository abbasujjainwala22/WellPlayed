"""Hangout mode: a shared queue everyone adds to, with majority skip votes."""

import math
import secrets
from typing import Any

from app.chat import system_message
from app.clock import now_ms
from app.hub import hub
from app.media_meta import fetch_title
from app.playback import check_media, limit_media, publish_timeline
from app.realtime import Ctx, join_hooks
from app.realtime import on as on_msg
from app.rooms import Room
from app.wellbeing import set_media_for_room

MAX_QUEUE = 50


def q(room: Room) -> dict:
    return room.ext.setdefault("queue", {"items": [], "current": None, "votes": set()})


def public(room: Room) -> dict:
    s = q(room)
    online = len(hub.online(room.code)) or 1
    return {"items": s["items"], "current": s["current"], "votes": len(s["votes"]),
            "needed": math.ceil(online / 2), "voters": sorted(s["votes"])}


async def publish(room: Room) -> None:
    await hub.broadcast(room.code, "queue:state", {"queue": public(room)})


def _yt(url: str) -> bool:
    return "youtu" in url or (len(url.strip()) == 11 and " " not in url)


async def advance(room: Room, announce: str | None = None) -> None:
    s = q(room)
    s["votes"] = set()
    if not s["items"]:
        s["current"] = None
        await publish(room)
        if announce:
            await system_message(room, "Queue is empty — add something!")
        return
    item = s["items"].pop(0)
    s["current"] = item
    await set_media_for_room(room, {"kind": item["kind"], "url": item["url"], "title": item["title"], "id": item["id"]})
    await publish(room)
    if announce:
        await system_message(room, f"{announce} Now playing: {item['title']}")


@on_msg("queue:add")
async def add(ctx: Ctx, data: dict[str, Any]) -> None:
    s = q(ctx.room)
    if len(s["items"]) >= MAX_QUEUE:
        return await ctx.error("the queue is full")
    url = str(data["url"]).strip()
    if not url:
        raise ValueError("url required")
    kind = data.get("kind") or ("youtube" if _yt(url) else "html5")
    limit_media(ctx)
    url = check_media(ctx, {**data, "kind": kind, "url": url})
    title = str(data.get("title") or "").strip()[:120]
    item = {"id": secrets.token_hex(3), "kind": kind, "url": url, "title": title or url,
            "addedBy": ctx.member.id, "addedByName": ctx.member.name}
    s["items"].append(item)
    if s["current"] is None and len(s["items"]) == 1 and ctx.room.media is None:
        await advance(ctx.room)  # first track starts right away in an empty room
    else:
        await publish(ctx.room)
    if not title and kind == "youtube":
        found = await fetch_title(url)
        if found:
            for it in [*s["items"], s["current"]]:
                if it and it["id"] == item["id"]:
                    it["title"] = found
            await publish(ctx.room)


@on_msg("queue:remove")
async def remove(ctx: Ctx, data: dict[str, Any]) -> None:
    s = q(ctx.room)
    for it in s["items"]:
        if it["id"] == data["id"]:
            if ctx.member.id not in (it["addedBy"], ctx.room.host_id):
                return await ctx.error("only the person who added it or the host can remove it")
            s["items"].remove(it)
            return await publish(ctx.room)


@on_msg("queue:move")
async def move(ctx: Ctx, data: dict[str, Any]) -> None:
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can reorder")
    items = q(ctx.room)["items"]
    i = next(i for i, it in enumerate(items) if it["id"] == data["id"])
    j = max(0, min(len(items) - 1, i + int(data["delta"])))
    items.insert(j, items.pop(i))
    await publish(ctx.room)


@on_msg("queue:skip-vote")
async def skip_vote(ctx: Ctx, data: dict[str, Any]) -> None:
    s = q(ctx.room)
    if s["current"] is None:
        return
    s["votes"] ^= {ctx.member.id}  # toggle
    if len(s["votes"]) >= math.ceil(len(hub.online(ctx.room.code)) / 2):
        await advance(ctx.room, "Skipped by vote.")
    else:
        await publish(ctx.room)


@on_msg("queue:skip")
async def skip(ctx: Ctx, data: dict[str, Any]) -> None:
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can skip instantly")
    await advance(ctx.room, "Skipped by host.")


@on_msg("queue:ended")
async def ended(ctx: Ctx, data: dict[str, Any]) -> None:
    """Any viewer's player reports the track finished; the first report for the current track wins.

    Outside a queue, the room pauses at the end instead of running its timeline past the video.
    """
    room = ctx.room
    cur = q(room)["current"]
    if cur and cur["id"] == data.get("mediaId"):
        await advance(room, "Up next.")
    elif (
        room.media
        and room.media.get("id") == data.get("mediaId")
        and not room.media.get("live")
        and room.timeline.state == "playing"
    ):
        at = data.get("at")
        room.timeline.pause(now_ms(), at=float(at) if at is not None else None, note="Finished")
        await publish_timeline(room)


async def send_state(ctx: Ctx) -> None:
    await ctx.reply("queue:state", {"queue": public(ctx.room)})


join_hooks.append(send_state)
