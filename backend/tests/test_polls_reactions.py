import time

from app import polls


def make(p, kind="poll", **kw):
    p.send("host", "poll:create", kind=kind, question="Who is the killer?", options=["Ana", "Bo", "Cy"], **kw)
    return p.recv("g0", "poll:state")["poll"]


def test_poll_lock_in_counts_and_permissions(party):
    with party(2) as p:
        poll = make(p)
        assert poll["state"] == "open" and "correct" not in poll
        p.send("g0", "poll:answer", pollId=poll["id"], option=1)
        assert p.recv("g0", "poll:state")["poll"]["mine"] == 1
        assert p.recv("g1", "poll:counts")["counts"] == [0, 1, 0]
        p.send("g0", "poll:answer", pollId=poll["id"], option=2)
        assert "locked in" in p.recv("g0", "error")["message"]
        p.send("g0", "poll:create", question="x", options=["a", "b"])
        assert "host" in p.recv("g0", "error")["message"]
        p.send("host", "poll:lock", pollId=poll["id"])
        p.send("g1", "poll:answer", pollId=poll["id"], option=0)
        assert "locked" in p.recv("g1", "error")["message"]


def test_prediction_reveal_scores_only_correct(party):
    with party(2) as p:
        poll = make(p, kind="prediction")
        p.send("g0", "poll:answer", pollId=poll["id"], option=2)
        p.send("g1", "poll:answer", pollId=poll["id"], option=0)
        p.send("host", "poll:reveal", pollId=poll["id"], correct=2)
        rev = p.recv("g1", "poll:state")
        while rev["poll"]["state"] != "revealed":
            rev = p.recv("g1", "poll:state")
        assert rev["poll"]["correct"] == 2
        board = p.recv("g1", "leaderboard:state")["leaderboard"]
        assert board[0]["name"] == "Guest0" and board[0]["points"] == 50
        assert {r["name"]: r["points"] for r in board}["Guest1"] == 0


def test_quiz_fastest_correct_gets_most_points(party):
    with party(2) as p:
        poll = make(p, kind="quiz", correct=0)
        p.send("g1", "poll:answer", pollId=poll["id"], option=0)
        p.recv("g1", "poll:state")
        time.sleep(0.05)
        p.send("g0", "poll:answer", pollId=poll["id"], option=0)
        p.recv("g0", "poll:state")
        p.send("host", "poll:reveal", pollId=poll["id"])
        board = {r["name"]: r["points"] for r in p.recv("g0", "leaderboard:state")["leaderboard"]}
        assert board == {"Guest1": 100, "Guest0": 90, "Host": 0}


def test_award_handles_no_correct_answer():
    from app.rooms import manager

    room, host = manager.create("r", "movie", "H", "en")
    poll = polls.create_poll(room, "poll", "q", ["a", "b"], None, None, host.id)
    polls.award(room, poll)
    assert poll["results"] == [] and polls.scores(room) == {}


def test_reactions_heatmap_and_highlights(party, client):
    with party(1) as p:
        for kind, at in [("laugh", 61.0), ("laugh", 62.5), ("cheer", 63.0), ("gasp", 200.0)]:
            p.send("host", "reaction:send", kind=kind, at=at)
            assert p.recv("g0", "reaction:event")["kind"] == kind
        p.send("host", "reaction:send", kind="nope")
        assert "kind" in p.recv("host", "error")["message"]
        tok = p.sessions["g0"]["token"]
        hm = client.get(f"/api/rooms/{p.code}/heatmap?token={tok}").json()
        peak = max(hm["bins"], key=lambda b: b["total"])
        assert peak["start"] == 60.0 and peak["counts"] == {"laugh": 2, "cheer": 1}
        assert hm["top"][0]["dominant"] == "laugh"
        clips = client.get(f"/api/rooms/{p.code}/highlights?token={tok}&n=1").json()["clips"]
        assert clips == [{"start": 55.0, "end": 70.0, "reaction": "laugh", "reactions": 3}]
        recap = client.get(f"/api/rooms/{p.code}/summary?token={tok}").json()
        assert recap["reactionCount"] == 4
