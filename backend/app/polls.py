"""Polls, predictions and quizzes sharing one entity, plus the session leaderboard.

Answers are locked in (cannot be changed) and timestamped by the server, so predictions
can't be edited after the fact and quiz speed is measured fairly.
"""

import secrets
from typing import Any

from app import spoiler, sports
from app.clock import now_ms
from app.hub import hub
from app.realtime import Ctx, join_hooks, on
from app.rooms import Room

KINDS = ("poll", "prediction", "quiz")
QUIZ_BASE_POINTS = 100
PREDICTION_POINTS = 50


def polls(room: Room) -> dict[str, dict]:
    return room.ext.setdefault("polls", {})


def scores(room: Room) -> dict[str, int]:
    return room.ext.setdefault("scores", {})


def public(poll: dict, member_id: str | None = None) -> dict:
    counts = [0] * len(poll["options"])
    for a in poll["answers"].values():
        counts[a["option"]] += 1
    out = {
        "id": poll["id"], "kind": poll["kind"], "question": poll["question"],
        "options": poll["options"], "state": poll["state"], "counts": counts,
        "answered": len(poll["answers"]), "points": poll["points"],
        "createdMediaS": poll["createdMediaS"],
        "source": poll.get("source", "member"), "sharedBy": poll.get("sharedBy"),
        "mine": poll["answers"].get(member_id, {}).get("option") if member_id else None,
    }
    if poll["state"] == "revealed":
        out["correct"] = poll["correct"]
        out["results"] = poll["results"]
    return out


def leaderboard(room: Room) -> list[dict]:
    rows = [
        {"memberId": m.id, "name": m.name, "points": scores(room).get(m.id, 0)}
        for m in room.members.values()
    ]
    # members pruned for inactivity keep the points they earned
    rows += [{"memberId": mid, "name": name, "points": scores(room)[mid]}
             for mid, name in room.former.items() if scores(room).get(mid)]
    return sorted(rows, key=lambda r: (-r["points"], r["name"]))


async def publish(room: Room, poll: dict, sender_id: str | None = None) -> None:
    data = {"poll": public(poll)}
    if poll["state"] == "revealed":  # outcomes can spoil a live moment for slower feeds
        await spoiler.broadcast(room, sender_id or room.host_id, "poll:state", data)
    else:
        await hub.broadcast(room.code, "poll:state", data)


def create_poll(room: Room, kind: str, question: str, options: list[str], correct: int | None,
                points: int | None, created_by: str) -> dict:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}")
    options = [str(o).strip() for o in options if str(o).strip()]
    if not question.strip() or len(options) < 2:
        raise ValueError("a poll needs a question and at least two options")
    if correct is not None and not 0 <= correct < len(options):
        raise ValueError("correct option out of range")
    poll = {
        "id": secrets.token_hex(4), "kind": kind, "question": question.strip()[:300],
        "options": [{"id": i, "text": o[:120]} for i, o in enumerate(options[:8])],
        "correct": correct, "state": "open", "answers": {}, "results": [],
        "points": points if points is not None else
        (QUIZ_BASE_POINTS if kind == "quiz" else PREDICTION_POINTS if kind == "prediction" else 0),
        "openedAtMs": now_ms(), "createdBy": created_by,
        "createdMediaS": room.timeline.position(now_ms()),
    }
    polls(room)[poll["id"]] = poll
    return poll


def award(room: Room, poll: dict) -> None:
    """Score a poll whose correct option is set. Quiz: faster correct answers earn more."""
    correct = poll["correct"]
    poll["results"] = []
    if correct is None:
        return
    right = sorted(
        ((mid, a) for mid, a in poll["answers"].items() if a["option"] == correct),
        key=lambda kv: kv[1]["tsMs"],
    )
    for rank, (mid, a) in enumerate(right):
        factor = max(0.5, 1 - 0.1 * rank) if poll["kind"] == "quiz" else 1.0
        pts = round(poll["points"] * factor)
        scores(room)[mid] = scores(room).get(mid, 0) + pts
        poll["results"].append({
            # they may have left since answering (leaving removes the member), so never index members
            "memberId": mid, "name": room.member_name(mid, a.get("name", "Someone")), "points": pts,
            "elapsedMs": round(a["tsMs"] - poll["openedAtMs"]),
        })


def _require_host(ctx: Ctx) -> bool:
    return ctx.member.id == ctx.room.host_id


@on("poll:create")
async def poll_create(ctx: Ctx, data: dict[str, Any]) -> None:
    if not _require_host(ctx):
        return await ctx.error("only the host can create polls")
    poll = create_poll(ctx.room, data.get("kind", "poll"), data["question"], data["options"],
                       data.get("correct"), data.get("points"), ctx.member.id)
    if data.get("durationS"):  # live prediction: closes at a content-time, not a wall-clock time
        poll["closesAtContentMs"] = sports.closes_in_content_ms(ctx.room, ctx.member.id, float(data["durationS"]))
    await publish(ctx.room, poll)


@on("poll:answer")
async def poll_answer(ctx: Ctx, data: dict[str, Any]) -> None:
    poll = polls(ctx.room)[data["pollId"]]
    option = int(data["option"])
    if poll["state"] != "open":
        return await ctx.error("this poll is locked")
    if not sports.answer_allowed(ctx.room, poll, ctx.member.id):
        return await ctx.error("predictions closed for your stream")
    if not 0 <= option < len(poll["options"]):
        raise ValueError("option out of range")
    if ctx.member.id in poll["answers"]:
        return await ctx.error("your answer is locked in")
    poll["answers"][ctx.member.id] = {"option": option, "tsMs": now_ms(), "name": ctx.member.name}
    await ctx.reply("poll:state", {"poll": public(poll, ctx.member.id)})
    await hub.broadcast(ctx.room.code, "poll:counts", {
        "id": poll["id"], "counts": public(poll)["counts"], "answered": len(poll["answers"]),
    }, exclude=None)


@on("poll:lock")
async def poll_lock(ctx: Ctx, data: dict[str, Any]) -> None:
    if not _require_host(ctx):
        return await ctx.error("only the host can lock polls")
    poll = polls(ctx.room)[data["pollId"]]
    if poll["state"] == "open":
        poll["state"] = "locked"
    await publish(ctx.room, poll)


@on("poll:reveal")
async def poll_reveal(ctx: Ctx, data: dict[str, Any]) -> None:
    if not _require_host(ctx):
        return await ctx.error("only the host can reveal")
    poll = polls(ctx.room)[data["pollId"]]
    if poll["state"] == "revealed":
        return
    if data.get("correct") is not None:
        poll["correct"] = int(data["correct"])
    poll["state"] = "revealed"
    award(ctx.room, poll)
    await publish(ctx.room, poll, ctx.member.id)
    await spoiler.broadcast(ctx.room, ctx.member.id, "leaderboard:state", {"leaderboard": leaderboard(ctx.room)})


async def send_all(ctx: Ctx) -> None:
    room = ctx.room
    await ctx.reply("poll:list", {"polls": [public(p, ctx.member.id) for p in polls(room).values()][-30:]})
    await ctx.reply("leaderboard:state", {"leaderboard": leaderboard(room)})


join_hooks.append(send_all)
