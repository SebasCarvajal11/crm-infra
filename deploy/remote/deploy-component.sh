#!/usr/bin/env bash
set -euo pipefail

component="${1:-}"
if [[ -z "$component" ]]; then
  echo "Usage: deploy-component.sh <infra|auth|collab|media|frontend|full>" >&2
  exit 1
fi

case "$component" in
  infra|auth|collab|media|frontend|full) ;;
  *)
    echo "Unsupported component: $component" >&2
    exit 1
    ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

for cmd in git docker pnpm node flock curl grep cut cat mkdir rm cp; do
  require_command "$cmd"
done

base_dir="${DEPLOY_BASE_DIR:?DEPLOY_BASE_DIR is required}"
branch="${DEPLOY_BRANCH:-main}"
stack_dir="$base_dir/crm-infra"
lock_dir="$base_dir/.deploy-lock"
runtime_dir="$stack_dir/deploy/runtime"
active_slot_file="$base_dir/.active-slot"
shared_project="crm-shared"
shared_compose="$stack_dir/docker-compose.prod.yml"
slot_compose="$stack_dir/docker-compose.slot.prod.yml"
public_port="${FRONTEND_HOST_PORT:-80}"

mkdir -p "$lock_dir" "$runtime_dir"
exec 9>"$lock_dir/production.lock"
flock 9

previous_slot=""
target_slot=""
cutover_completed="false"
previous_workers_stopped="false"

repo_path() {
  printf '%s/%s' "$base_dir" "$1"
}

slot_project() {
  printf 'crm-slot-%s' "$1"
}

slot_gateway_port() {
  case "$1" in
    blue) printf '18081' ;;
    green) printf '18082' ;;
    *) echo "Unknown slot: $1" >&2; exit 1 ;;
  esac
}

slot_frontend_port() {
  case "$1" in
    blue) printf '8081' ;;
    green) printf '8082' ;;
    *) echo "Unknown slot: $1" >&2; exit 1 ;;
  esac
}

other_slot() {
  case "$1" in
    blue) printf 'green' ;;
    green) printf 'blue' ;;
    *) echo "Unknown slot: $1" >&2; exit 1 ;;
  esac
}

slot_has_project() {
  local project
  project="$(slot_project "$1")"
  docker ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.ID}}' | grep -q .
}

ensure_repo() {
  local path="$1"
  if [[ ! -d "$path/.git" ]]; then
    echo "Missing git repository: $path" >&2
    exit 1
  fi
}

sync_repo() {
  local path="$1"
  ensure_repo "$path"
  git -C "$path" fetch --prune origin "$branch"
  git -C "$path" checkout --force -B "$branch" "origin/$branch"
}

run_in_repo() {
  local path="$1"
  shift
  (
    cd "$path"
    "$@"
  )
}

with_dotenv() {
  local path="$1"
  local env_file="$2"
  shift 2
  if [[ ! -f "$env_file" ]]; then
    echo "Missing environment file: $env_file" >&2
    exit 1
  fi

  (
    cd "$path"
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    "$@"
  )
}

host_db_url() {
  local runtime_url="$1"
  local host_port="${POSTGRES_HOST_PORT:-5432}"
  printf '%s' "${runtime_url/postgres_db:5432/host.docker.internal:${host_port}}"
}

host_redis_url() {
  local runtime_url="$1"
  local host_port="${REDIS_HOST_PORT:-6379}"
  printf '%s' "${runtime_url/redis:6379/host.docker.internal:${host_port}}"
}

dump_logs() {
  docker compose -p "$shared_project" -f "$shared_compose" ps || true
  if [[ -n "$target_slot" ]]; then
    docker compose -p "$(slot_project "$target_slot")" -f "$slot_compose" ps || true
    docker compose -p "$(slot_project "$target_slot")" -f "$slot_compose" logs --tail=150 auth media collab api-gateway frontend auth-email-worker auth-token-cleanup-worker collab-orphan-oci-worker || true
  fi
  if [[ -n "$previous_slot" && "$previous_slot" != "$target_slot" ]]; then
    docker compose -p "$(slot_project "$previous_slot")" -f "$slot_compose" ps || true
  fi
}

render_edge_config() {
  local frontend_port="$1"
  cat > "$runtime_dir/edge.conf" <<EOF
server {
    listen 80;
    server_name _;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    location / {
        proxy_pass http://host.docker.internal:${frontend_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 15s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }
}
EOF
}

activate_edge_slot() {
  local slot="$1"
  local slot_front_port
  slot_front_port="$(slot_frontend_port "$slot")"
  render_edge_config "$slot_front_port"
  docker compose -p "$shared_project" -f "$shared_compose" up -d edge-proxy >/dev/null
  docker compose -p "$shared_project" -f "$shared_compose" exec -T edge-proxy nginx -s reload >/dev/null
}

wait_for_http_ok() {
  local name="$1"
  local url="$2"
  local attempts="${3:-40}"
  local sleep_seconds="${4:-2}"

  for ((i = 1; i <= attempts; i += 1)); do
    if curl --silent --show-error --fail --max-time 10 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "Health verification failed for $name at $url" >&2
  dump_logs
  exit 1
}

wait_for_compose_services_running() {
  local project="$1"
  shift
  local services=("$@")
  local output

  output="$(docker compose -p "$project" -f "$slot_compose" ps --status running --services 2>/dev/null || true)"
  for service in "${services[@]}"; do
    if ! grep -qx "$service" <<<"$output"; then
      echo "Service $service is not running in project $project" >&2
      dump_logs
      exit 1
    fi
  done
}

write_runtime_env_files() {
  local slot="$1"
  local auth_database_url auth_redis_url collab_database_url media_database_url

  auth_database_url="$(grep '^DATABASE_URL=' "$auth_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  auth_redis_url="$(grep '^REDIS_URL=' "$auth_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  collab_database_url="$(grep '^DATABASE_URL=' "$collab_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  media_database_url="$(grep '^DATABASE_URL=' "$media_dir/.env.production" | head -n 1 | cut -d= -f2-)"

  cat > "$runtime_dir/auth.${slot}.env" <<EOF
DATABASE_URL=$(host_db_url "$auth_database_url")
REDIS_URL=$(host_redis_url "$auth_redis_url")
EOF

  cat > "$runtime_dir/collab.${slot}.env" <<EOF
DATABASE_URL=$(host_db_url "$collab_database_url")
MOD_AUTH_URL=http://auth:3000
MOD_MEDIA_URL=http://media:3002
EOF

  cat > "$runtime_dir/media.${slot}.env" <<EOF
DATABASE_URL=$(host_db_url "$media_database_url")
CLAMAV_HOST=host.docker.internal
CLAMAV_PORT=${CLAMAV_HOST_PORT:-3310}
MOD_COLLAB_URL=http://collab:3001
EOF
}

start_shared_platform() {
  docker compose -p "$shared_project" -f "$shared_compose" up -d postgres_db redis clamav-scanner edge-proxy
}

wait_for_postgres() {
  local attempts="${1:-30}"
  local sleep_seconds="${2:-2}"
  local user="${POSTGRES_USER:-root}"
  local db="${POSTGRES_DB:-crm_database}"

  for ((i = 1; i <= attempts; i += 1)); do
    if (
      cd "$stack_dir" &&
      set -a &&
      # shellcheck disable=SC1090
      source "$stack_dir/.env.production" &&
      set +a &&
      docker compose -p "$shared_project" -f "$shared_compose" exec -T postgres_db pg_isready -U "$user" -d "$db" >/dev/null 2>&1
    ); then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "Postgres did not become ready in time" >&2
  exit 1
}

wait_for_shared_services() {
  wait_for_postgres
  wait_for_http_ok "edge-proxy" "http://127.0.0.1:${public_port}/"
}

build_gateway_for_slot() {
  local slot="$1"
  run_in_repo "$stack_dir" env \
    KRAKEND_AUTH_HOST="http://auth:3000" \
    KRAKEND_COLLAB_HOST="http://collab:3001" \
    KRAKEND_MEDIA_HOST="http://media:3002" \
    GATEWAY_TRUST_SECRET="${GATEWAY_TRUST_SECRET}" \
    CIMA_AUTH_PATH="$auth_dir" \
    CIMA_COLLAB_PATH="$collab_dir" \
    pnpm gateway:build --output "$runtime_dir/krakend.${slot}.json"
}

start_slot_web() {
  local slot="$1"
  local project gateway_port frontend_port
  project="$(slot_project "$slot")"
  gateway_port="$(slot_gateway_port "$slot")"
  frontend_port="$(slot_frontend_port "$slot")"

  APP_SLOT="$slot" \
  GATEWAY_SLOT_HOST_PORT="$gateway_port" \
  FRONTEND_SLOT_HOST_PORT="$frontend_port" \
  docker compose -p "$project" -f "$slot_compose" up -d --build auth media collab api-gateway frontend

  wait_for_http_ok "slot-${slot}-frontend" "http://127.0.0.1:${frontend_port}/"
  wait_for_http_ok "slot-${slot}-gateway" "http://127.0.0.1:${gateway_port}/health"
}

stop_slot_workers() {
  local slot="$1"
  local project
  project="$(slot_project "$slot")"
  if slot_has_project "$slot"; then
    APP_SLOT="$slot" docker compose -p "$project" -f "$slot_compose" stop auth-email-worker auth-token-cleanup-worker collab-orphan-oci-worker || true
  fi
}

start_slot_workers() {
  local slot="$1"
  local project gateway_port frontend_port
  project="$(slot_project "$slot")"
  gateway_port="$(slot_gateway_port "$slot")"
  frontend_port="$(slot_frontend_port "$slot")"

  APP_SLOT="$slot" \
  GATEWAY_SLOT_HOST_PORT="$gateway_port" \
  FRONTEND_SLOT_HOST_PORT="$frontend_port" \
  docker compose -p "$project" -f "$slot_compose" up -d auth-email-worker auth-token-cleanup-worker collab-orphan-oci-worker

  wait_for_compose_services_running "$project" auth-email-worker auth-token-cleanup-worker collab-orphan-oci-worker
}

destroy_slot() {
  local slot="$1"
  local project gateway_port frontend_port
  project="$(slot_project "$slot")"
  gateway_port="$(slot_gateway_port "$slot")"
  frontend_port="$(slot_frontend_port "$slot")"

  if slot_has_project "$slot"; then
    APP_SLOT="$slot" \
    GATEWAY_SLOT_HOST_PORT="$gateway_port" \
    FRONTEND_SLOT_HOST_PORT="$frontend_port" \
    docker compose -p "$project" -f "$slot_compose" down --remove-orphans
  fi
}

rollback_if_needed() {
  local exit_code=$?
  if [[ "$cutover_completed" == "true" && -n "$previous_slot" ]]; then
    echo "Deploy failed after cutover. Rolling back public traffic to slot ${previous_slot}." >&2
    activate_edge_slot "$previous_slot" || true
    if [[ "$previous_workers_stopped" == "true" ]]; then
      start_slot_workers "$previous_slot" || true
    fi
  fi
  exit "$exit_code"
}

trap rollback_if_needed ERR

sync_repo "$stack_dir"

auth_dir="$(repo_path crm-auth)"
collab_dir="$(repo_path crm-collab)"
media_dir="$(repo_path crm-media)"
frontend_dir="$(repo_path crm-frontend)"

sync_repo "$auth_dir"
sync_repo "$collab_dir"
sync_repo "$media_dir"
sync_repo "$frontend_dir"

if [[ ! -f "$stack_dir/.env.production" ]]; then
  echo "Missing environment file: $stack_dir/.env.production" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$stack_dir/.env.production"
set +a

if [[ -z "${GATEWAY_TRUST_SECRET:-}" && -f "$collab_dir/.env.production" ]]; then
  GATEWAY_TRUST_SECRET="$(grep '^GATEWAY_TRUST_SECRET=' "$collab_dir/.env.production" | head -n 1 | cut -d= -f2-)"
fi

if [[ -z "${GATEWAY_TRUST_SECRET:-}" && -f "$media_dir/.env.production" ]]; then
  GATEWAY_TRUST_SECRET="$(grep '^GATEWAY_TRUST_SECRET=' "$media_dir/.env.production" | head -n 1 | cut -d= -f2-)"
fi

if [[ -z "${GATEWAY_TRUST_SECRET:-}" ]]; then
  echo "Missing GATEWAY_TRUST_SECRET in stack or service environments" >&2
  exit 1
fi

if [[ -f "$active_slot_file" ]]; then
  previous_slot="$(tr -d '[:space:]' < "$active_slot_file")"
fi

if [[ "$previous_slot" != "blue" && "$previous_slot" != "green" ]]; then
  if slot_has_project blue; then
    previous_slot="blue"
  elif slot_has_project green; then
    previous_slot="green"
  else
    previous_slot=""
  fi
fi

if [[ -n "$previous_slot" ]]; then
  target_slot="$(other_slot "$previous_slot")"
else
  target_slot="blue"
fi

write_runtime_env_files blue
write_runtime_env_files green
build_gateway_for_slot "$target_slot"
activate_edge_slot "${previous_slot:-$target_slot}"

start_shared_platform
wait_for_postgres

run_in_repo "$auth_dir" pnpm install --frozen-lockfile
run_in_repo "$collab_dir" pnpm install --frozen-lockfile
run_in_repo "$media_dir" pnpm install --frozen-lockfile

auth_database_url="$(grep '^DATABASE_URL=' "$auth_dir/.env.production" | cut -d= -f2-)"
collab_database_url="$(grep '^DATABASE_URL=' "$collab_dir/.env.production" | cut -d= -f2-)"
media_database_url="$(grep '^DATABASE_URL=' "$media_dir/.env.production" | cut -d= -f2-)"

with_dotenv "$auth_dir" "$auth_dir/.env.production" env DATABASE_URL="$(host_db_url "$auth_database_url")" pnpm db:push
with_dotenv "$collab_dir" "$collab_dir/.env.production" env DATABASE_URL="$(host_db_url "$collab_database_url")" pnpm db:push
with_dotenv "$media_dir" "$media_dir/.env.production" env DATABASE_URL="$(host_db_url "$media_database_url")" pnpm db:push

start_slot_web "$target_slot"
activate_edge_slot "$target_slot"
cutover_completed="true"

wait_for_http_ok "public-frontend" "http://127.0.0.1:${public_port}/"
wait_for_http_ok "public-api" "http://127.0.0.1:${public_port}/api/health"

if [[ -n "$previous_slot" ]]; then
  stop_slot_workers "$previous_slot"
  previous_workers_stopped="true"
fi

start_slot_workers "$target_slot"

printf '%s\n' "$target_slot" > "$active_slot_file"

if [[ -n "$previous_slot" ]]; then
  destroy_slot "$previous_slot"
fi

cutover_completed="false"
echo "Production cutover completed on slot ${target_slot}"
