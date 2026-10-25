from app import planner
from app.planner import Household as H


def T(i):
    return planner.CATALOGUE[i]


def test_free_service_covers_gap_and_savings():
    # 20 people across 5 AU homes; only 3 have Netflix, but the title is on SBS (free) too
    hs = [H("a", "A", "AU", 5, ["netflix"]), H("b", "B", "AU", 4, ["netflix"]), H("c", "C", "AU", 4, ["netflix"]),
          H("d", "D", "AU", 4, ["stan"]), H("e", "E", "AU", 3, [])]
    title = {"id": "x", "title": "x", "availability": {"netflix": ["AU"], "sbs": ["AU"]}}
    p = planner.plan(hs, [title])
    assert p["coverage"] == 1.0 and p["extraCost"] == 0
    assert p["viewers"] == 20 and p["subscriptionsNeeded"] == 5 and p["savingsPct"] == 75
    by = {x["householdId"]: x for x in p["households"]}
    assert by["a"]["covered"] and by["d"]["options"][0]["type"] == "use_free"


def test_cheapest_subscribe_option_and_extra_member():
    hs = [H("a", "A", "US", 2, ["netflix"]), H("b", "B", "US", 2, [])]
    title = {"id": "x", "title": "x", "availability": {"prime": ["US"], "max": ["US"], "netflix": ["US"]}}
    p = planner.plan(hs, [title])
    b = next(x for x in p["households"] if x["householdId"] == "b")
    assert b["options"][0] == {"type": "subscribe", "services": ["prime"], "cost": 9.0,
                               "detail": "Subscribe to Prime Video"}
    assert p["extraCost"] == 9.0
    # a home with netflix but not covered by it gets "extra member" only if it owns the service
    t2 = {"id": "y", "title": "y", "availability": {"netflix": ["US"]}}
    h = planner.plan([H("c", "C", "US", 1, ["netflix"])], [t2])["households"][0]
    assert h["covered"]


def test_region_gap_falls_back_to_join_home():
    hs = [H("a", "A", "US", 2, ["netflix"]), H("b", "B", "IN", 2, [])]
    title = {"id": "x", "title": "x", "availability": {"netflix": ["US"]}}
    p = planner.plan(hs, [title])
    b = next(x for x in p["households"] if x["householdId"] == "b")
    assert not b["fixable"] and b["uncovered"] == ["x"]
    assert b["options"][0]["type"] == "join_home" and b["options"][0]["with"] == "a"
    assert p["coverage"] == 0.5 and p["screens"] == 2


def test_bundle_is_exact_minimum_cost():
    # three titles; Max covers two of them, Prime the third, Netflix only the first => Max + Prime (21)
    titles = [
        {"id": "1", "title": "1", "availability": {"max": ["US"], "netflix": ["US"]}},
        {"id": "2", "title": "2", "availability": {"max": ["US"]}},
        {"id": "3", "title": "3", "availability": {"prime": ["US"], "netflix": ["US"]}},
    ]
    fix = planner.household_fix(H("z", "Z", "US", 1, []), titles)
    # Netflix (15.5) covers 1+3, Max (12) covers 1+2; cheapest cover is Max+Prime = 21 vs Max+Netflix 27.5
    assert sorted(fix["buy"]) == ["max", "prime"] and fix["cost"] == 21.0


def test_suggestions_prefer_covered_and_liked_titles():
    hs = [H("a", "A", "AU", 2, ["stan"]), H("b", "B", "AU", 2, [])]
    ranked = planner.suggestions(hs, {"s-outback": {"m1": "like", "m2": "like"}})
    assert ranked[0]["title"]["id"] in {"s-outback", "bbb", "sintel", "tos", "demo-clip"}
    top_outback = next(r for r in ranked if r["title"]["id"] == "s-outback")
    assert top_outback["everyoneCovered"] and top_outback["likes"] == 2
    heist = next(r for r in ranked if r["title"]["id"] == "s-heist")
    assert heist["extraCost"] > 0


def test_catalogue_and_services_endpoints(client):
    assert any(s["id"] == "sbs" and s["free"] for s in client.get("/api/services").json())
    au = client.get("/api/catalogue?region=AU").json()
    assert "s-outback" in {t["id"] for t in au} and client.get("/api/catalogue?q=big").json()[0]["id"] == "bbb"
