import time

import jwt
import pytest

from app.config import get_settings


def test_pairing_is_one_time_and_gives_the_same_member(party, client):
    with party(0) as p:
        tok = p.sessions["host"]["token"]
        pair = client.post(f"/api/rooms/{p.code}/pair", headers={"x-member-token": tok}).json()["pair"]
        s = client.post(f"/api/rooms/{p.code}/pair/claim", json={"pair": pair}).json()
        assert s["member_id"] == p.sessions["host"]["member_id"] and s["token"] == tok
        assert client.post(f"/api/rooms/{p.code}/pair/claim", json={"pair": pair}).status_code == 410
        assert client.post(f"/api/rooms/{p.code}/pair", json={}).status_code == 401


def test_pairing_expires(party, client, monkeypatch):
    with party(0) as p:
        tok = p.sessions["host"]["token"]
        pair = client.post(f"/api/rooms/{p.code}/pair", headers={"x-member-token": tok}).json()["pair"]
        real = time.time
        monkeypatch.setattr(time, "time", lambda: real() + 3600)
        assert client.post(f"/api/rooms/{p.code}/pair/claim", json={"pair": pair}).status_code == 410


def test_companion_socket_shares_the_member_and_chats(party, client):
    with party(1) as p:
        tok = p.sessions["host"]["token"]
        with client.websocket_connect(f"/ws/rooms/{p.code}?token={tok}&device=companion") as phone:
            assert phone.receive_json()["data"]["device"] == "companion"
            phone.send_json({"type": "chat:send", "data": {"text": "from my phone"}})
            m = p.recv("g0", "chat:message")
            assert m["text"] == "from my phone" and m["name"] == "Host"


@pytest.fixture
def livekit_keys(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "livekit_api_key", "devkey")
    monkeypatch.setattr(s, "livekit_api_secret", "secret_that_is_at_least_32_chars_long")


def test_voice_token_grants_only_this_room(party, client, livekit_keys):
    with party(0) as p:
        tok = p.sessions["host"]["token"]
        r = client.get(f"/api/rooms/{p.code}/voice-token", headers={"x-member-token": tok}).json()
        claims = jwt.decode(r["token"], "secret_that_is_at_least_32_chars_long", algorithms=["HS256"])
        assert claims["sub"] == p.sessions["host"]["member_id"] and claims["video"]["room"] == p.code
        assert claims["video"]["roomJoin"] is True and r["url"].startswith("ws")


def test_voice_token_503_when_unconfigured(party, client, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "livekit_api_key", "")
    with party(0) as p:
        r = client.get(f"/api/rooms/{p.code}/voice-token", headers={"x-member-token": p.sessions["host"]["token"]})
        assert r.status_code == 503 and "not configured" in r.json()["detail"]
