"""Connection hub: fan-out of messages to the sockets in a room.

Single-process implementation. For multiple instances, publish to Redis pub/sub
in `broadcast` and have each instance deliver to its local sockets.
"""

import contextlib
import secrets
from dataclasses import dataclass

from fastapi import WebSocket


@dataclass
class Conn:
    id: str
    ws: WebSocket
    member_id: str
    device: str = "screen"  # "screen" | "companion"


class Hub:
    def __init__(self) -> None:
        self.rooms: dict[str, dict[str, Conn]] = {}

    def add(self, code: str, ws: WebSocket, member_id: str, device: str) -> Conn:
        conn = Conn(secrets.token_hex(4), ws, member_id, device)
        self.rooms.setdefault(code, {})[conn.id] = conn
        return conn

    def remove(self, code: str, conn: Conn) -> None:
        conns = self.rooms.get(code, {})
        conns.pop(conn.id, None)
        if not conns:
            self.rooms.pop(code, None)

    def online(self, code: str) -> set[str]:
        return {c.member_id for c in self.rooms.get(code, {}).values()}

    async def _send(self, conn: Conn, message: dict) -> None:
        with contextlib.suppress(Exception):  # a dead socket is cleaned up by its own loop
            await conn.ws.send_json(message)

    async def broadcast(self, code: str, type_: str, data: dict, exclude: str | None = None) -> None:
        msg = {"type": type_, "data": data}
        for conn in list(self.rooms.get(code, {}).values()):
            if conn.id != exclude:
                await self._send(conn, msg)

    async def send_to_member(self, code: str, member_id: str, type_: str, data: dict) -> None:
        msg = {"type": type_, "data": data}
        for conn in list(self.rooms.get(code, {}).values()):
            if conn.member_id == member_id:
                await self._send(conn, msg)

    async def send_to_conn(self, conn: Conn, type_: str, data: dict) -> None:
        await self._send(conn, {"type": type_, "data": data})


hub = Hub()
