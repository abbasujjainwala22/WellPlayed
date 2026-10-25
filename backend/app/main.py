import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app import (  # noqa: F401  (importing registers the realtime handlers)
    aihost,
    animal,
    awards,
    breaks,
    buffer,
    chat,
    hangout,
    movie,
    playback,
    polls,
    reactions,
    rounds,
    sports,
    study,
    wellbeing,
)
from app.api import ai as ai_api
from app.api import aihost as aihost_api
from app.api import awards as awards_api
from app.api import devices as devices_api
from app.api import giphy as giphy_api
from app.api import insights as insights_api
from app.api import movie as movie_api
from app.api import recs as recs_api
from app.api import rooms as rooms_api
from app.api import subtitles as subtitles_api
from app.config import get_settings
from app.diagnostics import HEADER as REQUEST_ID_HEADER
from app.diagnostics import install as install_diagnostics
from app.lifecycle import lifespan  # ends idle and expired rooms in the background
from app.realtime import router as realtime_router


def create_app() -> FastAPI:
    app = FastAPI(title="WellPlayed", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_settings().cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )
    install_diagnostics(app)  # X-Request-Id on every response, error `code`s, room event logs

    @app.get("/api/health")
    @app.get("/healthz", include_in_schema=False)  # container platform probes
    def health() -> dict[str, str]:
        return {"status": "ok", "version": os.environ.get("GIT_SHA", "dev")}  # the deploy smoke test checks the version

    app.include_router(rooms_api.router)
    app.include_router(subtitles_api.router)
    app.include_router(insights_api.router)
    app.include_router(ai_api.router)
    app.include_router(aihost_api.router)
    app.include_router(aihost_api.general_router)
    app.include_router(devices_api.router)
    app.include_router(giphy_api.router)
    app.include_router(movie_api.router)
    app.include_router(awards_api.router)
    app.include_router(recs_api.router)
    recs_api.load()
    app.include_router(realtime_router)
    _serve_frontend(app)
    return app


def _serve_frontend(app: FastAPI) -> None:
    """Serve the built web app from the API's own port, so one URL (or one tunnel) is all friends need.

    Only active once `pnpm build` has produced frontend/dist (or WP_STATIC_DIR points at a build).
    """
    dist = Path(os.environ.get("WP_STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
    index = dist / "index.html"
    if not index.is_file():
        return

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith(("api/", "ws/")):
            raise HTTPException(404)
        file = (dist / path).resolve()
        if path and file.is_file() and file.is_relative_to(dist.resolve()):
            return FileResponse(file)
        return FileResponse(index)  # client-side routes such as /room/ABC123


app = create_app()
