"""End-of-party awards: automatic awards from real room data, peer-voted awards and a post-watch review.

Automatic awards are only given when the data behind them exists (no fake winners). Peer votes and
review scores stay secret until the host reveals: every member gets a personalised `awards:state`
that carries only their own ballot plus how many people have voted.
"""

import secrets
from collections import Counter
from typing import Any

from app import polls, reactions, stats, wellbeing
from app.chat import system_message
from app.clock import now_ms
from app.hub import hub
from app.realtime import Ctx, join_hooks, on
from app.rooms import Room

REACTION_EMOJI = {"laugh": "😂", "cheer": "🎉", "scream": "😱", "gasp": "😮", "clap": "👏",
                  "heart": "❤️", "sad": "😢", "groan": "😩"}

# Peer-voted categories the host can pick from (2–3 per round), plus one optional custom category.
PRESETS: list[dict[str, str]] = [
    {"id": "goblin", "emoji": "👺", "name": "The Plot-Twist Goblin", "blurb": "Most unhinged theory"},
    {"id": "cringe", "emoji": "🫣", "name": "Captain Second-Hand Embarrassment",
     "blurb": "Reacted harder than the actors"},
    {"id": "professor", "emoji": "🎓", "name": "Professor Unsolicited Theory",
     "blurb": "Explained the plot nobody asked about"},
    {"id": "tourist", "emoji": "🧭", "name": "The Lost Tourist", "blurb": "Needed an explanation after every scene"},
    {"id": "hype", "emoji": "📣", "name": "Chief Hype Officer", "blurb": "Kept the energy up all night"},
]
MAX_CATEGORIES = 3
TAKE_LEN = 140
MIN_SLOUCH_MS = 60_000


def state(room: Room) -> dict[str, Any]:
    return room.ext.setdefault("awards", {
        "phase": "idle",  # idle -> voting -> revealed
        "categories": [], "votes": {}, "reviews": {}, "result": None,
    })


def _name(room: Room, member_id: str, fallback: str = "Someone") -> str:
    return room.member_name(member_id, fallback)


def _top(room: Room, values: dict[str, float]) -> tuple[list[dict], float]:
    """Everyone tied on the highest positive value, or nobody. Members pruned for inactivity still count."""
    values = {k: v for k, v in values.items() if v > 0 and (k in room.members or k in room.former)}
    if not values:
        return [], 0
    best = max(values.values())
    winners = sorted((k for k, v in values.items() if v == best), key=lambda k: _name(room, k))
    return [{"id": k, "name": _name(room, k)} for k in winners], best


def _plural(n: float, word: str) -> str:
    n = int(n)
    return f"{n} {word}{'' if n == 1 else 's'}"


def _auto(room: Room, aid: str, emoji: str, name: str, blurb: str, values: dict[str, float], stat) -> dict | None:
    winners, best = _top(room, values)
    if not winners:
        return None
    return {"id": aid, "kind": "auto", "emoji": emoji, "name": name, "blurb": blurb,
            "winners": winners, "value": best, "stat": stat(best, winners)}


def auto_awards(room: Room) -> list[dict]:
    """Awards earned from what actually happened in the room, in display order."""
    out: list[dict | None] = []

    events = reactions.log(room)
    per_member = Counter(e["memberId"] for e in events)

    def reactor_stat(best: float, winners: list[dict]) -> str:
        kinds = Counter(e["kind"] for e in events if e["memberId"] == winners[0]["id"])
        top = kinds.most_common(1)[0][0] if kinds else ""
        return f"{_plural(best, 'reaction')}, mostly {REACTION_EMOJI.get(top, '✨')}"

    out.append(_auto(room, "reactor", "🎭", "The Reaction Machine", "Felt every scene, loudly.",
                     dict(per_member), reactor_stat))

    out.append(_auto(room, "chatter", "💬", "Chatterbox Supreme", "Narrated the whole thing so nobody else had to.",
                     stats.counter(room, "chat"), lambda b, _: _plural(b, "message")))

    def oracle_stat(best: float, winners: list[dict]) -> str:
        right = sum(1 for p in polls.polls(room).values() for r in p["results"] if r["memberId"] == winners[0]["id"])
        return f"{int(best)} pts from {_plural(right, 'correct call')}"

    out.append(_auto(room, "oracle", "🔮", "The Oracle", "Saw it coming, called it, collected the points.",
                     dict(polls.scores(room)), oracle_stat))

    if room.settings.get("playfulTransforms", True):  # never surface states the group chose to hide
        online, now = hub.online(room.code), now_ms()
        slouch: dict[str, float] = {}
        for mid, entry in wellbeing.opted(room).items():  # only members who opted in, and still are
            total = stats.counter(room, "slouch_ms").get(mid, 0)
            if entry["state"] in wellbeing.SLOUCH and mid in online:
                total += max(0.0, now - entry["since"])
            if total >= MIN_SLOUCH_MS:
                slouch[mid] = total
        out.append(_auto(room, "potato", "🥔", "The Emotional Support Potato",
                         "Sank into the sofa and became one with it.", slouch,
                         lambda b, _: f"{max(1, round(b / 60_000))} min as a 🦐/🥔"))

    out.append(_auto(room, "snacks", "🍿", "Snack Run Champion", "Kept the snack supply chain alive.",
                     stats.counter(room, "breaks"), lambda b, _: _plural(b, "break request")))
    out.append(_auto(room, "buffering", "⏳", "The Human Buffering Icon",
                     "Their Wi-Fi took a few dramatic pauses of its own.",
                     stats.counter(room, "stalls"), lambda b, _: _plural(b, "stall")))
    out.append(_auto(room, "stretch", "🧘", "Stretch Hero", "Actually got up and stretched. Respect.",
                     stats.counter(room, "stretches"), lambda b, _: _plural(b, "stretch break")))
    return [a for a in out if a]


def peer_awards(room: Room) -> list[dict]:
    s = state(room)
    out = []
    for cat in s["categories"]:
        ballots = s["votes"].get(cat["id"], {})
        tally = Counter(t for t in ballots.values() if t in room.members or t in room.former)
        winners, best = _top(room, dict(tally))
        if winners:
            out.append({"id": f"peer-{cat['id']}", "kind": "peer", "emoji": cat["emoji"], "name": cat["name"],
                        "blurb": cat["blurb"], "winners": winners, "value": best,
                        "stat": f"{_plural(best, 'vote')} of {len(ballots)}"})
    return sorted(out, key=lambda a: -a["value"])


def review_summary(room: Room, with_takes: bool) -> dict:
    reviews = state(room)["reviews"]
    count = len(reviews)
    out: dict[str, Any] = {"count": count, "avg": round(sum(r["stars"] for r in reviews.values()) / count, 1)
                           if count else None}
    if with_takes:
        out["takes"] = [{"name": _name(room, mid, r["name"]), "stars": r["stars"], "take": r["take"]}
                        for mid, r in sorted(reviews.items(), key=lambda kv: kv[1]["ts"]) if r["take"]]
    return out


def view(room: Room, member_id: str) -> dict:
    s = state(room)
    return {
        "phase": s["phase"],
        "presets": PRESETS,
        "categories": s["categories"],
        "myVotes": {cid: b[member_id] for cid, b in s["votes"].items() if member_id in b},
        "ballots": {cid: len(b) for cid, b in s["votes"].items()},
        "myReview": {k: v for k, v in s["reviews"][member_id].items() if k in ("stars", "take")}
        if member_id in s["reviews"] else None,
        "reviewCount": len(s["reviews"]),
        "preview": auto_awards(room),
        "result": s["result"],
    }


async def publish(room: Room) -> None:
    for mid in hub.online(room.code):
        await hub.send_to_member(room.code, mid, "awards:state", view(room, mid))


def _host(ctx: Ctx) -> bool:
    return ctx.member.id == ctx.room.host_id


@on("awards:sync")
async def sync(ctx: Ctx, data: dict[str, Any]) -> None:
    """Refresh the live front-runners preview for this member."""
    await ctx.reply("awards:state", view(ctx.room, ctx.member.id))


@on("awards:open-voting")
async def open_voting(ctx: Ctx, data: dict[str, Any]) -> None:
    if not _host(ctx):
        return await ctx.error("only the host can start awards voting")
    s = state(ctx.room)
    if s["phase"] != "idle":
        return await ctx.error("awards voting already started")
    by_id = {p["id"]: p for p in PRESETS}
    cats = [dict(by_id[c]) for c in dict.fromkeys(data.get("categories") or []) if c in by_id]
    custom = data.get("custom") or {}
    if str(custom.get("name") or "").strip():
        cats.append({"id": "custom-" + secrets.token_hex(2), "emoji": str(custom.get("emoji") or "🏅")[:4],
                     "name": str(custom["name"]).strip()[:48],
                     "blurb": str(custom.get("blurb") or "Chosen by the room").strip()[:80]})
    if not 1 <= len(cats) <= MAX_CATEGORIES:
        raise ValueError(f"pick between 1 and {MAX_CATEGORIES} award categories")
    s.update(phase="voting", categories=cats, votes={c["id"]: {} for c in cats})
    await publish(ctx.room)
    await system_message(ctx.room, "🏆 Awards voting is open! Cast your votes in the Awards tab.")


@on("awards:vote")
async def vote(ctx: Ctx, data: dict[str, Any]) -> None:
    s = state(ctx.room)
    if s["phase"] != "voting":
        return await ctx.error("awards voting is not open")
    ballots = s["votes"].get(str(data["categoryId"]))
    target = str(data["memberId"])
    if ballots is None:
        raise ValueError("unknown award category")
    if target == ctx.member.id:
        return await ctx.error("you can’t vote for yourself")
    if target not in ctx.room.members:
        raise ValueError("unknown member")
    if ctx.member.id in ballots:
        return await ctx.error("your vote is locked in")
    ballots[ctx.member.id] = target
    await publish(ctx.room)


@on("awards:review")
async def review(ctx: Ctx, data: dict[str, Any]) -> None:
    s = state(ctx.room)
    if s["phase"] == "revealed":
        return await ctx.error("reviews are closed — the awards have been revealed")
    stars = int(data["stars"])
    if not 1 <= stars <= 5:
        raise ValueError("stars must be between 1 and 5")
    take = " ".join(str(data.get("take") or "").split())[:TAKE_LEN]
    s["reviews"][ctx.member.id] = {"stars": stars, "take": take, "name": ctx.member.name, "ts": now_ms()}
    await publish(ctx.room)


@on("awards:reveal")
async def reveal(ctx: Ctx, data: dict[str, Any]) -> None:
    if not _host(ctx):
        return await ctx.error("only the host can reveal the awards")
    s = state(ctx.room)
    if s["phase"] == "revealed":
        return
    awards = peer_awards(ctx.room) + auto_awards(ctx.room)
    s["phase"] = "revealed"
    s["result"] = {"at": now_ms(), "awards": awards, "review": review_summary(ctx.room, with_takes=True),
                   "title": (ctx.room.media or {}).get("title")}
    await publish(ctx.room)
    await system_message(ctx.room, f"🏆 The awards are in: {len(awards)} handed out. Open the Awards tab!"
                         if awards else "🏆 Awards revealed. Quiet party — nobody earned one this time.")


@on("awards:reset")
async def reset(ctx: Ctx, data: dict[str, Any]) -> None:
    """Host starts a fresh round (e.g. after the next episode)."""
    if not _host(ctx):
        return await ctx.error("only the host can reset the awards")
    ctx.room.ext.pop("awards", None)
    await publish(ctx.room)


async def send_state(ctx: Ctx) -> None:
    await ctx.reply("awards:state", view(ctx.room, ctx.member.id))


join_hooks.append(send_state)
