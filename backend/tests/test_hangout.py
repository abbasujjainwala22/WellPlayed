import pytest

from app import hangout


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    async def fake(url):
        return "Fetched Title" if "dQw4w9WgXcQ" in url else None

    monkeypatch.setattr(hangout, "fetch_title", fake)


def test_first_add_autoplays_and_titles_are_fetched(party):
    with party(1, mode="hangout") as p:
        assert p.ws["host"].snapshot["settings"]["audioFirst"] is True
        p.send("g0", "queue:add", url="dQw4w9WgXcQ")
        media = p.recv("host", "media:state")["media"]
        assert media["kind"] == "youtube" and media["url"] == "dQw4w9WgXcQ"
        q = p.recv_where("host", "queue:state", lambda d: d["queue"]["current"]["title"] == "Fetched Title")["queue"]
        assert q["current"]["addedByName"] == "Guest0" and q["items"] == []


def test_queue_order_remove_permissions_and_move(party):
    with party(2, mode="hangout") as p:
        p.send("host", "queue:add", url="aaaaaaaaaaa", title="One")
        p.send("g0", "queue:add", url="bbbbbbbbbbb", title="Two")
        p.send("g0", "queue:add", url="ccccccccccc", title="Three")
        q = p.recv_where("g1", "queue:state", lambda d: len(d["queue"]["items"]) == 2)["queue"]
        assert q["current"]["title"] == "One" and [i["title"] for i in q["items"]] == ["Two", "Three"]
        p.send("g1", "queue:remove", id=q["items"][0]["id"])
        assert "only" in p.recv("g1", "error")["message"]
        p.send("host", "queue:move", id=q["items"][1]["id"], delta=-1)
        q = p.recv_where("g1", "queue:state", lambda d: d["queue"]["items"][0]["title"] == "Three")["queue"]
        p.send("g0", "queue:remove", id=q["items"][1]["id"])  # g0 added "Two"
        q = p.recv_where("g1", "queue:state", lambda d: len(d["queue"]["items"]) == 1)["queue"]
        assert q["items"][0]["title"] == "Three"


def test_majority_skip_vote_and_host_skip(party):
    with party(2, mode="hangout") as p:  # 3 online -> 2 votes needed
        p.send("host", "queue:add", url="aaaaaaaaaaa", title="One")
        p.send("host", "queue:add", url="bbbbbbbbbbb", title="Two")
        p.send("host", "queue:add", url="ccccccccccc", title="Three")
        p.recv_where("g1", "queue:state", lambda d: len(d["queue"]["items"]) == 2)
        p.send("g0", "queue:skip-vote")
        q = p.recv_where("g1", "queue:state", lambda d: d["queue"]["votes"] == 1)["queue"]
        assert q["needed"] == 2 and q["current"]["title"] == "One"
        p.send("g1", "queue:skip-vote")
        assert p.recv_where("g1", "media:state", lambda d: True)["media"]["title"] == "Two"
        q = p.recv_where("g1", "queue:state", lambda d: d["queue"]["current"]["title"] == "Two")["queue"]
        assert q["votes"] == 0
        p.send("g0", "queue:skip")
        assert "host" in p.recv("g0", "error")["message"]
        p.send("host", "queue:skip")
        assert p.recv_where("g1", "media:state", lambda d: d["media"]["title"] == "Three")


def test_track_end_advances_once_and_empty_queue_clears(party):
    with party(1, mode="hangout") as p:
        p.send("host", "queue:add", url="aaaaaaaaaaa", title="One")
        first = p.recv("g0", "media:state")["media"]
        p.send("g0", "queue:add", url="bbbbbbbbbbb", title="Two")
        p.send("g0", "queue:ended", mediaId=first["id"])
        p.send("host", "queue:ended", mediaId=first["id"])  # duplicate report is ignored
        assert p.recv("g0", "media:state")["media"]["title"] == "Two"
        second = p.recv_where("g0", "queue:state", lambda d: d["queue"]["current"]["title"] == "Two")["queue"]["current"]
        p.send("host", "queue:ended", mediaId=second["id"])
        q = p.recv_where("g0", "queue:state", lambda d: d["queue"]["current"] is None)["queue"]
        assert q["items"] == []
