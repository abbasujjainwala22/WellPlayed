import time

from app import spoiler


def lag(p, who, seconds):
    p.send(who, "lag:set", lag=seconds, source="manual")


def test_delay_math():
    from app.rooms import manager

    room, host = manager.create("r", "sports", "H", "en")
    guest = manager.join(room.code, "G", "en", None)
    spoiler.lags(room)[host.id] = {"lag": 2.0, "source": "manual"}
    spoiler.lags(room)[guest.id] = {"lag": 7.0, "source": "manual"}
    assert spoiler.delay_for(room, host.id, guest.id) == 0.0  # spoiler-safe is off
    room.settings["spoilerSafe"] = True
    assert spoiler.delay_for(room, host.id, guest.id) == 5.0  # guest is 5s behind the sender
    assert spoiler.delay_for(room, guest.id, host.id) == 0.0  # the faster viewer already saw it


def test_reaction_held_back_for_slower_viewer_only(party):
    with party(2, mode="sports") as p:  # host lag 0, g0 lag 0.6s, g1 lag 0 (also fast)
        p.send("host", "settings:set", spoilerSafe=True)
        lag(p, "g0", 0.6)
        lag(p, "host", 0.0)
        p.recv_where("g0", "lag:state", lambda d: d["lags"].get(p.sessions["g0"]["member_id"], {}).get("lag") == 0.6)
        t0 = time.perf_counter()
        p.send("host", "reaction:send", kind="cheer", at=10)
        p.recv("g1", "reaction:event")
        fast = time.perf_counter() - t0
        p.recv("g0", "reaction:event")
        slow = time.perf_counter() - t0
        assert fast < 0.3 and slow >= 0.55


def test_chat_held_back_and_history_filtered(party, client):
    with party(1, mode="sports") as p:
        p.send("host", "settings:set", spoilerSafe=True)
        lag(p, "g0", 0.5)
        p.recv_where("host", "lag:state", lambda d: len(d["lags"]) == 1)
        t0 = time.perf_counter()
        p.send("host", "chat:send", text="GOAL!!!")
        p.recv("host", "chat:message")
        p.recv("g0", "chat:message")
        assert time.perf_counter() - t0 >= 0.45


def test_marker_calibration_sets_relative_lags(party):
    with party(2, mode="sports") as p:
        p.send("g0", "sync:marker")
        assert "host" in p.recv("g0", "error")["message"]
        p.send("host", "sync:marker", label="the whistle")
        marker = p.recv("g0", "sync:marker")
        p.send("host", "sync:saw", markerId=marker["id"])
        time.sleep(0.2)
        p.send("g0", "sync:saw", markerId=marker["id"])
        lags = p.recv_where("g1", "lag:state", lambda d: len(d["lags"]) == 2)["lags"]
        by = {m: v for m, v in lags.items()}
        host_lag = by[p.sessions["host"]["member_id"]]["lag"]
        g0_lag = by[p.sessions["g0"]["member_id"]]["lag"]
        assert host_lag == 0.0 and 0.15 < g0_lag < 0.6 and by[p.sessions["g0"]["member_id"]]["source"] == "marker"
        p.send("g0", "lag:set", lag=30, source="auto")  # auto must not override calibration
        p.send("g0", "sync:saw", markerId="wrong")
        assert "not active" in p.recv("g0", "error")["message"]


def test_live_prediction_closes_by_content_time(party):
    with party(1, mode="sports") as p:
        p.send("host", "settings:set", spoilerSafe=True)
        lag(p, "g0", 0.8)  # g0 sees things 0.8s later, so gets 0.8s longer to answer
        p.recv_where("host", "lag:state", lambda d: d["lags"])
        p.send("host", "poll:create", kind="prediction", question="Goal in the next second?",
               options=["Yes", "No"], durationS=0.5)
        poll = p.recv_where("g0", "poll:state", lambda d: True)["poll"]
        time.sleep(0.6)  # host's own deadline has passed...
        p.send("g0", "poll:answer", pollId=poll["id"], option=0)  # ...but g0's feed has not reached it yet
        assert p.recv("g0", "poll:state")["poll"]["mine"] == 0
        time.sleep(0.8)
        p.send("host", "poll:answer", pollId=poll["id"], option=1)
        assert "closed" in p.recv("host", "error")["message"]
