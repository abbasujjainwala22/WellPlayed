import pytest

from app import ai, breaks, study
from app import llm as llm_mod
from app.rooms import manager
from app.transcript import Cue, parse_cues

LECTURE = """1
00:00:00,000 --> 00:00:10,000
Photosynthesis converts light energy into chemical energy inside chloroplasts.

2
00:00:10,000 --> 00:00:20,000
The chlorophyll pigment absorbs red and blue light but reflects green light.

3
00:00:20,000 --> 00:00:30,000
During the light reactions, water molecules are split and oxygen is released.

4
00:01:00,000 --> 00:01:10,000
The Calvin cycle then uses carbon dioxide to build glucose in the stroma.

5
00:01:10,000 --> 00:01:20,000
Finally mitochondria burn glucose to release energy for the cell to use.

6
00:02:00,000 --> 00:02:10,000
The secret ending reveals that the butler was actually the narrator all along.
"""


def room_with_transcript():
    room, _ = manager.create("r", "study", "H", "en")
    ai.set_transcript(room, "en", parse_cues(LECTURE))
    return room


async def test_recap_never_contains_content_after_the_join_time():
    room = room_with_transcript()
    out = await ai.recap(room, 85.0, "en")
    text = " ".join(out["bullets"]).lower()
    assert out["source"] == "extractive" and ("calvin" in text or "glucose" in text or "mitochondria" in text)
    assert "butler" not in text and "narrator" not in text
    early = await ai.recap(room, 25.0, "en")
    assert "calvin" not in " ".join(early["bullets"]).lower()
    assert (await ai.recap(room, 0.0, "en"))["bullets"] == []


async def test_truncate_only_includes_fully_spoken_cues():
    cues = [Cue(0, 10, "a"), Cue(10, 20, "b")]
    assert [c.text for c in ai.truncate(cues, 15)] == ["a"]


async def test_llm_prompt_is_physically_truncated(monkeypatch):
    seen = {}

    async def fake_json(system, prompt, **kw):
        seen["prompt"] = prompt
        return ["Plants make food from light."]

    monkeypatch.setattr(ai.llm, "json", fake_json)
    monkeypatch.setattr(llm_mod.LLM, "available", property(lambda self: True))
    out = await ai.recap(room_with_transcript(), 85.0, "es")
    assert out["source"] == "llm" and out["bullets"] == ["Plants make food from light."]
    assert "butler" not in seen["prompt"] and "Calvin" in seen["prompt"] and "Spanish" in seen["prompt"]


async def test_notes_and_cloze_quiz_fallbacks():
    room = room_with_transcript()
    n = await ai.notes(room, "en")
    assert n["source"] == "extractive" and n["summary"] and all("t" in p for p in n["points"])
    qs = await ai.quiz_questions(room, 3)
    assert 1 <= len(qs) <= 3
    for q in qs:
        assert "_____" in q["question"] and len(q["options"]) == 4 and 0 <= q["correct"] < 4
    assert [q["at"] for q in qs] == sorted(q["at"] for q in qs)


def test_catchup_and_notes_endpoints(party, client):
    with party(1, mode="study") as p:
        tok = p.sessions["g0"]["token"]
        assert client.get(f"/api/rooms/{p.code}/catchup?at=50&token={tok}").status_code == 404
        h = p.sessions["host"]["token"]
        assert client.post(f"/api/rooms/{p.code}/transcript", headers={"x-member-token": tok},
                           json={"content": LECTURE}).status_code == 403
        r = client.post(f"/api/rooms/{p.code}/transcript", headers={"x-member-token": h}, json={"content": LECTURE})
        assert r.json()["cues"] == 6
        out = client.get(f"/api/rooms/{p.code}/catchup?at=85&token={tok}").json()
        assert out["bullets"] and "butler" not in " ".join(out["bullets"]).lower()
        assert client.get(f"/api/rooms/{p.code}/notes?token={tok}").json()["points"]
        assert client.post(f"/api/rooms/{p.code}/transcribe", headers={"x-member-token": h}, content=b"x").status_code == 501


@pytest.fixture
def quick_quiz(monkeypatch):
    monkeypatch.setattr(study, "QUIZ_SECONDS", 0.4)
    monkeypatch.setattr(study, "RESUME_AFTER_REVEAL_S", 0.3)
    monkeypatch.setattr(breaks, "AUTO_APPROVE_S", 60)


def test_quiz_break_pauses_scores_and_resumes(party, client, quick_quiz):
    with party(1, mode="study") as p:
        p.send("host", "media:set", kind="html5", url="x.mp4")
        p.send("host", "study:set-plan", questions=[
            {"at": 1.0, "question": "2+2?", "options": ["3", "4", "5"], "correct": 1}])
        assert p.recv_where("g0", "study:plan", lambda d: d["plan"])["plan"][0]["fired"] is False
        p.send("host", "timeline:set", action="play", at=0.5)
        # the room pauses itself at the quiz moment
        paused = p.recv_where("g0", "timeline:state", lambda t: t["state"] == "paused" and t["note"] == "Quiz break")
        assert abs(paused["anchorMediaS"] - 1.0) < 1e-6
        poll = p.recv("g0", "poll:state")["poll"]
        assert poll["kind"] == "quiz" and poll["question"] == "2+2?" and "correct" not in poll
        p.send("g0", "poll:answer", pollId=poll["id"], option=1)
        rev = p.recv_where("g0", "poll:state", lambda d: d["poll"]["state"] == "revealed")["poll"]
        assert rev["correct"] == 1 and rev["results"][0]["name"] == "Guest0"
        assert p.recv("g0", "leaderboard:state")["leaderboard"][0]["points"] == 100
        resumed = p.recv_where("g0", "timeline:state", lambda t: t["state"] == "playing")
        assert resumed["anchorMediaS"] == 1.0


def test_prepare_quiz_from_transcript(party, client):
    with party(1, mode="study") as p:
        h = p.sessions["host"]["token"]
        client.post(f"/api/rooms/{p.code}/transcript", headers={"x-member-token": h}, json={"content": LECTURE})
        r = client.post(f"/api/rooms/{p.code}/study/prepare", headers={"x-member-token": h}, json={"count": 3})
        qs = r.json()["questions"]
        assert qs and all(q["fired"] is False for q in qs)
        g = p.sessions["g0"]["token"]
        guest_view = client.get(f"/api/rooms/{p.code}/study/plan?token={g}").json()["plan"]
        assert guest_view and "correct" not in guest_view[0] and "options" not in guest_view[0]
