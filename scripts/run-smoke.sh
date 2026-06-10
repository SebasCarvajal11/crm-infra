#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_ROOT="$(dirname "$SCRIPT_DIR")"

HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
GATEWAY_PORT="${GATEWAY_HOST_PORT:-18080}"
SMOKE_BASE_URL="${SMOKE_BASE_URL:-http://127.0.0.1:${FRONTEND_HOST_PORT:-80}}"

echo ""
echo "=== CIMA CRM Smoke Test ==="
echo ""

# ── 1. Esperar health endpoints ────────────────────────────────
echo "[1/3] Esperando servicios (timeout: ${HEALTH_TIMEOUT}s)..."

wait_for_url() {
  local url="$1" name="$2"
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  while (( SECONDS < deadline )); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "  [OK] $name"
      return 0
    fi
    sleep 3
  done
  echo "  [FAIL] $name no respondio en ${HEALTH_TIMEOUT}s: $url"
  return 1
}

FAILED=0
wait_for_url "http://localhost:${GATEWAY_PORT}/api/v1/health" "api-gateway" || FAILED=1

# Read service ports from registry/services.json
SCRIPT_DIR_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_ROOT_PATH="$(dirname "$SCRIPT_DIR_PATH")"
SERVICES_JSON="$INFRA_ROOT_PATH/registry/services.json"

if [ -f "$SERVICES_JSON" ]; then
  while IFS='|' read -r name port; do
    wait_for_url "http://localhost:${port}/api/v1/health" "crm-${name}" || FAILED=1
  done < <(node -e "
    const svcs = JSON.parse(require('fs').readFileSync('$SERVICES_JSON', 'utf8'));
    svcs.filter(s => s.port).forEach(s => console.log(s.name + '|' + s.port));
  ")
else
  echo "  [WARN] services.json not found, using default ports"
  wait_for_url "http://localhost:3000/api/v1/health" "crm-auth" || FAILED=1
  wait_for_url "http://localhost:3001/api/v1/health" "crm-collab" || FAILED=1
  wait_for_url "http://localhost:3002/api/v1/health" "crm-media" || FAILED=1
fi

wait_for_url "http://localhost:${FRONTEND_HOST_PORT:-80}" "crm-frontend" || FAILED=1

if (( FAILED )); then
  echo ""
  echo "[ABORT] Uno o mas servicios no arrancaron correctamente."
  exit 1
fi

echo ""

# ── 2. Ejecutar Playwright ─────────────────────────────────────
echo "[2/3] Ejecutando Playwright smoke tests..."
export SMOKE_BASE_URL
cd "$INFRA_ROOT"

pnpm dlx playwright install chromium --with-deps 2>/dev/null
pnpm dlx @playwright/test test -c scripts/playwright.smoke.config.js
EXIT_CODE=$?

echo ""

# ── 3. Resultado ───────────────────────────────────────────────
echo "[3/3] Smoke test completado — exit code: $EXIT_CODE"
if (( EXIT_CODE == 0 )); then
  echo "✅ Todos los flujos smoke pasaron exitosamente."
else
  echo "❌ Smoke test fallo. Revisa el reporte en test-results/smoke-report/"
fi

exit $EXIT_CODE
