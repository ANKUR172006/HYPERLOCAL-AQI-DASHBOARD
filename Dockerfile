# Multi-stage Dockerfile for Railway: build `frontend_new` and serve via FastAPI backend.

FROM node:20-alpine AS frontend-build
WORKDIR /work/frontend_new
COPY frontend_new/package.json frontend_new/package-lock.json ./
RUN npm ci
COPY frontend_new/ ./
RUN npm run build

FROM python:3.11-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RUNNING_IN_DOCKER=1 \
    PORT=8000

EXPOSE 8000

WORKDIR /app

# System deps (kept minimal). `curl` is useful for debugging health in Railway shells.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend/ /app/backend/

# Copy built frontend into backend static dir.
COPY --from=frontend-build /work/frontend_new/dist/ /app/backend/app/static/

WORKDIR /app/backend

ENTRYPOINT ["python", "-m", "app.entrypoint"]
