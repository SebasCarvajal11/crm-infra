#!/bin/sh
# Health check script for {{SERVICE_NAME}} container
CONTAINER_MODE=${CONTAINER_MODE:-api}
PORT=${PORT:-{{SERVICE_PORT}}}

if [ "$CONTAINER_MODE" = "api" ]; then
  response=$(wget -qO- --timeout=5 "http://localhost:${PORT}/health" 2>/dev/null)
  if [ $? -ne 0 ]; then
    echo "Health check failed: could not reach /health endpoint"
    exit 1
  fi
  status=$(echo "$response" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$status" = "ok" ]; then
    exit 0
  else
    echo "Health check failed: status is $status"
    exit 1
  fi
else
  WORKER_HEALTH_FILE="/tmp/worker-healthy"
  MAX_AGE_SECONDS=120
  if [ ! -f "$WORKER_HEALTH_FILE" ]; then
    echo "Worker health file not found: $WORKER_HEALTH_FILE"
    exit 1
  fi
  file_age=$(( $(date +%s) - $(date -r "$WORKER_HEALTH_FILE" +%s 2>/dev/null || echo 0) ))
  if [ "$file_age" -gt "$MAX_AGE_SECONDS" ]; then
    echo "Worker health file is stale (${file_age}s old)"
    exit 1
  fi
  content=$(cat "$WORKER_HEALTH_FILE" 2>/dev/null)
  if echo "$content" | grep -q '"status":"ok"'; then
    exit 0
  else
    echo "Worker health check failed: $content"
    exit 1
  fi
fi
