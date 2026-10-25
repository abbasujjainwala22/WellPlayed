import pytest

from app import translate


@pytest.fixture(autouse=True)
def mock_translator(monkeypatch):
    monkeypatch.setattr(translate, "translator", translate.CachedTranslator(translate.MockTranslator()))


def test_message_translated_for_other_languages(party):
    with party(1) as p:  # host is "en", guest is "es"
        p.send("host", "chat:send", text="hello there")
        m = p.recv("g0", "chat:message")
        assert m["text"] == "hello there" and m["lang"] == "en"
        assert m["translations"] == {"es": "[es] hello there"}
        assert m["name"] == "Host"


def test_same_language_not_translated_and_history_on_join(party, client):
    with party(0) as p:
        p.send("host", "chat:send", text="first")
        assert p.recv("host", "chat:message")["translations"] == {}
        late = client.post(f"/api/rooms/{p.code}/join", json={"display_name": "Late"}).json()
        with client.websocket_connect(f"/ws/rooms/{p.code}?token={late['token']}") as ws:
            hist = ws.receive_json()
            while hist["type"] != "chat:history":
                hist = ws.receive_json()
            assert [x["text"] for x in hist["data"]["messages"]] == ["first"]


def test_rate_limit_and_empty(party):
    with party(0) as p:
        p.send("host", "chat:send", text="   ")
        assert "empty" in p.recv("host", "error")["message"]
        for i in range(8):
            p.send("host", "chat:send", text=f"m{i}")
        assert "slow down" in p.recv("host", "error")["message"]


SRT = "1\n00:00:01,000 --> 00:00:03,000\nHello\n\n2\n00:00:04,000 --> 00:00:05,500\n<i>World</i>\n"


def test_subtitles_upload_and_translated_track(party, client):
    with party(1) as p:
        h, g = p.sessions["host"], p.sessions["g0"]
        base = f"/api/rooms/{p.code}/subtitles"
        r = client.post(base, json={"language": "en", "content": SRT}, headers={"x-member-token": h["token"]})
        assert r.json() == {"language": "en", "cues": 2}
        assert client.post(base, json={"language": "en", "content": SRT},
                           headers={"x-member-token": g["token"]}).status_code == 403
        es = client.get(f"{base}/es?token={g['token']}").json()
        assert es["cues"][1] == {"start": 4.0, "end": 5.5, "text": "[es] World"}
        assert client.get(f"{base}/en?token={g['token']}").json()["cues"][0]["text"] == "Hello"
        assert client.get(base).status_code == 401
