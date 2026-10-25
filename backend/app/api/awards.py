from typing import Annotated

from fastapi import APIRouter, Depends

from app import awards
from app.deps import require_member
from app.rooms import Member, Room

router = APIRouter(prefix="/api/rooms/{code}", tags=["awards"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]


@router.get("/awards")
def get_awards(code: str, auth: Auth) -> dict:
    """This member's view of the awards: live front-runners, their own ballot, and results once revealed."""
    room, member = auth
    return awards.view(room, member.id)
