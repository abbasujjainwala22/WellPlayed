FROM python:3.12-slim

# Optional extras from pyproject.toml, installed from uv.lock. `asr` (faster-whisper) and `translate` (argos, pulls torch)
# are large and unused by the web UI, so they are opt-in: docker build --build-arg EXTRAS="voice ai asr" .
ARG EXTRAS="voice ai"
# The commit being deployed, reported by /healthz so the deploy can tell the new revision is the one serving.
ARG GIT_SHA=dev

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/srv/.venv \
    PATH="/srv/.venv/bin:$PATH" \
    PORT=8000 \
    WP_DATA_DIR=/srv/var     GIT_SHA=$GIT_SHA

WORKDIR /srv
RUN pip install --no-cache-dir "uv>=0.8,<1"
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project $(for e in $EXTRAS; do printf -- '--extra %s ' "$e"; done) \
    && rm -rf /root/.cache

COPY app ./app

# Discover recommendations are saved to $WP_DATA_DIR. Container disk is per revision: a new deploy starts empty.
RUN useradd --create-home --uid 10001 app && mkdir -p /srv/var && chown app /srv/var
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/healthz', timeout=2)"

# One worker on purpose: rooms, sockets and timers live in this process's memory (see app/rooms.py, app/hub.py).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
