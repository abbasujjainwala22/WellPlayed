"""Request ids, machine-readable error codes and structured room event logs.

Every HTTP response carries an `X-Request-Id` (the caller's, if it sent a sane one), and every error
body has a stable `code` next to the friendly `detail`, plus the `requestId` people can quote to us.
"""

import contextvars
import hashlib
import json
import logging
import re
import secrets
import sys
from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEADER = "X-Request-Id"
_SANE_ID = re.compile(r"^[A-Za-z0-9._-]{6,64}$")

request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("request_id", default=None)

events = logging.getLogger("wellplayed.events")
log = logging.getLogger(__name__)

# A plain HTTPException gets its code from the status; raise errors.ApiError for a specific one.
STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    410: "gone",
    413: "too_large",
    422: "invalid_request",
    429: "rate_limited",
    500: "server_error",
    501: "not_implemented",
    502: "upstream_error",
    503: "unavailable",
}


def new_request_id() -> str:
    return secrets.token_hex(8)


def room_ref(code: str) -> str:
    """A stable, non-secret handle for a room in logs (the invite code itself lets anyone join)."""
    return "r-" + hashlib.sha256(code.upper().encode()).hexdigest()[:10]


def log_event(action: str, code: str | None = None, member: str | None = None, **extra: Any) -> None:
    """One JSON line per room lifecycle event: create, join, leave, end, host-change, prune."""
    entry: dict[str, Any] = {"event": "room", "action": action}
    if code:
        entry["room"] = room_ref(code)
    if member:
        entry["member"] = member
    rid = request_id.get()
    if rid:
        entry["requestId"] = rid
    entry.update({k: v for k, v in extra.items() if v is not None})
    events.info(json.dumps(entry, separators=(",", ":"), default=str))


def _setup_event_log() -> None:
    if events.handlers:
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    events.addHandler(handler)
    events.setLevel(logging.INFO)
    events.propagate = False


def _error_body(status: int, detail: Any, code: str | None) -> dict[str, Any]:
    return {"detail": detail, "code": code or STATUS_CODES.get(status, "error"), "requestId": request_id.get()}


class RequestIdMiddleware:
    """Pure ASGI, so the id is set for the whole request (exception handlers and logs included)
    and even an unhandled crash answers with JSON and the id instead of a bare 500."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = next((v.decode("latin-1") for k, v in scope.get("headers", []) if k == b"x-request-id"), "")
        rid = incoming if _SANE_ID.match(incoming) else new_request_id()
        token = request_id.set(rid)
        started = False

        async def send_with_id(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() != b"x-request-id"]
                headers.append((b"x-request-id", rid.encode()))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception:
            log.exception("unhandled error (request %s)", rid)
            if started:
                raise
            body = _error_body(500, "Something went wrong on our side. Please try again.", "server_error")
            await JSONResponse(body, status_code=500)(scope, receive, send_with_id)
        finally:
            request_id.reset(token)


async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    body = _error_body(exc.status_code, exc.detail, getattr(exc, "code", None))
    return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))


async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(_error_body(422, jsonable_encoder(exc.errors()), "invalid_request"), status_code=422)


def install(app: FastAPI) -> None:
    _setup_event_log()
    app.add_exception_handler(StarletteHTTPException, _http_error)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_error)  # type: ignore[arg-type]
    app.add_middleware(RequestIdMiddleware)
