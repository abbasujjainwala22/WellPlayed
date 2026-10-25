from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import ai, translate
from app.deps import require_member
from app.hub import hub
from app.rooms import Member, Room
from app.transcript import parse_cues

router = APIRouter(prefix="/api/rooms/{code}/subtitles", tags=["subtitles"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]


class SubtitleUpload(BaseModel):
    language: str
    content: str  # SRT or WebVTT text


def _store(room: Room) -> dict:
    return room.ext.setdefault("subtitles", {"source": None, "tracks": {}})


@router.post("")
async def upload(code: str, body: SubtitleUpload, auth: Auth) -> dict:
    room, member = auth
    if not room.can_control(member.id):
        raise HTTPException(403, "only the host can upload subtitles")
    cues = parse_cues(body.content)
    if not cues:
        raise HTTPException(422, "no cues found")
    store = _store(room)
    store["tracks"] = {body.language: cues}  # a new source replaces old translations
    store["source"] = body.language
    if not ai.get_transcript(room) or room.ext["transcript"]["language"] == body.language:
        ai.set_transcript(room, body.language, cues)  # subtitles double as the transcript
    await hub.broadcast(room.code, "subtitles:updated", {"source": body.language})
    return {"language": body.language, "cues": len(cues)}


@router.get("")
def available(code: str, auth: Auth) -> dict:
    room, _ = auth
    store = _store(room)
    return {"source": store["source"], "languages": list(store["tracks"]),
            "translator": translate.translator.name}


@router.get("/{lang}")
async def track(code: str, lang: str, auth: Auth) -> dict:
    room, _ = auth
    store = _store(room)
    if lang not in store["tracks"]:
        src = store["source"]
        if not src:
            raise HTTPException(404, "no subtitles uploaded")
        base = store["tracks"][src]
        texts = await translate.translator.many([c.text for c in base], src, lang)
        if texts is None:
            raise HTTPException(503, "translation unavailable; showing source language only")
        from app.transcript import Cue

        store["tracks"][lang] = [Cue(c.start, c.end, t) for c, t in zip(base, texts, strict=True)]
    return {"language": lang, "cues": [c.dict() for c in store["tracks"][lang]]}
