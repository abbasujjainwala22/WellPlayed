"""Timeline control: media selection, play, pause, seek, rate."""

from collections.abc import Awaitable, Callable
from typing import Any

from app import ratelimit, sources
from app.chat import system_message
from app.clock import now_ms
from app.errors import UserError
from app.hub import hub
from app.media_meta import fill_title_later
from app.realtime import Ctx, on
from app.rooms import Room

MEDIA_KINDS = ("youtube", "html5", "hls", "external")
COUNTDOWN_S = 10


timeline_hooks: list[Callable[[Room], Awaitable[None]]] = []  # e.g. study quiz scheduling


async def publish_timeline(room: Room) -> None:
    """Broadcast the timeline and notify features that depend on playback position."""
    await hub.broadcast(room.code, "timeline:state", room.timeline.snapshot())
    for hook in timeline_hooks:
        await hook(room)


async def broadcast_timeline(ctx: Ctx) -> None:
    await publish_timeline(ctx.room)


def check_media(ctx: Ctx, data: dict[str, Any]) -> str:
    """Validate a requested source; returns the cleaned URL or raises UserError with the reason."""
    kind = data["kind"]
    if kind not in MEDIA_KINDS:
        raise ValueError(f"kind must be one of {MEDIA_KINDS}")
    return sources.validate(kind, data.get("url"), same_host=ctx.conn.ws.headers.get("host"),
                            explicit=bool(data.get("explicit")))


def limit_media(ctx: Ctx) -> None:
    if ratelimit.check("media", f"{ctx.room.code}:{ctx.member.id}"):
        raise UserError("You're changing the video too often. Please wait a moment.")


async def set_media(ctx: Ctx, data: dict[str, Any]) -> None:
    kind = data["kind"]
    url = check_media(ctx, data)
    ctx.room.media = {
        "kind": kind,
        "url": url,
        "title": str(data.get("title") or "")[:200] or url,
        "id": data.get("id") or str(int(now_ms())),
        "live": bool(data.get("live")),  # live streams free-run; there is no shared timeline to sync
    }
    ctx.room.timeline.pause(now_ms(), at=0.0)
    await ctx.broadcast("media:state", {"media": ctx.room.media})
    await broadcast_timeline(ctx)
    fill_title_later(ctx.room)


@on("media:set")
async def media_set(ctx: Ctx, data: dict[str, Any]) -> None:
    if not ctx.room.can_control(ctx.member.id):
        return await ctx.error("only the host can change the media")
    limit_media(ctx)
    await set_media(ctx, data)


@on("countdown:start")
async def countdown_start(ctx: Ctx, data: dict[str, Any]) -> None:
    """Honest fallback for services we can't embed: everyone opens it themselves and presses play together."""
    if not ctx.room.can_control(ctx.member.id):
        return await ctx.error("only the host can start a countdown")
    limit_media(ctx)
    url = str(data.get("url") or "").strip()
    if url:
        sources.validate("external", url)  # https only, no credentials
    provider = str(data.get("provider") or sources.provider_for(url) or "your streaming service")[:40]
    ends = now_ms() + COUNTDOWN_S * 1000
    await ctx.broadcast("countdown:state", {"endsAtServerMs": ends, "seconds": COUNTDOWN_S, "provider": provider,
                                            "url": url or None, "by": ctx.member.name})
    where = f" {url}" if url else ""
    await system_message(
        ctx.room, f"🎬 {ctx.member.name} started a countdown. Open {provider} and press play when it hits zero.{where}"
    )


@on("timeline:set")
async def timeline_set(ctx: Ctx, data: dict[str, Any]) -> None:
    if not ctx.room.can_control(ctx.member.id):
        return await ctx.error("only the host can control playback")
    t, now = ctx.room.timeline, now_ms()
    action = data["action"]
    if action == "play":
        t.play(now, at=data.get("at"))
    elif action == "pause":
        t.pause(now, at=data.get("at"))
    elif action == "seek":
        t.seek(now, float(data["to"]))
    elif action == "rate":
        rate = float(data["rate"])
        if not 0.5 <= rate <= 2.0:
            raise ValueError("rate must be between 0.5 and 2.0")
        t.set_rate(now, rate)
    else:
        raise ValueError(f"unknown action {action!r}")
    await broadcast_timeline(ctx)


@on("settings:set")
async def settings_set(ctx: Ctx, data: dict[str, Any]) -> None:
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can change settings")
    for key in ctx.room.settings:
        if key in data:
            ctx.room.settings[key] = bool(data[key])
    await ctx.broadcast("settings:state", {"settings": ctx.room.settings})
