def test_households_swipes_and_plan(party, client):
    with party(1) as p:
        p.send("host", "household:upsert", name="Home A", region="au", size=3, services=["netflix", "bogus"])
        hs = p.recv_where("g0", "household:state", lambda d: d["households"])["households"]
        hid = hs[-1]["id"]
        assert hs[-1]["region"] == "AU" and hs[-1]["services"] == ["netflix"] and hs[-1]["members"] == ["Host"]
        p.send("g0", "household:join", householdId=hid)
        p.send("g0", "household:upsert", id=hid, size=4)  # joined, so allowed to edit
        p.send("g0", "household:upsert", name="Home B", region="AU", size=2, services=[])
        tok = p.sessions["host"]["token"]
        plan = client.get(f"/api/rooms/{p.code}/plan?title=s-heist&token={tok}").json()
        assert plan["viewers"] >= 4 and len(plan["households"]) == 2
        p.send("host", "swipe:vote", titleId="bbb", vote="super")
        p.send("g0", "swipe:vote", titleId="bbb", vote="like")
        p.send("g0", "swipe:vote", titleId="nope", vote="like")
        assert "unknown" in p.recv("g0", "error")["message"]
        top = client.get(f"/api/rooms/{p.code}/suggestions?token={tok}").json()[0]
        assert top["title"]["id"] == "bbb" and top["everyoneCovered"] and top["likes"] == 2
        deck = client.get(f"/api/rooms/{p.code}/swipe-deck?token={tok}").json()
        assert "bbb" not in {t["id"] for t in deck}


def test_pick_title_sets_media_and_is_host_only(party):
    with party(1) as p:
        p.send("g0", "title:pick", titleId="bbb")
        assert "host" in p.recv("g0", "error")["message"]
        p.send("host", "title:pick", titleId="bbb")
        assert p.recv("g0", "media:state")["media"]["url"] == "YE7VzlLtp-4"
        p.send("host", "title:pick", titleId="s-heist")
        assert p.recv("g0", "media:state")["media"]["kind"] == "external"
