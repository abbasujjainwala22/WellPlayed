"""WebSocket gateway. Features register handlers with @on("message:type")."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.clock import now_ms
from app.errors import UserError
from app.hub import Conn, Hub, hub
from app.rooms import Member, Room, manager

router = APIRouter()


@dataclass
class Ctx:
    room: Room
    member: Member
    conn: Conn
    hub: Hub

    async def broadcast(self, type_: str, data: dict, exclude_self: bool = False) -> None:
        await self.hub.broadcast(self.room.code, type_, data, self.conn.id if exclude_self else None)

    async def reply(self, type_: str, data: dict) -> None:
        await self.hub.send_to_conn(self.conn, type_, data)

    async def to_member(self, member_id: str, type_: str, data: dict) -> None:
        await self.hub.send_to_member(self.room.code, member_id, type_, data)

    async def error(self, message: str, code: str = "rejected") -> None:
        """`message` is shown to people as written; `code` is the stable machine-readable reason."""
        await self.reply("error", {"message": message, "code": code})


Handler = Callable[[Ctx, dict[str, Any]], Awaitable[None]]
handlers: dict[str, Handler] = {}
join_hooks: list[Callable[[Ctx], Awaitable[None]]] = []  # run after the snapshot is sent
leave_hooks: list[Callable[[Ctx], Awaitable[None]]] = []


def on(message_type: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        handlers[message_type] = fn
        return fn

    return deco


@on("clock:ping")
async def clock_ping(ctx: Ctx, data: dict[str, Any]) -> None:
    await ctx.reply("clock:pong", {"t0": data.get("t0"), "serverMs": now_ms()})


@router.websocket("/ws/rooms/{code}")
async def room_socket(ws: WebSocket, code: str, token: str, device: str = "screen") -> None:
    auth = manager.authenticate(code, token)
    if not auth:
        # accept first: a close before the handshake reaches the browser as 1006, and the client
        # would keep reconnecting to a room that no longer exists instead of seeing why:
        # 4401 not a member (any more), 4404 no such room, 4410 the party ended
        await ws.accept()
        await ws.close(code=manager.close_code_for(code))
        return
    room, member = auth
    await ws.accept()
    conn = hub.add(room.code, ws, member.id, device)
    ctx = Ctx(room, member, conn, hub)
    await ctx.reply("room:snapshot", {**room.snapshot(), "you": member.public(), "device": device})
    await ctx.broadcast("members:state", {"members": [m.public() for m in room.members.values()], "hostId": room.host_id})
    await ctx.broadcast("presence", {"online": sorted(hub.online(room.code))})
    for hook in join_hooks:
        await hook(ctx)
    try:
        while True:
            msg = await ws.receive_json()
            handler = handlers.get(msg.get("type", ""))
            if handler is None:
                await ctx.error(f"unknown message type: {msg.get('type')}", "unknown_type")
                continue
            try:
                await handler(ctx, msg.get("data") or {})
            except UserError as exc:
                await ctx.reply("error", {"message": str(exc), "code": "invalid", **exc.extra})
            except (KeyError, ValueError, TypeError) as exc:
                await ctx.error(f"bad request: {exc}", "bad_request")
    except WebSocketDisconnect:
        pass
    finally:
        hub.remove(room.code, conn)
        for hook in leave_hooks:
            await hook(ctx)
        await hub.broadcast(room.code, "presence", {"online": sorted(hub.online(room.code))})
