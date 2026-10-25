import pytest

from app import breaks, translate


@pytest.fixture(autouse=True)
def fast(monkeypatch):
    monkeypatch.setattr(breaks, "AUTO_APPROVE_S", 0.3)
    monkeypatch.setattr(translate, "translator", translate.CachedTranslator(translate.NoTranslator()))


def wait_state(p, who, state):
    while True:
        b = p.recv(who, "break:state")["break"]
        if (b and b["state"] == state) or (state is None and b is None):
            return b


def start_playing(p):
    p.send("host", "media:set", kind="html5", url="x.mp4")
    p.send("host", "timeline:set", action="play", at=10)
    p.recv("g0", "timeline:state")


def test_host_approves_break_pauses_room_then_auto_resumes(party):
    with party(1) as p:
        start_playing(p)
        p.send("g0", "break:request", seconds=1)
        assert wait_state(p, "host", "requested")["requesterName"] == "Guest0"
        p.send("host", "break:decision", approve=True)
        paused = p.recv("g0", "timeline:state")
        while paused["state"] != "paused":
            paused = p.recv("g0", "timeline:state")
        assert "Guest0" in paused["note"]
        resumed = p.recv("g0", "timeline:state")
        while resumed["state"] != "playing":
            resumed = p.recv("g0", "timeline:state")
        assert resumed["note"] is None
        wait_state(p, "g0", None)


def test_auto_approve_when_host_is_silent(party):
    with party(1) as p:
        start_playing(p)
        p.send("g0", "break:request", seconds=5)
        assert wait_state(p, "g0", "countdown")  # approved by the timeout


def test_decline_and_permissions(party):
    with party(1) as p:
        p.send("g0", "break:request")
        wait_state(p, "g0", "requested")
        p.send("g0", "break:decision", approve=True)
        assert "host" in p.recv("g0", "error")["message"]
        p.send("host", "break:decision", approve=False)
        wait_state(p, "g0", None)
        p.send("g0", "break:request", seconds=30)
        p.send("g0", "break:request")  # second request while pending
        assert "already" in p.recv("g0", "error")["message"]


def test_requester_returns_early_and_host_extends(party):
    with party(1) as p:
        p.send("host", "break:request", seconds=30)  # host requests: instant countdown
        b = wait_state(p, "g0", "countdown")
        p.send("host", "break:extend")
        # g0's join snapshot can land after the first countdown, so skip stale copies
        while wait_state(p, "g0", "countdown")["extensions"] != 1:
            pass
        p.send("g0", "break:return")
        assert "only" in p.recv("g0", "error")["message"]
        p.send("host", "break:return")
        wait_state(p, "g0", None)
        assert b["seconds"] == 30
