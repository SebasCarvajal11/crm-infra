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

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
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
legacy_project="crm-infra"

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

project_has_any_container() {
  local project="$1"
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

ensure_shared_docker_primitives() {
  docker network inspect crm-shared-backplane >/dev/null 2>&1 || docker network create crm-shared-backplane >/dev/null
  docker volume inspect crm-infra_postgres_data_prod >/dev/null 2>&1 || docker volume create crm-infra_postgres_data_prod >/dev/null
  docker volume inspect crm-infra_clamav_data_prod >/dev/null 2>&1 || docker volume create crm-infra_clamav_data_prod >/dev/null
  docker volume inspect crm-infra_redis_data_prod >/dev/null 2>&1 || docker volume create crm-infra_redis_data_prod >/dev/null
}

container_db_url() {
  local runtime_url="$1"
  local without_host
  without_host="$(printf '%s' "$runtime_url" | sed -E 's#@[^/]+/#@postgres_db:5432/#')"
  printf '%s' "$without_host"
}

host_db_url() {
  local runtime_url="$1"
  local host_port="${POSTGRES_HOST_PORT:-5432}"
  printf '%s' "${runtime_url/postgres_db:5432/127.0.0.1:${host_port}}"
}

container_redis_url() {
  local runtime_url="$1"
  local normalized
  if [[ -z "$runtime_url" ]]; then
    printf 'redis://redis:6379'
    return
  fi
  normalized="$(printf '%s' "$runtime_url" | sed -E 's#redis://[^/]+#redis://redis:6379#')"
  printf '%s' "$normalized"
}

dump_logs() {
  docker compose -p "$shared_project" -f "$shared_compose" ps || true
  if [[ -n "$target_slot" ]]; then
    APP_SLOT="$target_slot" \
    GATEWAY_SLOT_HOST_PORT="$(slot_gateway_port "$target_slot")" \
    FRONTEND_SLOT_HOST_PORT="$(slot_frontend_port "$target_slot")" \
    docker compose -p "$(slot_project "$target_slot")" -f "$slot_compose" ps || true
    APP_SLOT="$target_slot" \
    GATEWAY_SLOT_HOST_PORT="$(slot_gateway_port "$target_slot")" \
    FRONTEND_SLOT_HOST_PORT="$(slot_frontend_port "$target_slot")" \
    docker compose -p "$(slot_project "$target_slot")" -f "$slot_compose" logs --tail=150 auth media collab api-gateway frontend auth-email-worker auth-identity-outbox-worker auth-token-cleanup-worker media-command-worker media-quarantine-scan-worker || true
  fi
  if [[ -n "$previous_slot" && "$previous_slot" != "$target_slot" ]]; then
    APP_SLOT="$previous_slot" \
    GATEWAY_SLOT_HOST_PORT="$(slot_gateway_port "$previous_slot")" \
    FRONTEND_SLOT_HOST_PORT="$(slot_frontend_port "$previous_slot")" \
    docker compose -p "$(slot_project "$previous_slot")" -f "$slot_compose" ps || true
  fi
}

append_csp_sources() {
  local base="$1"
  local extra="${2:-}"
  extra="$(printf '%s' "$extra" | xargs)"
  if [[ -z "$extra" ]]; then
    printf '%s' "$base"
    return
  fi
  printf '%s %s' "$base" "$extra"
}

render_edge_config() {
  local frontend_port="$1"
  local connect_src img_src
  connect_src="$(append_csp_sources "connect-src 'self'" "${CSP_CONNECT_SRC_EXTRA:-}")"
  img_src="$(append_csp_sources "img-src 'self' data: blob:" "${CSP_IMG_SRC_EXTRA:-}")"
  cat > "$runtime_dir/edge.conf" <<EOF
server {
    listen 80;
    server_name _;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; ${img_src}; font-src 'self' data:; ${connect_src}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    location / {
        proxy_pass http://127.0.0.1:${frontend_port};
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
  local slot="$1"
  shift
  local project output service all_running attempts
  local services=("$@")

  project="$(slot_project "$slot")"

  for attempts in $(seq 1 30); do
    output="$(
      APP_SLOT="$slot" \
      GATEWAY_SLOT_HOST_PORT="$(slot_gateway_port "$slot")" \
      FRONTEND_SLOT_HOST_PORT="$(slot_frontend_port "$slot")" \
      docker compose -p "$project" -f "$slot_compose" ps --status running --services 2>/dev/null || true
    )"

    all_running="true"
    for service in "${services[@]}"; do
      if ! grep -qx "$service" <<<"$output"; then
        all_running="false"
        break
      fi
    done

    if [[ "$all_running" == "true" ]]; then
      return 0
    fi

    sleep 2
  done

  echo "Not all worker services became ready in slot $slot" >&2
  dump_logs
  exit 1
}

write_runtime_env_files() {
  local slot="$1"
  local auth_database_url auth_redis_url collab_database_url collab_redis_url media_database_url media_redis_url

  auth_database_url="$(grep '^DATABASE_URL=' "$auth_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  auth_redis_url="$(grep '^REDIS_URL=' "$auth_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  collab_database_url="$(grep '^DATABASE_URL=' "$collab_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  collab_redis_url="$(grep '^REDIS_URL=' "$collab_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  media_database_url="$(grep '^DATABASE_URL=' "$media_dir/.env.production" | head -n 1 | cut -d= -f2-)"
  media_redis_url="$(grep '^REDIS_URL=' "$media_dir/.env.production" | head -n 1 | cut -d= -f2-)"

  cat > "$runtime_dir/auth.${slot}.env" <<EOF
DATABASE_URL=$(container_db_url "$auth_database_url")
REDIS_URL=$(container_redis_url "$auth_redis_url")
DB_SCHEMA=schema_auth
GATEWAY_TRUST_SECRET=${GATEWAY_TRUST_SECRET}
EOF

  cat > "$runtime_dir/collab.${slot}.env" <<EOF
DATABASE_URL=$(container_db_url "$collab_database_url")
REDIS_URL=$(container_redis_url "$collab_redis_url")
DB_SCHEMA=schema_collab
GATEWAY_TRUST_SECRET=${GATEWAY_TRUST_SECRET}
AUTH_EVENTS_STREAM_KEY=auth:events
AUTH_EVENTS_CONSUMER_GROUP=collab-auth-consumers
AUTH_EVENTS_MAX_RETRIES=3
AUTH_EVENTS_PENDING_IDLE_MS=30000
COLLAB_EVENTS_DLQ_STREAM_KEY=collab:events:dlq
MEDIA_COMMANDS_STREAM_KEY=media:commands
MEDIA_RESPONSES_STREAM_KEY=media:responses
MEDIA_RESPONSES_CONSUMER_GROUP=collab-media-response-consumers
MEDIA_COMMAND_TIMEOUT_MS=8000
JWKS_URI=http://auth:3000/.well-known/jwks.json
EOF

  cat > "$runtime_dir/media.${slot}.env" <<EOF
DATABASE_URL=$(container_db_url "$media_database_url")
REDIS_URL=$(container_redis_url "$media_redis_url")
DB_SCHEMA=schema_media
GATEWAY_TRUST_SECRET=${GATEWAY_TRUST_SECRET}
CLAMAV_HOST=clamav-scanner
CLAMAV_PORT=3310
MEDIA_COMMANDS_STREAM_KEY=media:commands
MEDIA_RESPONSES_STREAM_KEY=media:responses
MEDIA_COMMANDS_CONSUMER_GROUP=media-command-consumers
EOF
}

start_shared_platform() {
  ensure_shared_docker_primitives
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
    KRAKEND_AUTH_HOST="${KRAKEND_AUTH_HOST}" \
    KRAKEND_COLLAB_HOST="${KRAKEND_COLLAB_HOST}" \
    KRAKEND_MEDIA_HOST="${KRAKEND_MEDIA_HOST}" \
    KRAKEND_ENDPOINTS_SOURCE="${KRAKEND_ENDPOINTS_SOURCE:-file}" \
    KRAKEND_PORT="8080" \
    GATEWAY_TRUST_SECRET="${GATEWAY_TRUST_SECRET}" \
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
    APP_SLOT="$slot" docker compose -p "$project" -f "$slot_compose" stop auth-email-worker auth-identity-outbox-worker auth-token-cleanup-worker media-command-worker media-quarantine-scan-worker || true
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
  docker compose -p "$project" -f "$slot_compose" up -d auth-email-worker auth-identity-outbox-worker auth-token-cleanup-worker media-command-worker media-quarantine-scan-worker

  wait_for_compose_services_running "$slot" auth-email-worker auth-identity-outbox-worker auth-token-cleanup-worker media-command-worker media-quarantine-scan-worker
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

KRAKEND_AUTH_HOST="${KRAKEND_AUTH_HOST:-http://auth:3000}"
KRAKEND_COLLAB_HOST="${KRAKEND_COLLAB_HOST:-http://collab:3001}"
KRAKEND_MEDIA_HOST="${KRAKEND_MEDIA_HOST:-http://media:3002}"

if [[ -z "${CSP_CONNECT_SRC_EXTRA:-}" || -z "${CSP_IMG_SRC_EXTRA:-}" ]]; then
  oci_region="$(grep '^OCI_REGION=' "$media_dir/.env.production" 2>/dev/null | head -n 1 | cut -d= -f2-)"
  if [[ -n "$oci_region" ]]; then
    oci_origin="https://objectstorage.${oci_region}.oraclecloud.com"
    if [[ -z "${CSP_CONNECT_SRC_EXTRA:-}" ]]; then
      CSP_CONNECT_SRC_EXTRA="$oci_origin"
    fi
    if [[ -z "${CSP_IMG_SRC_EXTRA:-}" ]]; then
      CSP_IMG_SRC_EXTRA="$oci_origin"
    fi
  fi
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
elif ! slot_has_project "$previous_slot"; then
  if slot_has_project "$(other_slot "$previous_slot")"; then
    previous_slot="$(other_slot "$previous_slot")"
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

legacy_only_stack="false"
if [[ -z "$previous_slot" ]] && project_has_any_container "$legacy_project"; then
  legacy_only_stack="true"
fi

if [[ "$legacy_only_stack" == "false" ]]; then
  activate_edge_slot "${previous_slot:-$target_slot}"
fi

if [[ "$legacy_only_stack" == "true" ]]; then
  docker ps -aq --filter "label=com.docker.compose.project=${legacy_project}" | xargs -r docker rm -f
fi

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
