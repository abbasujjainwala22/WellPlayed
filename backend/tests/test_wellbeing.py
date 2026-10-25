def test_state_requires_opt_in_and_is_validated(party):
    with party(1) as p:
        p.send("g0", "wellbeing:state", state="shrimp")  # ignored: not opted in
        p.send("g0", "wellbeing:opt", enabled=True)
        assert p.recv_where("host", "wellbeing:members", lambda d: d["members"])["members"]
        p.send("g0", "wellbeing:state", state="shrimp")
        m = p.recv_where("host", "wellbeing:members", lambda d: any(v["state"] == "shrimp" for v in d["members"].values()))
        assert list(m["members"].values())[0]["state"] == "shrimp"
        p.send("g0", "wellbeing:state", state="hacked")
        assert "state must be" in p.recv("g0", "error")["message"]
        p.send("g0", "wellbeing:opt", enabled=False)
        assert p.recv_where("host", "wellbeing:members", lambda d: not d["members"])


def start_next(p):
    p.send("host", "settings:set", stretchLock=True)
    p.send("host", "episode:next", kind="html5", url="ep2.mp4", title="Episode 2")


def test_next_episode_waits_until_every_opted_in_member_stretches(party):
    with party(2) as p:
        p.send("host", "wellbeing:opt", enabled=True)
        p.send("g0", "wellbeing:opt", enabled=True)  # g1 stays opted out, so is not required
        p.recv_where("g1", "wellbeing:members", lambda d: len(d["members"]) == 2)
        start_next(p)
        lock = p.recv_where("g1", "lock:status", lambda d: d["lock"])["lock"]
        assert {r["name"] for r in lock["required"]} == {"Host", "Guest0"} and lock["seconds"] == 30
        p.send("host", "stretch:done")
        pending = p.recv_where("g1", "lock:status", lambda d: d["lock"] and any(r["done"] for r in d["lock"]["required"]))
        assert not all(r["done"] for r in pending["lock"]["required"])
        p.send("g0", "stretch:done")
        media = p.recv("g1", "media:state")["media"]
        assert media["title"] == "Episode 2"
        t = p.recv_where("g1", "timeline:state", lambda t: t["state"] == "playing")
        assert t["anchorMediaS"] == 0.0
        assert p.recv_where("g1", "lock:status", lambda d: d["lock"] is None)


def test_host_excuse_and_disconnect_release_the_group(party):
    with party(2) as p:
        for who in ("host", "g0"):
            p.send(who, "wellbeing:opt", enabled=True)
        p.recv_where("g1", "wellbeing:members", lambda d: len(d["members"]) == 2)
        start_next(p)
        p.recv_where("g1", "lock:status", lambda d: d["lock"])
        p.send("host", "stretch:done")
        p.send("g0", "lock:excuse", memberId=None)
        assert "host" in p.recv("g0", "error")["message"]
        g0_id = p.sessions["g0"]["member_id"]
        p.send("host", "lock:excuse", memberId=g0_id)
        assert p.recv("g1", "media:state")["media"]["title"] == "Episode 2"


def test_no_opt_in_means_no_lock(party):
    with party(1) as p:
        start_next(p)
        assert p.recv("g0", "media:state")["media"]["title"] == "Episode 2"
