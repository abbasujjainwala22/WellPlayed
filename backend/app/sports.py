"""Sports mode: per-viewer stream lag, calibration markers and spoiler-safe live predictions."""

import secrets
from typing import Any

from app.clock import now_ms
from app.hub import hub
from app.realtime import Ctx, join_hooks, on
from app.rooms import Room
from app.spoiler import MAX_LAG_S, lag_of, lags


def public(room: Room) -> dict:
    return {mid: v for mid, v in lags(room).items()}


async def publish(room: Room) -> None:
    await hub.broadcast(room.code, "lag:state", {"lags": public(room)})


@on("lag:set")
async def lag_set(ctx: Ctx, data: dict[str, Any]) -> None:
    """A viewer states (manual) or measures (auto, e.g. HLS latency) how far behind live they are."""
    source = data.get("source", "manual")
    if source not in ("manual", "auto"):
        raise ValueError("source must be manual or auto")
    cur = lags(ctx.room).get(ctx.member.id)
    if source == "auto" and cur and cur["source"] in ("manual", "marker"):
        return  # never overwrite a deliberate calibration with an automatic estimate
    lag = max(0.0, min(float(data["lag"]), MAX_LAG_S))
    lags(ctx.room)[ctx.member.id] = {"lag": lag, "source": source}
    await publish(ctx.room)


@on("sync:marker")
async def marker(ctx: Ctx, data: dict[str, Any]) -> None:
    """Host announces 'a recognisable event is about to happen'; viewers tap when they see it."""
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can start calibration")
    m = {"id": secrets.token_hex(3), "startedMs": now_ms(), "taps": {}}
    ctx.room.ext["marker"] = m
    await hub.broadcast(ctx.room.code, "sync:marker", {"id": m["id"], "label": str(data.get("label", "the next whistle"))})


@on("sync:saw")
async def saw(ctx: Ctx, data: dict[str, Any]) -> None:
    m = ctx.room.ext.get("marker")
    if not m or m["id"] != data.get("markerId"):
        return await ctx.error("calibration is not active")
    m["taps"].setdefault(ctx.member.id, now_ms())
    first = min(m["taps"].values())
    for mid, tap in m["taps"].items():
        lags(ctx.room)[mid] = {"lag": min((tap - first) / 1000, MAX_LAG_S), "source": "marker"}
    await publish(ctx.room)


@on("sync:marker-end")
async def marker_end(ctx: Ctx, data: dict[str, Any]) -> None:
    if ctx.member.id != ctx.room.host_id:
        return
    ctx.room.ext.pop("marker", None)
    await hub.broadcast(ctx.room.code, "sync:marker", {"id": None})


def closes_in_content_ms(room: Room, host_id: str, duration_s: float) -> float:
    """Content-time (fastest-feed clock, ms) at which a live prediction closes."""
    return now_ms() - lag_of(room, host_id) * 1000 + duration_s * 1000


def answer_allowed(room: Room, poll: dict, member_id: str) -> bool:
    closes = poll.get("closesAtContentMs")
    if closes is None or not room.settings.get("spoilerSafe"):
        return True
    return now_ms() - lag_of(room, member_id) * 1000 <= closes


async def send_lags(ctx: Ctx) -> None:
    await ctx.reply("lag:state", {"lags": public(ctx.room)})


join_hooks.append(send_lags)
