"""Reely, the AI host: REST endpoints for a member's own in-room conversation, plus the
room-free general chat on /ai (per device, no accounts)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app import aihost, reely_general
from app.deps import require_member
from app.llm import llm
from app.ratelimit import client_ip
from app.rooms import Member, Room

router = APIRouter(prefix="/api/rooms/{code}/aihost", tags=["aihost"])
general_router = APIRouter(prefix="/api/reely", tags=["aihost"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]
DeviceId = Annotated[str | None, Header(alias="X-Device-Id")]
Kind = Literal["chat", "commentary"]


class ReelyMessage(BaseModel):
    text: str = Field(default="", max_length=2000)  # trimmed and checked against the real 500-char limit in aihost
    vibe: str = "normal"
    spoilerSafe: bool = True  # noqa: N815  (wire format)
    position: float | None = None
    kind: Kind = "chat"


class DraftEdit(BaseModel):
    """Optional edits to a poll draft before it is shared. Re-validated server-side in aihost.check_poll."""

    question: str | None = Field(default=None, max_length=1000)
    options: list[str] | None = Field(default=None, max_length=20)


class GeneralMessage(BaseModel):
    text: str = Field(default="", max_length=2000)
    vibe: str = "normal"
    spoilerSafe: bool = True  # noqa: N815
    conversationId: str | None = Field(default=None, max_length=40)  # noqa: N815
    kind: Kind = "chat"


def _raise(exc: aihost.ReelyError) -> HTTPException:
    return HTTPException(exc.status, exc.message)


# ---------- in a room ----------

@router.get("")
def reely_history(code: str, auth: Auth) -> dict:
    """This member's private conversation (latest 30). Nobody else's is ever returned."""
    room, member = auth
    return {"messages": aihost.recent(room, member.id), "llm": llm.available}


@router.post("")
async def reely_chat(code: str, body: ReelyMessage, auth: Auth) -> dict:
    room, member = auth
    try:
        messages = await aihost.converse(room, member, body.text, body.vibe, body.spoilerSafe, body.position, body.kind)
    except aihost.RateLimited as exc:
        raise HTTPException(429, "Reely needs a breather. Try again in a minute.") from exc
    except aihost.ReelyError as exc:
        raise _raise(exc) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"messages": messages, "llm": llm.available}


@router.delete("")
def reely_clear(code: str, auth: Auth) -> dict:
    """Start a new chat: clears only this member's private conversation, never the group chat."""
    room, member = auth
    aihost.clear(room, member.id)
    return {"messages": [], "llm": llm.available}


@router.post("/drafts/{draft_id}/share")
async def reely_share(code: str, draft_id: str, body: DraftEdit, auth: Auth) -> dict:
    """Publish the caller's own draft (optionally edited) to the room as a poll."""
    room, member = auth
    try:
        return {"message": await aihost.share_draft(room, member, draft_id, body.question, body.options)}
    except aihost.ReelyError as exc:
        raise _raise(exc) from exc


@router.post("/drafts/{draft_id}/dismiss")
def reely_dismiss(code: str, draft_id: str, auth: Auth) -> dict:
    room, member = auth
    try:
        return {"message": aihost.dismiss_draft(room, member, draft_id)}
    except aihost.ReelyError as exc:
        raise _raise(exc) from exc


# ---------- general chat on /ai (no room) ----------

@general_router.get("/conversations")
def general_list(
    x_device_id: DeviceId = None, offset: Annotated[int, Query(ge=0, le=1000)] = 0,
    limit: Annotated[int, Query(ge=1, le=50)] = reely_general.PAGE_SIZE,
) -> dict:
    try:
        device = reely_general.check_device(x_device_id)
    except aihost.ReelyError as exc:
        raise _raise(exc) from exc
    return {**reely_general.store().page(device, offset, limit), "llm": llm.available}


@general_router.get("/conversations/{convo_id}")
def general_get(convo_id: str, x_device_id: DeviceId = None) -> dict:
    try:
        return {**reely_general.conversation(x_device_id, convo_id), "llm": llm.available}
    except aihost.ReelyError as exc:
        raise _raise(exc) from exc


@general_router.delete("/conversations/{convo_id}")
def general_delete(convo_id: str, x_device_id: DeviceId = None) -> dict:
    try:
        reely_general.store().delete(reely_general.check_device(x_device_id), convo_id)
    except aihost.ReelyError as exc:
        raise _raise(exc) from exc
    return {"ok": True}


@general_router.post("/chat")
async def general_chat(body: GeneralMessage, request: Request, x_device_id: DeviceId = None) -> dict:
    try:
        out = await reely_general.chat(x_device_id, client_ip(request), body.conversationId, body.text, body.vibe,
                                       body.spoilerSafe, body.kind)
    except aihost.ReelyError as exc:
        raise _raise(exc) from exc
    return {**out, "llm": llm.available}
