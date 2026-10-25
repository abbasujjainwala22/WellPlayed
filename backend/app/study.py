"""Study mode: quiz breaks. The video pauses at planned moments for a timed quiz, fastest correct answer scores most."""

import asyncio
import logging
import os
import secrets
from typing import Any

from app import polls
from app.clock import now_ms
from app.hub import hub
from app.playback import publish_timeline, timeline_hooks
from app.realtime import Ctx, join_hooks, on
from app.rooms import Room

log = logging.getLogger(__name__)
QUIZ_SECONDS = float(os.environ.get("WP_QUIZ_SECONDS", "20"))
RESUME_AFTER_REVEAL_S = 6.0


def plan(room: Room) -> list[dict]:
    return room.ext.setdefault("study_plan", [])


def public_plan(room: Room) -> list[dict]:
    return [{"id": q["id"], "at": q["at"], "fired": q["fired"], "question": q["question"]} for q in plan(room)]


async def publish_plan(room: Room) -> None:
    await hub.broadcast(room.code, "study:plan", {"plan": public_plan(room)})


def set_plan(room: Room, questions: list[dict]) -> None:
    room.ext["study_plan"] = [
        {"id": secrets.token_hex(3), "fired": False, **q} for q in sorted(questions, key=lambda q: q["at"])
    ]


def _cancel(room: Room) -> None:
    t = room.ext.pop("study_task", None)
    if t:
        t.cancel()


def _spawn(room: Room, coro) -> None:
    task = asyncio.create_task(coro)

    def done(t: asyncio.Task) -> None:
        if not t.cancelled() and t.exception():
            log.error("study task failed", exc_info=t.exception())

    task.add_done_callback(done)
    room.ext["study_task"] = task


async def reschedule(room: Room) -> None:
    """Called whenever the timeline changes: arm a timer for the next unfired quiz break."""
    _cancel(room)
    t = room.timeline
    if t.state != "playing":
        return
    now = now_ms()
    pos = t.position(now)
    upcoming = [q for q in plan(room) if not q["fired"] and q["at"] >= pos - 0.25]
    if not upcoming:
        return
    q = upcoming[0]
    delay = max(0.0, (q["at"] - pos) / t.rate + max(0.0, (t.anchor_server_ms - now) / 1000))
    _spawn(room, _fire_after(room, q["id"], delay))


async def _fire_after(room: Room, qid: str, delay: float) -> None:
    await asyncio.sleep(delay)
    room.ext.pop("study_task", None)
    q = next((x for x in plan(room) if x["id"] == qid), None)
    if not q or q["fired"]:
        return
    q["fired"] = True
    room.timeline.pause(now_ms(), at=q["at"], note="Quiz break")
    await publish_timeline(room)
    poll = polls.create_poll(room, "quiz", q["question"], q["options"], q["correct"], None, room.host_id)
    poll["fromBreak"] = True
    await polls.publish(room, poll)
    await publish_plan(room)
    _spawn(room, _finish_quiz(room, poll["id"]))


async def _finish_quiz(room: Room, poll_id: str) -> None:
    await asyncio.sleep(QUIZ_SECONDS)
    poll = polls.polls(room)[poll_id]
    if poll["state"] == "open":
        poll["state"] = "locked"
        await polls.publish(room, poll)
    if poll["state"] != "revealed":
        poll["state"] = "revealed"
        polls.award(room, poll)
        await polls.publish(room, poll)
        await hub.broadcast(room.code, "leaderboard:state", {"leaderboard": polls.leaderboard(room)})
    await asyncio.sleep(RESUME_AFTER_REVEAL_S)
    room.ext.pop("study_task", None)
    if room.timeline.note == "Quiz break":
        room.timeline.play(now_ms())
        await publish_timeline(room)


@on("study:set-plan")
async def set_plan_msg(ctx: Ctx, data: dict[str, Any]) -> None:
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can edit quiz breaks")
    qs = []
    for q in data["questions"]:
        opts = [str(o) for o in q["options"]][:6]
        if len(opts) < 2 or not 0 <= int(q["correct"]) < len(opts):
            raise ValueError("each question needs 2+ options and a valid correct index")
        qs.append({"at": float(q["at"]), "question": str(q["question"]), "options": opts, "correct": int(q["correct"])})
    set_plan(ctx.room, qs)
    await publish_plan(ctx.room)
    await reschedule(ctx.room)


@on("study:skip")
async def skip(ctx: Ctx, data: dict[str, Any]) -> None:
    """Host ends the current quiz break early (reveal + resume right away)."""
    if ctx.member.id != ctx.room.host_id:
        return await ctx.error("only the host can skip")
    _cancel(ctx.room)
    for p in polls.polls(ctx.room).values():
        if p.get("fromBreak") and p["state"] != "revealed":
            p["state"] = "revealed"
            polls.award(ctx.room, p)
            await polls.publish(ctx.room, p)
            await hub.broadcast(ctx.room.code, "leaderboard:state", {"leaderboard": polls.leaderboard(ctx.room)})
    if ctx.room.timeline.note == "Quiz break":
        ctx.room.timeline.play(now_ms())
        await publish_timeline(ctx.room)


async def send_plan(ctx: Ctx) -> None:
    await ctx.reply("study:plan", {"plan": public_plan(ctx.room)})


join_hooks.append(send_plan)
timeline_hooks.append(reschedule)
