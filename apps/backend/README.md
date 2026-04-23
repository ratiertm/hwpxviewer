# hwpx-viewer-api

FastAPI backend for the HWPX Viewer.

## Responsibilities (MVP)

- HWPX round-trip via pyhwpxlib (M3 — `/api/import`, `/api/export`)
- Claude API proxy (M2 — `/api/claude/stream`, `/api/claude/once`)
- Upload session store (in-memory LRU, v1.0)
- Health checks (`/healthz`, `/readyz`)

## Layers

```
src/hwpx_viewer_api/
├── main.py        # FastAPI app, middleware, router mount
├── config.py      # Settings (pydantic-settings)
├── prompts.py     # System prompts (ported verbatim from prototype)
├── schemas.py     # Pydantic I/O models
├── errors.py      # AppError catalog
├── routes/        # Route handlers per resource
├── services/      # Business logic, external calls
└── security/      # Upload validation, CORS
```

## Dev

```bash
# from repo root or apps/backend
uv sync
uv run uvicorn hwpx_viewer_api.main:app --reload --port 8000
```

Test: `uv run pytest`

## Required env

See root `.env.example`. Backend reads `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`CORS_ALLOWED_ORIGINS`, `MAX_UPLOAD_MB`, `LOG_LEVEL`.
