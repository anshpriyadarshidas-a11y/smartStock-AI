#!/usr/bin/env bash
# Start all SmartStock AI services (Linux/macOS)
# Usage: ./bin/start-services.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p service-logs

echo "Starting backend, frontend and ML services in background..."
nohup npm run start --workspace backend > service-logs/backend.log 2>&1 &
nohup npm run start:frontend > service-logs/frontend.log 2>&1 &
nohup npm run start:ml > service-logs/ml.log 2>&1 &

# Wait for backend health
echo "Waiting for backend health on http://localhost:4000/health..."
for i in {1..30}; do
  if curl -sf http://localhost:4000/health > /dev/null; then
    echo "Backend is ready."
    break
  fi
  sleep 1
done

# Open dashboard (best-effort)
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open http://localhost:3000 || true
elif command -v open >/dev/null 2>&1; then
  open http://localhost:3000 || true
else
  echo "Open http://localhost:3000 in your browser"
fi

echo "Logs: $ROOT/service-logs/"
