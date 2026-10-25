"""Buffer forecasting: pause *before* someone's stream stalls instead of during it.

Each screen reports how many seconds it has buffered ahead. We keep an EWMA of the net buffer
change per second while playing (negative = draining), predict the buffer HORIZON_S seconds
ahead, and look at the weakest member:
  predicted < SAFE_S      -> tell everyone to preload further ("boost")
  predicted < CRITICAL_S  -> planned, announced pause that resumes once the weakest has caught up
  someone already stalled -> pause immediately (reactive fallback)
"""

from dataclasses import dataclass
from typing import Any

from app import stats
from app.chat import system_message
from app.clock import now_ms
from app.hub import hub
from app.playback import publish_timeline
from app.realtime import Ctx, leave_hooks, on
from app.rooms import Room

HORIZON_S = 10.0
SAFE_S = 4.0
CRITICAL_S = 1.0
RESUME_TARGET_S = 6.0
MAX_PLANNED_PAUSE_S = 25.0
COOLDOWN_S = 15.0
ALPHA = 0.5


@dataclass
class MemberBuf:
    buffer: float = 0.0
    t: float | None = None  # client timestamp (ms) of the last sample
    slope: float = 0.0  # net seconds of buffer gained per second of wall-clock, while playing
    buffering: bool = False
    bandwidth_kbps: float | None = None

    def update(self, buffer: float, t: float, playing: bool, buffering: bool, bandwidth: float | None = None) -> None:
        if playing and self.t is not None and t > self.t:
            inst = (buffer - self.buffer) / ((t - self.t) / 1000)
            self.slope = ALPHA * inst + (1 - ALPHA) * self.slope
        elif not playing:
            self.slope = 0.0
        self.buffer, self.t, self.buffering = buffer, t, buffering
        if bandwidth is not None:
            self.bandwidth_kbps = bandwidth

    def predict(self, horizon: float = HORIZON_S) -> float:
        return max(0.0, self.buffer + self.slope * horizon)


@dataclass
class Decision:
    kind: str  # "none" | "boost" | "pause"
    weakest: str | None = None
    reason: str = ""


def decide(members: dict[str, MemberBuf], playing: bool) -> Decision:
    if not playing or not members:
        return Decision("none")
    for mid, m in members.items():
        if m.buffering:
            return Decision("pause", mid, "stalled")
    weakest = min(members, key=lambda k: members[k].predict())
    pred = members[weakest].predict()
    if pred < CRITICAL_S:
        return Decision("pause", weakest, f"predicted {pred:.1f}s of buffer in {HORIZON_S:.0f}s")
    if pred < SAFE_S:
        return Decision("boost", weakest, f"predicted {pred:.1f}s")
    return Decision("none", weakest)


def ready_to_resume(members: dict[str, MemberBuf]) -> bool:
    return all(m.buffer >= RESUME_TARGET_S and not m.buffering for m in members.values())


def state(room: Room) -> dict:
    return room.ext.setdefault("buffer", {"members": {}, "pause": None, "cooldown_until": 0.0, "last_pub": 0.0})


def status(room: Room) -> dict:
    s = state(room)
    names = {m.id: m.name for m in room.members.values()}
    rows = [{"id": mid, "name": names.get(mid, "?"), "bufferS": round(m.buffer, 1), "predictedS": round(m.predict(), 1),
             "buffering": m.buffering, "bandwidthKbps": m.bandwidth_kbps} for mid, m in s["members"].items()]
    return {"members": rows, "planned": bool(s["pause"]), "horizonS": HORIZON_S}


async def _publish(room: Room, force: bool = False) -> None:
    s = state(room)
    now = now_ms()
    if force or now - s["last_pub"] >= 1000:
        s["last_pub"] = now
        await hub.broadcast(room.code, "buffer:status", status(room))


@on("telemetry:buffer")
async def telemetry(ctx: Ctx, data: dict[str, Any]) -> None:
    if ctx.conn.device != "screen":
        return  # companions don't play video
    room = ctx.room
    s = state(room)
    playing = room.timeline.state == "playing"
    m = s["members"].setdefault(ctx.member.id, MemberBuf())
    if data.get("buffering") and not m.buffering:
        stats.bump(room, "stalls", ctx.member.id)
    m.update(float(data["bufferAheadS"]), float(data.get("t", now_ms())), playing, bool(data.get("buffering")),
             data.get("bandwidthKbps"))
    now = now_ms()

    if s["pause"]:  # planned pause in progress: resume once everyone has caught up
        waited = (now - s["pause"]["since"]) / 1000
        if ready_to_resume(s["members"]) or waited >= MAX_PLANNED_PAUSE_S:
            s["pause"] = None
            s["cooldown_until"] = now + COOLDOWN_S * 1000
            room.timeline.play(now)
            await publish_timeline(room)
            await system_message(room, "Everyone has caught up — resuming.")
        await _publish(room)
        return

    d = decide(s["members"], playing)
    if d.kind == "boost":
        await hub.broadcast(room.code, "preload:boost", {"seconds": 45})
    elif d.kind == "pause" and now >= s["cooldown_until"]:
        weakest = room.members[d.weakest].name if d.weakest in room.members else "Someone"
        s["pause"] = {"since": now, "member": d.weakest}
        room.timeline.pause(now, note=f"{weakest}'s connection is catching up")
        await publish_timeline(room)
        what = "stalled" if d.reason == "stalled" else "is about to run out of buffer"
        await system_message(room, f"Paused briefly: {weakest} {what}. Resuming automatically.")
        await hub.broadcast(room.code, "preload:boost", {"seconds": 60})
    await _publish(room, force=d.kind != "none")


async def forget(ctx: Ctx) -> None:
    """A member who leaves must not hold the group in a planned pause."""
    s = state(ctx.room)
    if ctx.member.id in hub.online(ctx.room.code):
        return
    s["members"].pop(ctx.member.id, None)
    if s["pause"] and (not s["members"] or ready_to_resume(s["members"])):
        s["pause"] = None
        ctx.room.timeline.play(now_ms())
        await publish_timeline(ctx.room)


leave_hooks.append(forget)
