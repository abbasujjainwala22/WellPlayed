from typing import Annotated, Any

from fastapi import APIRouter, Body, Header, Request
from fastapi.responses import JSONResponse

from app import recs

router = APIRouter(tags=["recommendations"])
DeviceId = Annotated[str | None, Header(alias="X-Device-Id")]


def load() -> None:
    """Read the recommendations file once at startup, so a bad file is reported straight away."""
    recs.reset_store()
    recs.store()


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _error(e: recs.RecError) -> JSONResponse:
    return JSONResponse({"detail": e.message}, status_code=e.status)


@router.get("/api/recs")
def list_recs(x_device_id: DeviceId = None) -> dict:
    items = recs.store().list(x_device_id)
    return {"recs": items, "demo": not items}


@router.post("/api/recs", status_code=201, response_model=None)
def create_rec(request: Request, body: Annotated[Any, Body()], x_device_id: DeviceId = None) -> dict | JSONResponse:
    try:
        device = recs.check_device(x_device_id)
        s = recs.store()
        recs.validate(body)  # reject bad input before it spends a rate-limit slot
        recs.rate_limit("create", s.device_hash(device), _ip(request))
        return s.create(body, device)
    except recs.RecError as e:
        return _error(e)


@router.post("/api/recs/{rec_id}/vote", response_model=None)
def vote_rec(
    rec_id: str, request: Request, body: Annotated[Any, Body()], x_device_id: DeviceId = None
) -> dict | JSONResponse:
    try:
        device = recs.check_device(x_device_id)
        s = recs.store()
        recs.rate_limit("vote", s.device_hash(device), _ip(request))
        return s.vote(rec_id, body.get("option") if isinstance(body, dict) else None, device)
    except recs.RecError as e:
        return _error(e)


@router.delete("/api/recs/{rec_id}", response_model=None)
def delete_rec(rec_id: str, request: Request, x_device_id: DeviceId = None) -> dict | JSONResponse:
    try:
        device = recs.check_device(x_device_id)
        s = recs.store()
        recs.rate_limit("delete", s.device_hash(device), _ip(request))
        s.delete(rec_id, device)
        return {"ok": True}
    except recs.RecError as e:
        return _error(e)
