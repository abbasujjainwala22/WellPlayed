"""Companion-phone pairing and LiveKit voice/video tokens."""

import secrets
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import voice
from app.config import get_settings
from app.deps import require_member
from app.errors import ApiError
from app.rooms import Member, Room, manager, normalize_code

router = APIRouter(prefix="/api/rooms/{code}", tags=["devices"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]
PAIR_TTL_S = 600


def pairs(room: Room) -> dict[str, dict]:
    return room.ext.setdefault("pairs", {})


@router.post("/pair")
async def create_pairing(code: str, auth: Auth) -> dict:
    """The big-screen client asks for a short-lived one-time code to show as a QR."""
    room, member = auth
    now = time.time()
    for k in [k for k, v in pairs(room).items() if v["exp"] < now]:
        pairs(room).pop(k)
    pair = secrets.token_urlsafe(9)
    pairs(room)[pair] = {"memberId": member.id, "exp": now + PAIR_TTL_S}
    return {"pair": pair, "expiresIn": PAIR_TTL_S}


class Claim(BaseModel):
    pair: str


@router.post("/pair/claim")
async def claim(code: str, body: Claim) -> dict:
    """The phone trades the one-time code for the same member's session (no second account)."""
    room = manager.rooms.get(normalize_code(code))
    entry = room and pairs(room).pop(body.pair, None)  # one-time use
    if not room or not entry or entry["exp"] < time.time():
        raise ApiError(410, "This pairing code expired or was already used.", "pair_expired")
    member = room.members.get(entry["memberId"])
    if not member:  # they left the party between showing the QR code and the phone scanning it
        raise ApiError(410, "The person who showed this code has left the party.", "member_left")
    return {"code": room.code, "member_id": member.id, "token": member.token}


@router.get("/voice-token")
def voice_token(code: str, auth: Auth) -> dict:
    """A short-lived (15 min) LiveKit token for this room only; the client fetches a new one to rejoin."""
    room, member = auth
    if not voice.configured():
        raise HTTPException(503, "Voice is not configured (set LIVEKIT_API_KEY / LIVEKIT_API_SECRET, see .env.example)")
    if voice.sdk() is None:
        raise HTTPException(501, "livekit-api is not installed (uv sync --extra voice)")
    token = voice.mint_token(room, member)
    return {
        "url": get_settings().livekit_url,
        "token": token,
        "identity": member.id,
        "expiresIn": int(voice.TOKEN_TTL.total_seconds()),
    }


@router.get("/voice-status")
async def voice_status(code: str, auth: Auth) -> dict:
    """Whether calls work right now (cached credential check), so the UI can hide or disable voice."""
    return await voice.availability()
