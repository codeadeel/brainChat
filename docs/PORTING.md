# Deployment & Docker Compose Guide

This repository uses a clean root-level multi-stage Docker setup (`Dockerfile` + `docker-compose.yaml`) with mounted dataset/cache storage at `./data`.

## Repository layout

```text
brainChat/
├── docker-compose.yaml
├── Dockerfile
├── .dockerignore
├── .env.example             # copy to .env (never committed)
├── data/                    # mounted volume (raw + processed + group + artifacts)
├── backend/
├── frontend/
├── scripts/
├── tests/
├── docs/
├── requirements.txt
└── requirements.lock.txt
```

## First-time setup

```bash
# 1. Configure environment variables
cp .env.example .env
# Edit .env and set LLM_API_KEY

# 2. Build the production image (Node 22 Vite build + Python 3.12 FastAPI)
docker compose build

# 3. Fetch OpenNeuro ds005777 (~0.9 GB) into ./data/raw/ds005777
docker compose run --rm app python scripts/download_data.py

# 4. Build the preprocessing cache and group summary (~1–2 min)
docker compose run --rm app python -m backend.cli build-cache

# 5. Start the application on port 8000
docker compose up -d
# Open http://localhost:8000
```

## Verification

```bash
# Run unit tests inside the container
docker compose run --rm --no-deps app pytest -q

# Check runtime health
curl http://localhost:8000/api/health
```

## Notes

- FastAPI serves the compiled React SPA directly from `frontend/dist`. For local frontend hot-reload during development, run `npm run dev` inside `frontend/` (proxies `/api` to `:8000`).
- On Linux hosts needing host networking instead of port mapping, replace `ports: ["8000:8000"]` with `network_mode: host`.
- Outbound HTTPS is required for OpenNeuro S3 downloads (one-off) and the configured LLM endpoint. Signal processing, group statistics, and visual inspection run 100% locally.
