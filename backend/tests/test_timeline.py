from app.timeline import PLAY_LEAD_MS, Timeline


def test_play_schedules_start_and_position_advances():
    t = Timeline()
    t.play(1000, at=10)
    assert t.position(1000) == 10  # before scheduled start, position holds
    assert t.position(1000 + PLAY_LEAD_MS + 2000) == 12


def test_pause_freezes_position_and_bumps_version():
    t = Timeline()
    t.play(0, at=0)
    v = t.version
    t.pause(PLAY_LEAD_MS + 5000)
    assert t.position(PLAY_LEAD_MS + 99999) == 5
    assert t.version == v + 1


def test_seek_and_rate():
    t = Timeline()
    t.play(0, at=0)
    t.seek(1000, 100)
    assert t.position(1000 + PLAY_LEAD_MS + 1000) == 101
    t.set_rate(1000 + PLAY_LEAD_MS + 1000, 2.0)
    assert t.position(1000 + PLAY_LEAD_MS + 2000) == 103
