import asyncio
import os
import tempfile
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from app import ai, asr, study
from app.deps import require_member
from app.rooms import Member, Room
from app.transcript import parse_cues

router = APIRouter(prefix="/api/rooms/{code}", tags=["ai"])
Auth = Annotated[tuple[Room, Member], Depends(require_member)]


class TranscriptUpload(BaseModel):
    language: str = "en"
    content: str


def _need_transcript(room: Room) -> None:
    if not ai.get_transcript(room):
        raise HTTPException(404, "No transcript yet. Upload subtitles (.srt/.vtt) or run transcription first.")


@router.post("/transcript")
def upload_transcript(code: str, body: TranscriptUpload, auth: Auth) -> dict:
    room, member = auth
    if member.id != room.host_id:
        raise HTTPException(403, "only the host can upload a transcript")
    cues = parse_cues(body.content)
    if not cues:
        raise HTTPException(422, "no timed text found")
    ai.set_transcript(room, body.language, cues)
    return {"cues": len(cues), "duration": cues[-1].end}


@router.post("/transcribe")
async def transcribe(code: str, request: Request, auth: Auth, language: str | None = None) -> dict:
    """Upload raw media bytes; transcribe with faster-whisper (optional extra)."""
    room, member = auth
    if member.id != room.host_id:
        raise HTTPException(403, "only the host can transcribe")
    if not asr.available():
        raise HTTPException(501, "faster-whisper is not installed (uv sync --extra asr)")
    fd, path = tempfile.mkstemp(suffix=".media")
    try:
        with os.fdopen(fd, "wb") as f:
            async for chunk in request.stream():
                f.write(chunk)
        cues = await asyncio.to_thread(asr.transcribe, path, language)
    finally:
        os.unlink(path)
    ai.set_transcript(room, language or "en", cues)
    return {"cues": len(cues)}


@router.get("/catchup")
async def catchup(code: str, auth: Auth, at: float = Query(ge=0), lang: str | None = None) -> dict:
    """Spoiler-safe recap of everything up to `at` seconds (and nothing after)."""
    room, member = auth
    _need_transcript(room)
    return await ai.recap(room, at, lang or member.language)


@router.get("/notes")
async def notes(code: str, auth: Auth, lang: str | None = None) -> dict:
    room, member = auth
    _need_transcript(room)
    return await ai.notes(room, lang or member.language)


class QuizPrepare(BaseModel):
    count: int = 5


@router.post("/study/prepare")
async def prepare_quiz(code: str, body: QuizPrepare, auth: Auth) -> dict:
    room, member = auth
    if member.id != room.host_id:
        raise HTTPException(403, "only the host can prepare quiz breaks")
    _need_transcript(room)
    questions = await ai.quiz_questions(room, max(1, min(body.count, 15)))
    if not questions:
        raise HTTPException(422, "could not build questions from this transcript")
    study.set_plan(room, questions)
    await study.publish_plan(room)
    await study.reschedule(room)
    return {"questions": study.plan(room)}


@router.get("/study/plan")
def study_plan(code: str, auth: Auth) -> dict:
    room, member = auth
    full = member.id == room.host_id
    return {"plan": study.plan(room) if full else study.public_plan(room)}
