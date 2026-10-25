.PHONY: setup backend frontend demo share test lint e2e

setup:
	cd backend && uv sync --extra voice
	cd frontend && pnpm install

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && pnpm dev

# One process, one port: builds the web app and serves it with the API on every network interface,
# so phones and laptops on the same Wi-Fi can open http://<this-computer's-IP>:8000
demo:
	cd frontend && pnpm build
	cd backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8000

# Public https link for friends elsewhere (run alongside `make demo`; needs cloudflared installed)
share:
	cloudflared tunnel --url http://localhost:8000

test:
	cd backend && uv run pytest -q
	cd frontend && pnpm test

lint:
	cd backend && uv run ruff check .
	cd frontend && pnpm typecheck

e2e:
	cd frontend && pnpm e2e
