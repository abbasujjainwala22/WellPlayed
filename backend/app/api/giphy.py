"""GIPHY proxy for the chat picker. The key stays here; members only see trimmed results."""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app import giphy
from app.deps import require_member
from app.ratelimit import client_ip, limiter
from app.rooms import Member, Room

router = APIRouter(tags=["giphy"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]
LIMIT, WINDOW_S = 30, 60.0  # picker requests per client IP (typing is debounced, results are cached)


@router.get("/api/giphy")
def status() -> dict:
    """Whether GIFs and stickers are available, so the picker can hide those tabs."""
    return {"enabled": giphy.enabled()}


@router.get("/api/rooms/{code}/giphy/{kind}")
async def browse(
    code: str,
    kind: Literal["gif", "sticker"],
    auth: Auth,
    request: Request,
    q: Annotated[str, Query(max_length=50)] = "",
    offset: Annotated[int, Query(ge=0, le=499)] = 0,
) -> dict:
    """Trending (no `q`) or search results, general-audience only: {items, next}."""
    if limiter.hit(f"giphy:{client_ip(request)}", LIMIT, WINDOW_S):
        raise HTTPException(429, "You're searching too quickly. Please wait a moment.")
    try:
        return await giphy.browse(kind, q, offset)
    except giphy.GiphyError as exc:
        raise HTTPException(exc.status, str(exc)) from exc
