"""Group vote rounds: everyone suggests any titles, then the room swipes on them blind.

One current round per room lives in `room.ext["round"]` and moves setup -> voting -> closed.
The server is the source of truth and pushes a personalised `round:state` to each member:
while voting is open a member only ever sees their own votes and how many people have
finished, never anyone else's votes or the tallies.
"""

import re
import secrets
from datetime import date
from typing import Any
from urllib.parse import urlparse

from app import hangout
from app.chat import system_message
from app.hub import hub
from app.playback import set_media
from app.realtime import Ctx, join_hooks, leave_hooks, on
from app.rooms import Room

ROUND_MAX = 5
TITLE_MAX = 100
KINDS = ("movie", "series")
VOTES = ("yes", "no")
_YT_ID = re.compile(r"^[\w-]{11}$")
_YT_LINK = re.compile(r"(?:[?&]v=|youtu\.be/|/embed/|/shorts/|/live/|/v/)([\w-]{11})")


def _new_round(number: int) -> dict:
    return {"id": secrets.token_hex(4), "number": number, "status": "setup", "candidates": [],
            "votes": {}, "results": {}, "winners": []}


def current(room: Room) -> dict:
    return room.ext.setdefault("round", _new_round(1))


def _norm_title(title: str) -> str:
    return " ".join(title.split())


def _cand_key(title: str, kind: str, year: int | None) -> str:
    return f"{_norm_title(title).casefold()}|{kind}|{year or ''}"


def view(room: Room, member_id: str) -> dict:
    """The round as one member is allowed to see it."""
    r = current(room)
    cands = r["candidates"]
    mine = r["votes"].get(member_id, {})
    closed = r["status"] == "closed"
    finished = sum(1 for v in r["votes"].values() if cands and len(v) >= len(cands))
    voters = max(len(hub.online(room.code)), len(r["votes"]))
    return {
        "round": {"id": r["id"], "number": r["number"], "status": r["status"],
                  "winners": r["winners"] if closed else []},
        "candidates": [
            {**c, "myVote": mine.get(c["id"]),
             "yes": r["results"][c["id"]]["yes"] if closed else None,
             "no": r["results"][c["id"]]["no"] if closed else None}
            for c in cands
        ],
        "progress": {"finished": finished, "voters": voters},
        "max": ROUND_MAX,
    }


async def publish(room: Room) -> None:
    for member_id in hub.online(room.code):
        await hub.send_to_member(room.code, member_id, "round:state", view(room, member_id))


async def _fail(ctx: Ctx, message: str) -> None:
    """Round errors are shown inline in the vote panel rather than as chat notices."""
    await ctx.reply("round:error", {"message": message})


def _is_host(ctx: Ctx) -> bool:
    return ctx.member.id == ctx.room.host_id


def _candidate(r: dict, cid: Any) -> dict | None:
    return next((c for c in r["candidates"] if c["id"] == cid), None)


@on("round:add")
async def round_add(ctx: Ctx, data: dict[str, Any]) -> None:
    r = current(ctx.room)
    if r["status"] != "setup":
        return await _fail(ctx, "Voting has already started.")
    title = _norm_title(str(data.get("title") or ""))
    if not 1 <= len(title) <= TITLE_MAX:
        return await _fail(ctx, f"Give it a name (up to {TITLE_MAX} characters).")
    kind = data.get("kind") or "movie"
    if kind not in KINDS:
        return await _fail(ctx, "Pick movie or series.")
    year = data.get("year")
    if year in (None, ""):
        year = None
    else:
        try:
            year = int(year)
        except (TypeError, ValueError):
            year = 0
        if not 1888 <= year <= date.today().year + 2:
            return await _fail(ctx, "Enter a valid release year.")
    if len(r["candidates"]) >= ROUND_MAX:
        return await _fail(ctx, f"Up to {ROUND_MAX} contenders per round.")
    key = _cand_key(title, kind, year)
    if any(_cand_key(c["title"], c["kind"], c["year"]) == key for c in r["candidates"]):
        return await _fail(ctx, "That one's already a contender. If it's a different one, "
                                "set movie or series, or add the year.")
    r["candidates"].append({"id": secrets.token_hex(3), "title": title, "kind": kind, "year": year,
                            "addedBy": ctx.member.id, "addedByName": ctx.member.name})
    await publish(ctx.room)


@on("round:remove")
async def round_remove(ctx: Ctx, data: dict[str, Any]) -> None:
    r = current(ctx.room)
    if r["status"] != "setup":
        return await _fail(ctx, "Voting has already started.")
    c = _candidate(r, data.get("candidateId"))
    if c is None:
        return await _fail(ctx, "That option is no longer in the deck.")
    if not _is_host(ctx) and c["addedBy"] != ctx.member.id:
        return await _fail(ctx, "Only the host or the person who added it can remove it.")
    r["candidates"].remove(c)
    await publish(ctx.room)


@on("round:start")
async def round_start(ctx: Ctx, data: dict[str, Any]) -> None:
    r = current(ctx.room)
    if not _is_host(ctx):
        return await _fail(ctx, "Only the host can start voting.")
    if r["status"] != "setup":
        return await _fail(ctx, "Voting has already started.")
    if len(r["candidates"]) < 2:
        return await _fail(ctx, "Add at least 2 options first.")
    r["status"] = "voting"
    await publish(ctx.room)


@on("round:vote")
async def round_vote(ctx: Ctx, data: dict[str, Any]) -> None:
    r = current(ctx.room)
    if r["status"] != "voting":
        return await _fail(ctx, "Voting is not open.")
    vote = data.get("vote")
    if vote not in VOTES:
        return await _fail(ctx, "Invalid vote.")
    c = _candidate(r, data.get("candidateId"))
    if c is None:
        return await _fail(ctx, "That option isn't in this vote.")
    mine = r["votes"].setdefault(ctx.member.id, {})
    if c["id"] in mine:
        return await _fail(ctx, "You already voted on this one.")
    mine[c["id"]] = vote
    await publish(ctx.room)


def _headline(r: dict) -> str:
    winners = [c for c in r["candidates"] if c["id"] in r["winners"]]
    if not winners:
        return "Vote results: everything got rejected. Brutal. 💀"
    if len(winners) > 1:
        names = ", ".join(c["title"] for c in winners)
        return f"Vote results: it's a tie between {names}."
    w = winners[0]
    return f"Vote results: {w['title']} wins with {r['results'][w['id']]['yes']} 🍿."


@on("round:close")
async def round_close(ctx: Ctx, data: dict[str, Any]) -> None:
    r = current(ctx.room)
    if not _is_host(ctx):
        return await _fail(ctx, "Only the host can reveal the results.")
    if r["status"] != "voting":
        return await _fail(ctx, "Voting is not open.")
    results = {c["id"]: {"yes": 0, "no": 0} for c in r["candidates"]}
    for votes in r["votes"].values():
        for cid, v in votes.items():
            if cid in results:
                results[cid][v] += 1
    top = max((x["yes"] for x in results.values()), default=0)
    r["results"] = results
    r["winners"] = [cid for cid, x in results.items() if top > 0 and x["yes"] == top]
    r["status"] = "closed"
    await publish(ctx.room)
    await system_message(ctx.room, _headline(r))


@on("round:new")
async def round_new(ctx: Ctx, data: dict[str, Any]) -> None:
    room = ctx.room
    prev = current(room)
    if not _is_host(ctx):
        return await _fail(ctx, "Only the host can start a new vote.")
    nxt = _new_round(prev["number"] + 1)
    if data.get("tiebreak"):
        if prev["status"] != "closed" or len(prev["winners"]) < 2:
            return await _fail(ctx, "There is no tie to break.")
        nxt["candidates"] = [{**c, "id": secrets.token_hex(3)} for c in prev["candidates"]
                             if c["id"] in prev["winners"]]
    room.ext["round"] = nxt
    await publish(room)


def parse_source(url: str) -> dict | None:
    """A playable source from a pasted link: YouTube, HLS or a direct http(s) video URL."""
    url = url.strip()
    if not url or len(url) > 2000:
        return None
    if _YT_ID.match(url):
        return {"kind": "youtube", "url": url}
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    if "youtu" in parsed.netloc:
        return {"kind": "youtube", "url": url} if _YT_LINK.search(url) else None
    if parsed.path.lower().endswith(".m3u8"):
        return {"kind": "hls", "url": url}
    return {"kind": "html5", "url": url}


@on("round:watch")
async def round_watch(ctx: Ctx, data: dict[str, Any]) -> None:
    room, r = ctx.room, current(ctx.room)
    if not _is_host(ctx):
        return await _fail(ctx, "Only the host can put the winner on.")
    if r["status"] != "closed":
        return await _fail(ctx, "Voting hasn't closed yet.")
    c = _candidate(r, data.get("candidateId"))
    if c is None or c["id"] not in r["winners"]:
        return await _fail(ctx, "Pick one of the winning options.")
    src = parse_source(str(data.get("url") or ""))
    if src is None:
        return await _fail(ctx, "That link doesn't look like a video. Paste a YouTube link or a video URL.")
    if room.mode == "hangout":
        if src["kind"] != "youtube":
            return await _fail(ctx, "The Hangout queue takes YouTube links only.")
        s = hangout.q(room)
        if len(s["items"]) >= hangout.MAX_QUEUE:
            return await _fail(ctx, "The queue is full.")
        item = {"id": secrets.token_hex(3), "kind": "youtube", "url": src["url"], "title": c["title"],
                "addedBy": ctx.member.id, "addedByName": ctx.member.name}
        s["items"].append(item)
        if s["current"] is None:
            await hangout.advance(room)  # nothing playing, so the queue starts right away
        else:
            await hangout.publish(room)
        queued = (s["current"] or {}).get("id") != item["id"]
        await ctx.reply("round:watched", {"candidateId": c["id"], "queued": queued})
        return
    await set_media(ctx, {**src, "title": c["title"]})
    await ctx.reply("round:watched", {"candidateId": c["id"], "queued": False})


async def send_state(ctx: Ctx) -> None:
    if current(ctx.room)["status"] == "voting":
        await publish(ctx.room)  # a new arrival changes "x of y people have finished judging" for everyone
    else:
        await ctx.reply("round:state", view(ctx.room, ctx.member.id))


async def on_leave(ctx: Ctx) -> None:
    if current(ctx.room)["status"] == "voting":
        await publish(ctx.room)


join_hooks.append(send_state)
leave_hooks.append(on_leave)
