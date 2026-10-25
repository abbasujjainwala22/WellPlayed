from fastapi import Header, Query

from app.errors import ApiError
from app.rooms import Member, Room, RoomGone, manager


async def require_member(
    code: str,
    token: str | None = Query(default=None),
    x_member_token: str | None = Header(default=None),
) -> tuple[Room, Member]:
    """Authenticate a REST call by member token (header, or query for <track>/<img> style use).

    Async so it runs on the event loop: in the threadpool it could iterate room.members mid-change."""
    auth = manager.authenticate(code, x_member_token or token or "")
    if not auth:
        try:
            manager.get(code)
        except RoomGone as exc:
            raise ApiError(410, exc.message, "room_ended") from exc
        except KeyError:
            pass
        raise ApiError(401, "Your session for this party isn't valid any more. Try rejoining.", "session_invalid")
    return auth
