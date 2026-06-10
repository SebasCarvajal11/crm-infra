#!/bin/sh
set -e

HEALTH_URL="http://localhost:${PORT:-8080}/actuator/health"

response=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "")

if echo "$response" | grep -q '"status":"UP"'; then
  exit 0
fi

exit 1
