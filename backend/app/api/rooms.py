from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app import lifecycle, ratelimit
from app.config import get_settings
from app.deps import require_member
from app.diagnostics import log_event
from app.errors import ApiError
from app.hub import hub
from app.rooms import MODES, Member, Room, RoomFull, RoomGone, manager

router = APIRouter(prefix="/api/rooms", tags=["rooms"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]

# The handlers below are `async def` on purpose, even though they never await: sync handlers run in a
# threadpool, where two joins could both pass the capacity check, and they would mutate room.members
# while the event loop iterates it. On the loop, each one runs start to finish without interleaving.


class CreateRoom(BaseModel):
    name: str = Field(default="Watch party", max_length=60)
    mode: str = "movie"
    display_name: str = Field(max_length=40)
    language: str = "en"


class JoinRoom(BaseModel):
    display_name: str = Field(max_length=40)
    language: str = "en"
    household_id: str | None = None
    # random per-tab key kept until the join succeeds: a retried or double-clicked join gets the same seat
    join_key: str | None = Field(default=None, min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class Session(BaseModel):
    code: str
    member_id: str
    token: str
    name: str = ""  # kept with the saved session so "Rejoin" can prefill it


def _limit(bucket: str, request: Request) -> None:
    wait = ratelimit.check(bucket, ratelimit.client_ip(request))
    if wait:
        raise ApiError(429, ratelimit.TOO_OFTEN, "rate_limited", headers={"Retry-After": str(int(wait) + 1)})


def _room(code: str) -> Room:
    try:
        return manager.get(code)
    except RoomGone as exc:
        raise ApiError(410, exc.message, "room_ended") from exc
    except KeyError as exc:
        raise ApiError(404, "We couldn't find a party with that code.", "room_not_found") from exc


@router.get("/modes")
def modes() -> list[str]:
    return list(MODES)


@router.post("", response_model=Session)
async def create_room(body: CreateRoom, request: Request) -> Session:
    _limit("create", request)
    try:
        room, host = manager.create(body.name, body.mode, body.display_name, body.language)
    except ValueError as exc:
        raise ApiError(422, str(exc), "invalid_mode") from exc
    log_event("create", room.code, host.id, mode=room.mode)
    return Session(code=room.code, member_id=host.id, token=host.token, name=host.name)


@router.post("/{code}/join", response_model=Session)
async def join_room(code: str, body: JoinRoom, request: Request) -> Session:
    room = _room(code)
    known = body.join_key is not None and room.members.get(room.join_keys.get(body.join_key, "")) is not None
    if not known:  # a retry of a join that already worked is free
        _limit("join", request)
    try:
        member = manager.join(
            room.code, body.display_name, body.language, body.household_id,
            online=hub.online(room.code), limit=get_settings().wp_max_participants, join_key=body.join_key,
        )
    except RoomFull as exc:
        raise ApiError(403, str(exc), "room_full") from exc
    log_event("join", room.code, member.id, repeat=known or None)
    return Session(code=room.code, member_id=member.id, token=member.token, name=member.name)


@router.get("/{code}")
async def room_info(code: str) -> dict:
    """Public preview for the join page (no member details)."""
    room = _room(code)
    limit = get_settings().wp_max_participants
    active = room.active_count(hub.online(room.code))
    return {"code": room.code, "name": room.name, "mode": room.mode, "members": active, "limit": limit,
            "full": active >= limit}


@router.post("/{code}/leave")
async def leave_room(code: str, auth: Auth) -> dict:
    """Leave for good: the seat frees up and this token stops working."""
    room, member = auth
    return await lifecycle.leave(room, member)


@router.post("/{code}/end")
async def end_room(code: str, auth: Auth) -> dict:
    """Host only: remove everyone, and the invite stops working."""
    room, member = auth
    if member.id != room.host_id:
        raise ApiError(403, "Only the host can end the party for everyone.", "not_host")
    await lifecycle.end_room(room, "host", by=member)
    return {"ended": True}
