from app import buffer
from app.buffer import MemberBuf, decide, ready_to_resume


def feed(m, samples, playing=True):
    for t, b in samples:
        m.update(b, t, playing, False)
    return m


def test_ewma_slope_and_prediction():
    m = feed(MemberBuf(), [(0, 20), (2000, 18), (4000, 16), (6000, 14)])
    assert -1.0 < m.slope < -0.4  # draining ~1 s/s while playing
    assert m.predict() < 14 - 4
    steady = feed(MemberBuf(), [(0, 20), (2000, 20), (4000, 20.1)])
    assert abs(steady.slope) < 0.1 and steady.predict() > 15
    paused = MemberBuf(buffer=30, slope=-3)
    paused.update(30, 1000, playing=False, buffering=False)
    assert paused.slope == 0.0


def test_decisions():
    good = feed(MemberBuf(), [(0, 30), (2000, 30), (4000, 30)])
    weak = feed(MemberBuf(), [(0, 12), (2000, 9), (4000, 6)])  # draining fast
    dying = feed(MemberBuf(), [(0, 5), (2000, 3), (4000, 1.5)])
    assert decide({"a": good}, True).kind == "none"
    assert decide({"a": good, "b": weak}, True).kind in ("boost", "pause")
    d = decide({"a": good, "b": dying}, True)
    assert d.kind == "pause" and d.weakest == "b"
    assert decide({"a": good, "b": dying}, False).kind == "none"  # nothing to protect while paused
    stalled = MemberBuf(buffer=0, buffering=True)
    assert decide({"a": good, "b": stalled}, True).reason == "stalled"
    assert not ready_to_resume({"a": good, "b": dying}) and ready_to_resume({"a": good})


def drain(p, who, start, step, n, t0=0):
    for i in range(n):
        p.send(who, "telemetry:buffer", bufferAheadS=max(0, start - step * i), t=t0 + i * 2000)


def test_planned_pause_before_stall_then_auto_resume(party):
    with party(1) as p:
        p.send("host", "media:set", kind="html5", url="x.mp4")
        p.send("host", "timeline:set", action="play", at=0)
        p.recv_where("g0", "timeline:state", lambda t: t["state"] == "playing")
        drain(p, "host", 30, 0, 4)  # healthy
        drain(p, "g0", 8, 2, 4)  # 8, 6, 4, 2 -> draining 1 s/s
        paused = p.recv_where("host", "timeline:state", lambda t: t["state"] == "paused" and t["note"])
        assert "Guest0's connection is catching up" in paused["note"]
        status = p.recv_where("host", "buffer:status", lambda d: d["planned"])
        assert {m["name"] for m in status["members"]} == {"Host", "Guest0"}
        p.send("g0", "telemetry:buffer", bufferAheadS=3, t=20000)  # still too little
        p.send("g0", "telemetry:buffer", bufferAheadS=9, t=22000)  # recovered
        p.send("host", "telemetry:buffer", bufferAheadS=30, t=22000)
        resumed = p.recv_where("host", "timeline:state", lambda t: t["state"] == "playing")
        assert resumed["note"] is None


def test_boost_sent_for_weak_but_not_critical_and_stall_pauses(party, monkeypatch):
    with party(1) as p:
        p.send("host", "media:set", kind="html5", url="x.mp4")
        p.send("host", "timeline:set", action="play", at=0)
        p.recv_where("g0", "timeline:state", lambda t: t["state"] == "playing")
        drain(p, "g0", 9, 1.5, 4)  # 9, 7.5, 6, 4.5 -> predicts about 3 s: weak, not critical
        assert p.recv("host", "preload:boost")["seconds"] > 0
        monkeypatch.setattr(buffer, "COOLDOWN_S", 0)
        p.send("g0", "telemetry:buffer", bufferAheadS=0, buffering=True, t=30000)
        assert "catching up" in p.recv_where("host", "timeline:state", lambda t: t["state"] == "paused" and t["note"])["note"]


def test_companion_telemetry_ignored(client, party):
    with party(0) as p:
        tok = p.sessions["host"]["token"]
        with client.websocket_connect(f"/ws/rooms/{p.code}?token={tok}&device=companion") as ws:
            ws.send_json({"type": "telemetry:buffer", "data": {"bufferAheadS": 0, "buffering": True}})
        import app.buffer as b
        from app.rooms import manager

        assert b.state(manager.get(p.code))["members"] == {}
