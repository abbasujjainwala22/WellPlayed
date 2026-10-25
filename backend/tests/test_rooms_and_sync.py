def test_create_join_and_preview(client):
    r = client.post("/api/rooms", json={"display_name": "Ana", "mode": "study"}).json()
    j = client.post(f"/api/rooms/{r['code']}/join", json={"display_name": "Bo"}).json()
    assert j["code"] == r["code"] and j["member_id"] != r["member_id"]
    assert client.get(f"/api/rooms/{r['code']}").json()["members"] == 2
    assert client.post("/api/rooms", json={"display_name": "x", "mode": "nope"}).status_code == 422
    assert client.post("/api/rooms/ZZZZZZ/join", json={"display_name": "x"}).status_code == 404


def test_bad_token_rejected(client, party):
    p = party(0)
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect(f"/ws/rooms/{p.code}?token=nope") as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
    assert exc.value.code == 4401  # a close code the browser can see, so it stops reconnecting


def test_clock_ping(party):
    with party(0) as p:
        p.send("host", "clock:ping", t0=123)
        pong = p.recv("host", "clock:pong")
        assert pong["t0"] == 123 and pong["serverMs"] > 0


def test_host_controls_playback_for_everyone(party):
    with party(1) as p:
        p.send("host", "media:set", kind="youtube", url="dQw4w9WgXcQ", title="Clip")
        assert p.recv("g0", "media:state")["media"]["kind"] == "youtube"
        p.send("host", "timeline:set", action="play", at=5)
        t = p.recv("g0", "timeline:state")
        while t["state"] != "playing":
            t = p.recv("g0", "timeline:state")
        assert t["anchorMediaS"] == 5 and t["version"] >= 2


def test_guest_cannot_control_unless_allowed(party):
    with party(1) as p:
        p.send("g0", "timeline:set", action="play")
        assert "host" in p.recv("g0", "error")["message"]
        p.send("host", "settings:set", membersCanControl=True)
        p.recv("g0", "settings:state")
        p.send("g0", "timeline:set", action="seek", to=30)
        assert p.recv("host", "timeline:state")["anchorMediaS"] == 30


def test_bad_action_is_reported_not_fatal(party):
    with party(0) as p:
        p.send("host", "timeline:set", action="explode")
        assert "bad request" in p.recv("host", "error")["message"]
        p.send("host", "clock:ping", t0=1)
        assert p.recv("host", "clock:pong")


def test_media_end_pauses_the_room(party):
    with party(0) as p:
        p.send("host", "media:set", kind="html5", url="https://x/v.mp4", title="Clip")
        media = p.recv("host", "media:state")["media"]
        p.send("host", "timeline:set", action="play", at=0)
        p.recv_where("host", "timeline:state", lambda d: d["state"] == "playing")
        p.send("host", "queue:ended", mediaId=media["id"], at=90)
        t = p.recv_where("host", "timeline:state", lambda d: d["state"] == "paused")
        assert t["note"] == "Finished" and t["anchorMediaS"] == 90
