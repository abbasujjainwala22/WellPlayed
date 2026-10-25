from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app import movie, planner
from app.deps import require_member
from app.rooms import Member, Room

router = APIRouter(tags=["movie"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]


@router.get("/api/services")
def services() -> list[dict]:
    return list(planner.SERVICES.values())


@router.get("/api/catalogue")
def catalogue(region: str | None = None, q: str | None = None) -> list[dict]:
    out = list(planner.CATALOGUE.values())
    if q:
        out = [t for t in out if q.lower() in t["title"].lower()]
    if region:
        out = [t for t in out if any(planner.carries(s, t, region.upper()) for s in t["availability"])]
    return out


@router.get("/api/rooms/{code}/plan")
def plan(code: str, auth: Auth, title: Annotated[list[str], Query()]) -> dict:
    room, _ = auth
    titles = [planner.CATALOGUE[t] for t in title if t in planner.CATALOGUE]
    return planner.plan(list(movie.households(room).values()), titles)


@router.get("/api/rooms/{code}/suggestions")
def suggestions(code: str, auth: Auth, limit: int = 10) -> list[dict]:
    room, _ = auth
    return planner.suggestions(list(movie.households(room).values()), movie.swipes(room))[:limit]


@router.get("/api/rooms/{code}/swipe-deck")
def deck(code: str, auth: Auth) -> list[dict]:
    room, member = auth
    seen = {t for t, votes in movie.swipes(room).items() if member.id in votes}
    return [t for t in planner.CATALOGUE.values() if t["id"] not in seen]
