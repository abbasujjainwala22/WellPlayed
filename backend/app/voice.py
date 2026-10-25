"""LiveKit voice/video: short-lived tokens, a cached credential check and best-effort cleanup.

Cleanup (removing a member who left, deleting the call when the party ends) runs in the background:
it is logged, time-boxed and never blocks or breaks the room flow that triggered it.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

from app import lifecycle
from app.config import get_settings
from app.rooms import Member, Room

log = logging.getLogger(__name__)

# A connected participant stays connected past expiry (the LiveKit server hands the client refreshed
# tokens for its own reconnects); a fresh join or our auto-rejoin always fetches a new token.
TOKEN_TTL = timedelta(minutes=15)
CHECK_OK_TTL_S = 300.0  # how long a successful credential check is trusted
CHECK_FAIL_TTL_S = 30.0  # retry a failing check sooner, so a fixed config shows up quickly
ADMIN_TIMEOUT_S = 8.0

_check: dict[str, Any] = {"at": 0.0, "result": None}
_tasks: set[asyncio.Task] = set()  # strong refs so background cleanup isn't garbage-collected


def configured() -> bool:
    s = get_settings()
    return bool(s.livekit_api_key and s.livekit_api_secret)


def sdk() -> Any | None:
    try:
        from livekit import api
    except ImportError:
        return None
    return api


def _http_url(url: str) -> str:
    return "http" + url[2:] if url.startswith("ws") else url


def mint_token(room: Room, member: Member) -> str:
    api = sdk()
    s = get_settings()
    room.ext.setdefault("voice_members", set()).add(member.id)  # cleanup only touches rooms that used voice
    return (
        api.AccessToken(s.livekit_api_key, s.livekit_api_secret)
        .with_identity(member.id)
        .with_name(member.name)
        .with_ttl(TOKEN_TTL)
        .with_grants(api.VideoGrants(room_join=True, room=room.code, can_publish=True, can_subscribe=True))
        .to_jwt()
    )


def _result(available: bool, reason: str = "", message: str = "") -> dict[str, Any]:
    return {"available": available, "reason": reason or None, "message": message}


async def availability(force: bool = False) -> dict[str, Any]:
    """Can people join a call right now? Cached so it is cheap to ask on every room load."""
    if not configured():
        return _result(False, "unconfigured", "Voice and video aren’t set up on this server.")
    api = sdk()
    if api is None:
        return _result(False, "unavailable", "Voice and video aren’t installed on this server.")
    now = time.monotonic()
    cached = _check["result"]
    if not force and cached is not None:
        ttl = CHECK_OK_TTL_S if cached["available"] else CHECK_FAIL_TTL_S
        if now - _check["at"] < ttl:
            return cached
    s = get_settings()
    try:
        async with api.LiveKitAPI(_http_url(s.livekit_url), s.livekit_api_key, s.livekit_api_secret) as lk:
            await asyncio.wait_for(lk.room.list_rooms(api.ListRoomsRequest()), ADMIN_TIMEOUT_S)
        result = _result(True)
    except Exception as exc:
        status = getattr(exc, "status", None)
        auth = status in (401, 403) or "unauthenticated" in str(getattr(exc, "code", "")).lower()
        log.warning("LiveKit credential check failed: %s", type(exc).__name__)
        result = (
            _result(False, "auth", "Voice and video are misconfigured on this server.")
            if auth
            else _result(False, "unreachable", "The voice and video service can’t be reached right now.")
        )
    _check.update(at=now, result=result)
    return result


def _background(what: str, call: Callable[[Any, Any], Awaitable[Any]]) -> None:
    api = sdk()
    if api is None or not configured():
        return

    async def run() -> None:
        s = get_settings()
        try:
            async with api.LiveKitAPI(_http_url(s.livekit_url), s.livekit_api_key, s.livekit_api_secret) as lk:
                await asyncio.wait_for(call(lk, api), ADMIN_TIMEOUT_S)
            log.info("LiveKit %s done", what)
        except Exception as exc:  # best effort: a missing participant or room is fine
            log.info("LiveKit %s skipped: %s", what, exc)

    try:
        task = asyncio.get_running_loop().create_task(run())
    except RuntimeError:
        return
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _on_member_left(room: Room, member: Member) -> None:
    if member.id not in room.ext.get("voice_members", ()):
        return
    _background(
        f"remove {member.id} from {room.code}",
        lambda lk, api: lk.room.remove_participant(api.RoomParticipantIdentity(room=room.code, identity=member.id)),
    )


async def _on_room_end(room: Room, _reason: str) -> None:
    if not room.ext.get("voice_members"):
        return
    _background(f"delete room {room.code}", lambda lk, api: lk.room.delete_room(api.DeleteRoomRequest(room=room.code)))


lifecycle.left_hooks.append(_on_member_left)
lifecycle.end_hooks.append(_on_room_end)
