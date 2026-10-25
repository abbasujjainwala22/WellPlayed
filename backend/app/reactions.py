"""Reactions stamped with media time, feeding the post-session heatmap."""

from typing import Any

from app import ratelimit, spoiler
from app.clock import now_ms
from app.realtime import Ctx, on
from app.rooms import Room

KINDS = ("laugh", "cheer", "scream", "gasp", "clap", "heart", "sad", "groan")


def log(room: Room) -> list[dict]:
    return room.ext.setdefault("reactions", [])


@on("reaction:send")
async def reaction_send(ctx: Ctx, data: dict[str, Any]) -> None:
    kind = data["kind"]
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    warned = ctx.room.ext.setdefault("reaction_warned", set())
    if ratelimit.check("reaction", f"{ctx.room.code}:{ctx.member.id}"):
        if ctx.member.id not in warned:  # one notice per burst, not one per tap
            warned.add(ctx.member.id)
            await ctx.error("Easy there! Too many reactions at once, give it a few seconds.")
        return
    warned.discard(ctx.member.id)
    at = data.get("at")
    media_s = float(at) if isinstance(at, int | float) else ctx.room.timeline.position(now_ms())
    event = {"kind": kind, "memberId": ctx.member.id, "name": ctx.member.name,
             "mediaS": media_s, "ts": now_ms()}
    log(ctx.room).append(event)
    await spoiler.broadcast(ctx.room, ctx.member.id, "reaction:event", event)


def heatmap(room: Room, bin_s: float = 5.0) -> list[dict]:
    bins: dict[int, dict[str, int]] = {}
    for r in log(room):
        b = int(r["mediaS"] // bin_s)
        bins.setdefault(b, {}).setdefault(r["kind"], 0)
        bins[b][r["kind"]] += 1
    if not bins:
        return []
    return [
        {"start": b * bin_s, "end": (b + 1) * bin_s, "counts": bins.get(b, {}),
         "total": sum(bins.get(b, {}).values())}
        for b in range(min(bins), max(bins) + 1)
    ]


def top_moments(room: Room, bin_s: float = 5.0, n: int = 5) -> list[dict]:
    """Highest-reaction windows. These are the clip candidates for a highlight reel."""
    moments = sorted((b for b in heatmap(room, bin_s) if b["total"]), key=lambda b: -b["total"])[:n]
    for m in moments:
        m["dominant"] = max(m["counts"], key=m["counts"].get)
    return sorted(moments, key=lambda m: m["start"])
