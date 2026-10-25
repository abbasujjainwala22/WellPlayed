from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app import polls, reactions
from app.deps import require_member
from app.rooms import Member, Room

router = APIRouter(prefix="/api/rooms/{code}", tags=["insights"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]


@router.get("/heatmap")
def heatmap(code: str, auth: Auth, bin: float = Query(5.0, ge=1, le=60)) -> dict:
    room, _ = auth
    return {"bin": bin, "bins": reactions.heatmap(room, bin), "top": reactions.top_moments(room, bin)}


@router.get("/highlights")
def highlights(code: str, auth: Auth, n: int = Query(5, ge=1, le=20)) -> dict:
    """Clip candidates around the group's biggest reactions (padding before/after the peak)."""
    room, _ = auth
    out = [{"start": max(0.0, m["start"] - 5), "end": m["end"] + 5, "reaction": m["dominant"],
            "reactions": m["total"]} for m in reactions.top_moments(room, 5.0, n)]
    return {"clips": out}


@router.get("/summary")
def summary(code: str, auth: Auth) -> dict:
    """End-of-session summary: leaderboard, predictions and top reaction moments."""
    room, _ = auth
    return {
        "leaderboard": polls.leaderboard(room),
        "polls": [polls.public(p) for p in polls.polls(room).values()],
        "topMoments": reactions.top_moments(room),
        "reactionCount": len(reactions.log(room)),
    }
