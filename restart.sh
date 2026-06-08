#!/usr/bin/env bash
set -e

echo "Stopping all services..."
docker compose down

echo "Rebuilding and starting all services..."
docker compose up --build -d

echo "Tailing logs (Ctrl+C to stop following)..."
docker compose logs -f
