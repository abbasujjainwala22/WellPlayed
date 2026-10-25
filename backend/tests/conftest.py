import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ratelimit import limiter


@pytest.fixture(autouse=True)
def _fresh_rate_limits():
    limiter.clear()  # every test creates rooms from the same "IP"


@pytest.fixture
def client():
    with TestClient(app) as c:  # one shared event loop, so background tasks and sockets coexist
        yield c


class Party:
    """Helper that opens a room with a host and N guests, each with a websocket."""

    def __init__(self, client: TestClient, guests: int = 1, mode: str = "movie"):
        self.client = client
        r = client.post("/api/rooms", json={"display_name": "Host", "mode": mode}).json()
        self.code, self.sessions = r["code"], {"host": r}
        for i in range(guests):
            self.sessions[f"g{i}"] = client.post(
                f"/api/rooms/{self.code}/join", json={"display_name": f"Guest{i}", "language": "es"}
            ).json()
        self._ctx, self.ws = [], {}

    def __enter__(self):
        for name, s in self.sessions.items():
            cm = self.client.websocket_connect(f"/ws/rooms/{self.code}?token={s['token']}")
            self.ws[name] = cm.__enter__()
            self._ctx.append(cm)
            self.ws[name].snapshot = self.recv(name, "room:snapshot")
        return self

    def __exit__(self, *a):
        for cm in reversed(self._ctx):
            cm.__exit__(None, None, None)

    def send(self, who, type_, **data):
        self.ws[who].send_json({"type": type_, "data": data})

    def recv(self, who, type_, limit=30):
        """Read until a message of `type_` arrives (skipping presence noise)."""
        for _ in range(limit):
            m = self.ws[who].receive_json()
            if m["type"] == type_:
                return m["data"]
        raise AssertionError(f"{who} never received {type_}")


def _recv_where(self, who, type_, pred, limit=40):
    for _ in range(limit):
        d = self.recv(who, type_)
        if pred(d):
            return d
    raise AssertionError(f"{who} never received matching {type_}")


Party.recv_where = _recv_where


@pytest.fixture
def party(client):
    def make(guests=1, mode="movie"):
        return Party(client, guests, mode)

    return make
