"""Chat with per-recipient-language translation, plus GIPHY GIFs and stickers."""

import asyncio
import re
import secrets
from typing import Any

from app import giphy, ratelimit, spoiler, stats, translate
from app.clock import now_ms
from app.realtime import Ctx, join_hooks, on

MAX_LEN = 1000
HISTORY = 200
CID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")  # client-chosen id that ties an echo or error to a send


def history(ctx_room) -> list[dict]:
    return ctx_room.ext.setdefault("chat", [])


async def deliver(
    room, text: str, src: str, sender: str, name: str, kind: str = "user",
    media: dict | None = None, cid: str | None = None,
) -> dict:
    """Translate (per language present in the room), store and broadcast a message.

    Media messages (GIFs, stickers) skip translation; their text is a plain fallback for readers
    without the picture, such as Reely's view of the chat.
    """
    targets = set() if media else {m.language for m in room.members.values()} - {src}
    results = await asyncio.gather(*(translate.translator.one(text, src, t) for t in targets))
    msg: dict[str, Any] = {
        "id": secrets.token_hex(4),
        "kind": kind,
        "from": sender,
        "name": name,
        "text": text,
        "lang": src,
        "translations": {t: r for t, r in zip(targets, results, strict=True) if r},
        "mediaTime": room.timeline.position(now_ms()),
        "ts": now_ms(),
        "senderLag": spoiler.lag_of(room, sender),
    }
    if media:
        msg["media"] = media
    if cid:
        msg["cid"] = cid
    if kind == "user":
        stats.bump(room, "chat", sender)
    h = history(room)
    h.append(msg)
    del h[:-HISTORY]
    await spoiler.broadcast(room, sender, "chat:message", msg)
    return msg


async def system_message(room, text: str) -> dict:
    return await deliver(room, text, "en", "system", "WellPlayed", "system")


async def resolve_media(raw: object) -> dict:
    """Turn a client's {provider, kind, id} into a message attachment. Only a GIPHY id is accepted:
    the URLs come from the server, never from the client."""
    if not isinstance(raw, dict) or raw.get("provider") != "giphy" or raw.get("kind") not in giphy.KINDS:
        raise giphy.GiphyError("Unsupported attachment.", 400)
    if not giphy.valid_id(raw.get("id")):
        raise giphy.GiphyError("That isn't a GIPHY id.", 400)
    item = await giphy.lookup(raw["id"], raw["kind"])
    return {"provider": "giphy", "kind": raw["kind"], "id": item["id"], "title": item["title"],
            "w": item["w"], "h": item["h"], "url": item["url"], "still": item["still"]}


@on("chat:send")
async def chat_send(ctx: Ctx, data: dict[str, Any]) -> None:
    cid = data.get("cid")
    cid = cid if isinstance(cid, str) and CID_RE.match(cid) else None
    raw_media = data.get("media")
    text = "" if raw_media else str(data.get("text", "")).strip()[:MAX_LEN]
    if not raw_media and not text:
        raise ValueError("empty message")
    if ratelimit.check("chat", f"{ctx.room.code}:{ctx.member.id}"):
        msg = "Please slow down, you're sending messages too quickly."
        return await ctx.reply("error", {"message": msg, "code": "rate_limited", "cid": cid})
    media = None
    if raw_media:
        try:
            media = await resolve_media(raw_media)
        except giphy.GiphyError as exc:
            return await ctx.reply("error", {"message": str(exc), "code": "invalid", "cid": cid})
        text = f"[{'Sticker' if media['kind'] == 'sticker' else 'GIF'}] {media['title']}"
    await deliver(ctx.room, text, ctx.member.language, ctx.member.id, ctx.member.name, media=media, cid=cid)


async def send_history(ctx: Ctx) -> None:
    room, now = ctx.room, now_ms()
    mine = spoiler.lag_of(room, ctx.member.id)
    visible = [  # never show a late joiner chat about moments their feed hasn't reached yet
        m for m in history(room)[-50:]
        if not room.settings.get("spoilerSafe") or now >= m["ts"] + max(0.0, mine - m.get("senderLag", 0.0)) * 1000
    ]
    await ctx.reply("chat:history", {"messages": visible})


join_hooks.append(send_history)
