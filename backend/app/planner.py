"""Household coverage planning.

Each household plays on its own TV from its own account, so costs are separable per
household: for a title (or a bundle of titles) every household picks its cheapest fix,
found by exact enumeration over the (few) candidate services.
"""

import json
from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path

DATA = Path(__file__).parent / "data"


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text())


SERVICES: dict[str, dict] = {s["id"]: s for s in _load("services.json")["services"]}
CATALOGUE: dict[str, dict] = {t["id"]: t for t in _load("catalogue.json")["titles"]}


@dataclass
class Household:
    id: str
    name: str
    region: str = "AU"
    size: int = 1  # people watching on this screen
    services: list[str] = field(default_factory=list)  # services the home already pays for


def carries(service_id: str, title: dict, region: str) -> bool:
    regions = title["availability"].get(service_id)
    return bool(regions) and ("*" in regions or region in regions)


def service_in_region(service_id: str, region: str) -> bool:
    s = SERVICES.get(service_id)
    return bool(s) and ("*" in s["regions"] or region in s["regions"])


def _candidates(titles: list[dict], region: str) -> list[str]:
    ids = {sid for t in titles for sid in t["availability"] if carries(sid, t, region)}
    return sorted(sid for sid in ids if service_in_region(sid, region))


def household_fix(h: Household, titles: list[dict]) -> dict:
    """Cheapest set of extra services so that every title is watchable from this home."""
    owned = set(h.services)

    def uncovered(have: set[str]) -> list[dict]:
        return [t for t in titles if not any(carries(s, t, h.region) for s in have)]

    if not uncovered(owned):
        return {"covered": True, "buy": [], "free": [], "cost": 0.0, "uncovered": []}

    cands = [c for c in _candidates(titles, h.region) if c not in owned]
    best: tuple[float, int, tuple[str, ...]] | None = None
    for r in range(len(cands) + 1):
        for combo in combinations(cands, r):
            if uncovered(owned | set(combo)):
                continue
            cost = sum(SERVICES[c]["price"] for c in combo)
            key = (cost, len(combo), combo)
            if best is None or key < best:
                best = key
    if best is None:
        return {"covered": False, "buy": [], "free": [], "cost": 0.0,
                "uncovered": [t["id"] for t in uncovered(owned | set(cands))]}
    cost, _, combo = best
    return {
        "covered": False,
        "buy": [c for c in combo if not SERVICES[c]["free"]],
        "free": [c for c in combo if SERVICES[c]["free"]],
        "cost": round(cost, 2),
        "uncovered": [],
    }


def plan(households: list[Household], titles: list[dict]) -> dict:
    """Coverage plan for watching `titles` together (one title = a movie night)."""
    per = []
    for h in households:
        fix = household_fix(h, titles)
        options = []
        covered_by = sorted({s for s in h.services if all(carries(s, t, h.region) for t in titles)})
        if fix["covered"]:
            options.append({"type": "use_own", "services": covered_by or list(h.services), "cost": 0.0,
                            "detail": "Already covered by your own subscriptions"})
        else:
            if fix["free"] and not fix["buy"]:
                options.append({"type": "use_free", "services": fix["free"], "cost": 0.0,
                                "detail": "Free: " + ", ".join(SERVICES[s]["name"] for s in fix["free"])})
            elif fix["buy"] or fix["free"]:
                options.append({"type": "subscribe", "services": fix["buy"] + fix["free"], "cost": fix["cost"],
                                "detail": "Subscribe to " + ", ".join(SERVICES[s]["name"] for s in fix["buy"])})
            for em in [s for s in h.services if SERVICES.get(s, {}).get("extra_member")]:
                if all(carries(em, t, h.region) for t in titles):
                    options.append({"type": "extra_member", "services": [em], "cost": SERVICES[em]["extra_member"],
                                    "detail": f"Add an extra member to {SERVICES[em]['name']}"})
        per.append({"householdId": h.id, "name": h.name, "region": h.region, "size": h.size,
                    "covered": fix["covered"], "fixable": bool(fix["covered"] or fix["buy"] or fix["free"]),
                    "extraCost": fix["cost"], "options": options, "uncovered": fix["uncovered"]})

    # households that cannot be fixed can still join one that is (or will be) covered
    anchors = [p for p in per if p["fixable"] and p["extraCost"] == 0]
    for p in per:
        if not p["fixable"] and anchors:
            p["options"].append({"type": "join_home", "services": [], "cost": 0.0, "with": anchors[0]["householdId"],
                                 "detail": f"Watch together at {anchors[0]['name']}"})
    viewers = sum(h.size for h in households)
    screens = sum(1 for p in per if p["fixable"] or any(o["type"] == "join_home" for o in p["options"]))
    covered = sum(1 for p in per if p["fixable"])
    total_extra = round(sum(p["extraCost"] for p in per), 2)
    return {
        "households": per,
        "viewers": viewers,
        "coverage": round(covered / len(households), 3) if households else 0.0,
        "coveredHouseholds": covered,
        "extraCost": total_extra,
        "subscriptionsNeeded": len(households),  # one account/screen per home, not per person
        "savingsPct": round((1 - len(households) / viewers) * 100) if viewers else 0,
        "screens": screens,
    }


def suggestions(households: list[Household], swipes: dict[str, dict[str, str]], region_filter: bool = True) -> list[dict]:
    """Rank catalogue titles by what everyone can access, cost and group taste."""
    rows = []
    for t in CATALOGUE.values():
        p = plan(households, [t])
        votes = swipes.get(t["id"], {})
        likes = sum(1 for v in votes.values() if v in ("like", "super"))
        supers = sum(1 for v in votes.values() if v == "super")
        dislikes = sum(1 for v in votes.values() if v == "dislike")
        approval = likes / len(votes) if votes else 0.5  # unknown taste counts as neutral
        cost_score = 1 - min(1.0, p["extraCost"] / 20)
        score = 0.5 * approval + 0.35 * p["coverage"] + 0.15 * cost_score + 0.05 * supers
        rows.append({"title": t, "coverage": p["coverage"], "extraCost": p["extraCost"], "likes": likes,
                     "dislikes": dislikes, "votes": len(votes), "score": round(score, 3),
                     "everyoneCovered": p["coverage"] == 1.0})
    return sorted(rows, key=lambda r: (-r["score"], r["title"]["title"]))
