"""Media metadata: best-effort YouTube titles, so a room never shows a raw URL as the title."""

import asyncio

import httpx

from app.hub import hub
from app.rooms import Room

_tasks: set[asyncio.Task] = set()  # keep background lookups alive until they finish


async def fetch_title(url: str) -> str | None:
    """Best-effort YouTube title via oEmbed (no API key). Failures just keep the URL as the title."""
    if "youtu" not in url:
        url = f"https://www.youtube.com/watch?v={url.strip()}"  # a bare 11-character video id
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"})
            return r.json().get("title") if r.status_code == 200 else None
    except Exception:
        return None


def fill_title_later(room: Room) -> None:
    """If the current media is a YouTube video titled with its own URL, look the title up and rebroadcast."""
    media = room.media
    if not media or media["kind"] != "youtube" or media["title"] != media["url"]:
        return

    async def run() -> None:
        found = await fetch_title(media["url"])
        if found and room.media is media:  # still the same video
            media["title"] = found[:120]
            await hub.broadcast(room.code, "media:state", {"media": media})

    task = asyncio.create_task(run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
