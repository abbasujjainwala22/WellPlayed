"""Movie-night realtime handlers: households and swipe voting."""

import secrets
from typing import Any

from app.hub import hub
from app.planner import CATALOGUE, SERVICES, Household
from app.playback import set_media
from app.realtime import Ctx, join_hooks, on
from app.rooms import Room

VOTES = ("like", "dislike", "super")


def households(room: Room) -> dict[str, Household]:
    return room.ext.setdefault("households", {})


def swipes(room: Room) -> dict[str, dict[str, str]]:
    return room.ext.setdefault("swipes", {})


def household_view(room: Room) -> list[dict]:
    out = []
    for h in households(room).values():
        members = [m.name for m in room.members.values() if m.household_id == h.id]
        out.append({"id": h.id, "name": h.name, "region": h.region, "size": h.size,
                    "services": h.services, "members": members})
    return out


async def publish(room: Room) -> None:
    await hub.broadcast(room.code, "household:state", {"households": household_view(room)})


@on("household:upsert")
async def household_upsert(ctx: Ctx, data: dict[str, Any]) -> None:
    room = ctx.room
    hid = data.get("id")
    if hid and hid in households(room):
        if ctx.member.household_id != hid and ctx.member.id != room.host_id:
            return await ctx.error("you can only edit your own household")
        h = households(room)[hid]
    else:
        h = Household(id=secrets.token_hex(3), name="")
        households(room)[h.id] = h
        ctx.member.household_id = h.id
    h.name = str(data.get("name") or h.name or f"{ctx.member.name}'s place")[:40]
    h.region = str(data.get("region") or h.region or "AU").upper()[:2]
    h.size = max(1, min(int(data.get("size", h.size or 1)), 30))
    services = [s for s in data.get("services", h.services) if s in SERVICES]
    h.services = list(dict.fromkeys(services))
    await publish(room)
    await ctx.reply("household:mine", {"id": h.id})
    await hub.broadcast(room.code, "members:state", {"members": [m.public() for m in room.members.values()]})


@on("household:join")
async def household_join(ctx: Ctx, data: dict[str, Any]) -> None:
    hid = data["householdId"]
    if hid not in households(ctx.room):
        raise KeyError("unknown household")
    ctx.member.household_id = hid
    await publish(ctx.room)
    await hub.broadcast(ctx.room.code, "members:state",
                        {"members": [m.public() for m in ctx.room.members.values()]})


@on("swipe:vote")
async def swipe_vote(ctx: Ctx, data: dict[str, Any]) -> None:
    title, vote = data["titleId"], data["vote"]
    if title not in CATALOGUE or vote not in VOTES:
        raise ValueError("unknown title or vote")
    swipes(ctx.room).setdefault(title, {})[ctx.member.id] = vote
    await hub.broadcast(ctx.room.code, "swipe:progress", {
        "titleId": title, "votes": len(swipes(ctx.room)[title]),
    })


@on("title:pick")
async def title_pick(ctx: Ctx, data: dict[str, Any]) -> None:
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can pick the title")
    t = CATALOGUE[data["titleId"]]
    media = t.get("media") or {"kind": "external", "url": ""}
    await set_media(ctx, {**media, "title": t["title"]})


async def send_state(ctx: Ctx) -> None:
    await ctx.reply("household:state", {"households": household_view(ctx.room)})


join_hooks.append(send_state)
