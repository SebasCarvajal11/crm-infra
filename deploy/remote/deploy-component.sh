#!/usr/bin/env bash
set -euo pipefail

component="${1:-}"
if [[ -z "$component" ]]; then
  echo "Usage: deploy-component.sh <infra|auth|collab|media|frontend|marketing|full>" >&2
  exit 1
fi

case "$component" in
  infra|auth|collab|media|frontend|marketing|full) ;;
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

read_env_file_value() {
  local file="$1"
  local key="$2"

  grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true
}

is_placeholder_secret() {
  local value="$1"

  case "$value" in
    ""|"change-me"|"changeme"|"rootpassword"|"marketingpassword"|"marketingpassword_ci"|"password"|"secret")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

validate_marketing_production_secrets() {
  local shared_env="$shared_env_file"
  local marketing_env
  local shared_password service_password service_schema service_user service_host service_port service_db

  marketing_env="$(repo_path "crm-marketing")/.env.production"

  if [[ ! -f "$shared_env" ]]; then
    echo "Missing production env file: $shared_env" >&2
    exit 1
  fi

  if [[ ! -f "$marketing_env" ]]; then
    echo "Missing production env file: $marketing_env" >&2
    echo "Create it from crm-marketing/.env.production.example and fill real values before deploying." >&2
    exit 1
  fi

  shared_password="$(read_env_file_value "$shared_env" "MARKETING_DB_PASSWORD")"
  service_password="$(read_env_file_value "$marketing_env" "DATABASE_PASSWORD")"
  service_schema="$(read_env_file_value "$marketing_env" "DB_SCHEMA")"
  service_user="$(read_env_file_value "$marketing_env" "DATABASE_USER")"
  service_host="$(read_env_file_value "$marketing_env" "DATABASE_HOST")"
  service_port="$(read_env_file_value "$marketing_env" "DATABASE_PORT")"
  service_db="$(read_env_file_value "$marketing_env" "DATABASE_NAME")"

  if is_placeholder_secret "$shared_password"; then
    echo "MARKETING_DB_PASSWORD in $shared_env is missing or still uses a placeholder value." >&2
    exit 1
  fi

  if is_placeholder_secret "$service_password"; then
    echo "DATABASE_PASSWORD in $marketing_env is missing or still uses a placeholder value." >&2
    exit 1
  fi

  if [[ "$shared_password" != "$service_password" ]]; then
    echo "MARKETING_DB_PASSWORD and crm-marketing DATABASE_PASSWORD do not match." >&2
    exit 1
  fi

  if [[ "$service_schema" != "schema_marketing" ]]; then
    echo "crm-marketing DB_SCHEMA must be schema_marketing." >&2
    exit 1
  fi

  if [[ "$service_user" != "marketing_user" ]]; then
    echo "crm-marketing DATABASE_USER must be marketing_user." >&2
    exit 1
  fi

  if [[ "$service_host" != "postgres_db" || "$service_port" != "5432" || "$service_db" != "crm_database" ]]; then
    echo "crm-marketing database target must be postgres_db:5432/crm_database in production." >&2
    exit 1
  fi

  echo "Marketing production database secrets validated for schema_marketing."
}

for cmd in git docker jq flock curl grep cut cat mkdir rm cp; do
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
shared_env_file="$stack_dir/.env.production"
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

version_file() {
  local slot="$1"
  printf '%s/.active-versions-%s' "$base_dir" "$slot"
}

get_active_version() {
  local slot="$1"
  local comp="$2"
  local file
  file="$(version_file "$slot")"
  if [[ -f "$file" ]]; then
    local val
    val="$(grep "^${comp}=" "$file" | cut -d= -f2- || echo "")"
    if [[ "$val" == Syncing* ]]; then
      echo ""
      return 0
    fi
    if [[ "$val" == *"@"* ]]; then
      echo "${val#*@}"
    else
      echo "$val"
    fi
  else
    echo ""
  fi
}

sync_and_resolve_component() {
  local name="$1"
  local dir="$2"
  local requested_version="${3:-}"

  # If no version was explicitly requested, try to get it from the previous slot's registry
  if [[ -z "$requested_version" && -n "${previous_slot:-}" ]]; then
    requested_version="$(get_active_version "$previous_slot" "$name")"
  fi

  # If still empty (e.g., first deployment or no registry entry), default to origin/$branch
  if [[ -z "$requested_version" ]]; then
    requested_version="origin/$branch"
  fi

  echo "Syncing and checking out $name to: $requested_version" >&2
  ensure_repo "$dir"
  git -C "$dir" fetch --prune origin "$branch"
  git -C "$dir" checkout --force "$requested_version"
  git -C "$dir" rev-parse HEAD
}


run_in_repo() {
  local path="$1"
  shift
  (
    cd "$path"
    "$@"
  )
}

shared_compose_cmd() {
  if [[ ! -f "$shared_env_file" ]]; then
    echo "Missing shared environment file: $shared_env_file" >&2
    exit 1
  fi

  (
    cd "$stack_dir"
    set -a
    # shellcheck disable=SC1090
    source "$shared_env_file"
    set +a
    docker compose -p "$shared_project" --env-file "$shared_env_file" -f "$shared_compose" "$@"
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
  shared_compose_cmd ps || true
  if [[ -n "$target_slot" ]]; then
    APP_SLOT="$target_slot" \
    GATEWAY_SLOT_HOST_PORT="$(slot_gateway_port "$target_slot")" \
    FRONTEND_SLOT_HOST_PORT="$(slot_frontend_port "$target_slot")" \
    docker compose -p "$(slot_project "$target_slot")" -f "$slot_compose" ps || true
    APP_SLOT="$target_slot" \
    GATEWAY_SLOT_HOST_PORT="$(slot_gateway_port "$target_slot")" \
    FRONTEND_SLOT_HOST_PORT="$(slot_frontend_port "$target_slot")" \
    docker compose -p "$(slot_project "$target_slot")" -f "$slot_compose" logs --tail=150 auth media collab marketing api-gateway frontend auth-email-worker auth-identity-outbox-worker auth-token-cleanup-worker media-command-worker media-quarantine-scan-worker || true
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
  ensure_shared_docker_primitives
  render_edge_config "$slot_front_port"
  shared_compose_cmd up -d edge-proxy >/dev/null
  shared_compose_cmd exec -T edge-proxy nginx -s reload >/dev/null
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

verify_schema_version() {
  local comp="$1"
  local schema="$2"
  local expected_version="$3"
  
  echo "Checking database schema version for ${comp}..."
  local db_version
  db_version="$(shared_compose_cmd exec -T postgres_db psql -U "${POSTGRES_USER:-root}" -d "${POSTGRES_DB:-crm_database}" -t -A -c "SELECT version FROM ${schema}.schema_version ORDER BY id DESC LIMIT 1;" 2>/dev/null | tr -d '[:space:]' || echo "unknown")"
  
  echo "  Expected version: ${expected_version}"
  echo "  Database version: ${db_version}"
  
  if [[ "$db_version" == "unknown" ]]; then
    echo "  [ERROR] Database schema version for ${comp} is unknown or table does not exist!" >&2
    exit 1
  fi
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
  local sName sDir env_prod dest_env db_url redis_url semver db_schema trust_gateway
  
  # Get all services from registry using jq, filtering out frontend
  local services_to_env
  services_to_env=$(jq -r '.[] | select(.name != "frontend") | .name' registry/services.json)

  for sName in $services_to_env; do
    sDir="$(repo_path "crm-${sName}")"
    env_prod="$sDir/.env.production"
    if [[ ! -f "$env_prod" ]]; then
      if [[ -f "$sDir/.env" ]]; then
        env_prod="$sDir/.env"
      else
        env_prod="$sDir/.env.example"
      fi
    fi
    
    dest_env="$runtime_dir/${sName}.${slot}.env"
    echo "Generating $dest_env from $env_prod..."
    
    db_url="$(grep '^DATABASE_URL=' "$env_prod" | head -n 1 | cut -d= -f2- || echo "")"
    redis_url="$(grep '^REDIS_URL=' "$env_prod" | head -n 1 | cut -d= -f2- || echo "")"
    trust_gateway="$(grep '^TRUST_GATEWAY_JWT_HEADERS=' "$env_prod" | tail -n 1 | cut -d= -f2- || echo "")"
    
    semver="$(jq -r '.version // "1.0.0"' "$sDir/package.json" 2>/dev/null || echo "1.0.0")"
    db_schema="$(jq -r --arg name "$sName" '.[] | select(.name == $name) | .schema // empty' registry/services.json)"
    
    # Copy the whole env file first to retain all microservice-specific env keys
    cp "$env_prod" "$dest_env"
    
    # Append the slot-specific overrides at the end
    {
      echo ""
      echo "# --- Slot Overrides ---"
      if [[ -n "$db_url" ]]; then
        echo "DATABASE_URL=$(container_db_url "$db_url")"
      fi
      if [[ -n "$db_schema" ]]; then
        echo "DB_SCHEMA=${db_schema}"
      fi
      if [[ -n "$redis_url" ]]; then
        echo "REDIS_URL=$(container_redis_url "$redis_url")"
      fi
      if [[ -z "$trust_gateway" ]] && grep -q '^GATEWAY_TRUST_SECRET=' "$env_prod"; then
        echo "TRUST_GATEWAY_JWT_HEADERS=true"
      fi
      echo "SERVICE_VERSION=${semver}"
    } >> "$dest_env"
  done
}

start_shared_platform() {
  ensure_shared_docker_primitives
  shared_compose_cmd up -d postgres_db redis clamav-scanner edge-proxy
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
      shared_compose_cmd exec -T postgres_db pg_isready -U "$user" -d "$db" >/dev/null 2>&1
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
    KRAKEND_AUTH_HOST="${KRAKEND_AUTH_HOST:-http://auth:3000}" \
    KRAKEND_COLLAB_HOST="${KRAKEND_COLLAB_HOST:-http://collab:3001}" \
    KRAKEND_MEDIA_HOST="${KRAKEND_MEDIA_HOST:-http://media:3002}" \
    KRAKEND_MARKETING_HOST="${KRAKEND_MARKETING_HOST:-http://marketing:3003}" \
    KRAKEND_ENDPOINTS_SOURCE="${KRAKEND_ENDPOINTS_SOURCE:-file}" \
    KRAKEND_PORT="8080" \
    pnpm gateway:build --output "$runtime_dir/krakend.${slot}.json"
}

start_slot_web() {
  local slot="$1"
  local project gateway_port frontend_port
  project="$(slot_project "$slot")"
  gateway_port="$(slot_gateway_port "$slot")"
  frontend_port="$(slot_frontend_port "$slot")"

  if [[ "$component" == "full" ]]; then
    APP_SLOT="$slot" \
    GATEWAY_SLOT_HOST_PORT="$gateway_port" \
    FRONTEND_SLOT_HOST_PORT="$frontend_port" \
    docker compose -p "$project" -f "$slot_compose" up -d --build auth media collab marketing api-gateway frontend
  else
    local build_args=""
    case "$component" in
      auth) build_args="auth" ;;
      collab) build_args="collab" ;;
      media) build_args="media" ;;
      frontend) build_args="frontend" ;;
      marketing) build_args="marketing" ;;
    esac

    if [[ -n "$build_args" ]]; then
      APP_SLOT="$slot" \
      GATEWAY_SLOT_HOST_PORT="$gateway_port" \
      FRONTEND_SLOT_HOST_PORT="$frontend_port" \
      docker compose -p "$project" -f "$slot_compose" up -d --build $build_args
    fi

    # Ensure all services in the slot are started (using current images/cache)
    APP_SLOT="$slot" \
    GATEWAY_SLOT_HOST_PORT="$gateway_port" \
    FRONTEND_SLOT_HOST_PORT="$frontend_port" \
    docker compose -p "$project" -f "$slot_compose" up -d auth media collab marketing api-gateway frontend
  fi

  wait_for_http_ok "slot-${slot}-frontend" "http://127.0.0.1:${frontend_port}/"
  wait_for_http_ok "slot-${slot}-gateway" "http://127.0.0.1:${gateway_port}/api/v1/health"
}

stop_slot_workers() {
  local slot="$1"
  local project gateway_port frontend_port
  project="$(slot_project "$slot")"
  gateway_port="$(slot_gateway_port "$slot")"
  frontend_port="$(slot_frontend_port "$slot")"
  if slot_has_project "$slot"; then
    APP_SLOT="$slot" \
    GATEWAY_SLOT_HOST_PORT="$gateway_port" \
    FRONTEND_SLOT_HOST_PORT="$frontend_port" \
    docker compose -p "$project" -f "$slot_compose" stop auth-email-worker auth-identity-outbox-worker auth-token-cleanup-worker media-command-worker media-quarantine-scan-worker || true
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

# Define service directories dynamically and upper-cased names
all_services="$(jq -r '.[] | "\(.name)|crm-\(.name)"' registry/services.json)"

for svc_info in $all_services; do
  sName="$(echo "$svc_info" | cut -d'|' -f1)"
  sDirName="$(echo "$svc_info" | cut -d'|' -f2)"
  declare "${sName}_dir=$(repo_path "$sDirName")"
done

# Resolve active and target slots
previous_slot=""
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

# Resolve the requested version for the active component being deployed
requested_version=""
if [[ "$component" == "infra" ]]; then
  requested_version="${DEPLOY_VERSION_infra:-${DEPLOY_VERSION:-}}"
elif [[ "$component" == "full" ]]; then
  requested_version="${DEPLOY_VERSION:-}"
else
  env_var_name="DEPLOY_VERSION_$(echo "$component" | tr '[:lower:]' '[:upper:]')"
  requested_version="${!env_var_name:-${DEPLOY_VERSION:-}}"
fi

# Sync and resolve all services to their target versions dynamically
echo "Resolving component versions for target slot: $target_slot"
infra_version="$(git -C "$stack_dir" rev-parse HEAD)"

for svc_info in $all_services; do
  sName="$(echo "$svc_info" | cut -d'|' -f1)"
  sDirVar="${sName}_dir"
  sDir="${!sDirVar}"
  
  if [[ "$component" == "$sName" || "$component" == "full" ]]; then
    target_version="$(sync_and_resolve_component "$sName" "$sDir" "$requested_version")"
  else
    target_version="$(sync_and_resolve_component "$sName" "$sDir" "")"
  fi
  
  declare "${sName}_version=${target_version}"
done

validate_marketing_production_secrets
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

set -a
# shellcheck disable=SC1090
source "$shared_env_file"
set +a

db_pass="${POSTGRES_PASSWORD:-rootpassword}"
superuser_url=""
db_port="${POSTGRES_HOST_PORT:-5432}"
db_user="${POSTGRES_USER:-root}"
superuser_url="postgresql://${db_user}:${db_pass}@127.0.0.1:${db_port}/${POSTGRES_DB:-crm_database}"

# Get database services from registry to run migrations/bootstraps dynamically
db_services="$(jq -r '.[] | select(.schema and .dbMigrateScript) | "\(.name)|crm-\(.name)|\(.schema)|\(.dbInitScript // "")|\(.dbMigrateScript // "")"' registry/services.json)"

for svc_info in $db_services; do
  sName="$(echo "$svc_info" | cut -d'|' -f1)"
  sDirName="$(echo "$svc_info" | cut -d'|' -f2)"
  sSchema="$(echo "$svc_info" | cut -d'|' -f3)"
  sInit="$(echo "$svc_info" | cut -d'|' -f4)"
  sMigrate="$(echo "$svc_info" | cut -d'|' -f5)"
  
  sDir="$(repo_path "$sDirName")"
  
  if [[ "$component" == "$sName" || "$component" == "full" ]]; then
    echo "Running migrations for $sName in $sDir..."
    sLanguage=$(jq -r ".[] | select(.name==\"$sName\") | .language // \"typescript\"" registry/services.json)
    sBuildTool=$(jq -r ".[] | select(.name==\"$sName\") | .buildTool // \"gradle\"" registry/services.json)
    sInstallCmd=$(jq -r ".[] | select(.name==\"$sName\") | .installCommand // \"\"" registry/services.json)

    # Install dependencies based on language
    if [[ "$sLanguage" == "typescript" ]]; then
      run_in_repo "$sDir" pnpm install --frozen-lockfile
    elif [[ "$sLanguage" == "java" ]]; then
      if [[ -n "$sInstallCmd" ]]; then
        run_in_repo "$sDir" bash -c "$sInstallCmd"
      fi
    fi

    s_db_url="$(grep '^DATABASE_URL=' "$sDir/.env.production" | cut -d= -f2- || echo "")"
    if [[ -z "$s_db_url" ]]; then
      s_db_url="$(grep '^DATABASE_URL=' "$sDir/.env.example" | cut -d= -f2- || echo "")"
    fi

    mapfile -t setup_scripts < <(
      jq -r ".[] | select(.name==\"$sName\") | (.dbSetupScripts // [(.dbInitScript // empty), (.dbMigrateScript // empty)])[] | select(. != \"\")" registry/services.json
    )

    for setup_script in "${setup_scripts[@]}"; do
      if [[ "$sLanguage" == "typescript" ]]; then
        with_dotenv "$sDir" "$sDir/.env.production" env DB_SUPERUSER_URL="$superuser_url" DATABASE_URL="$(host_db_url "$s_db_url")" DB_SCHEMA="$sSchema" pnpm "$setup_script"
      elif [[ "$sLanguage" == "java" && "$sBuildTool" == "gradle" ]]; then
        with_dotenv "$sDir" "$sDir/.env.production" env DB_SUPERUSER_URL="$superuser_url" DATABASE_URL="$(host_db_url "$s_db_url")" DB_SCHEMA="$sSchema" ./gradlew "$setup_script" --no-daemon
      elif [[ "$sLanguage" == "java" && "$sBuildTool" == "maven" ]]; then
        with_dotenv "$sDir" "$sDir/.env.production" env DB_SUPERUSER_URL="$superuser_url" DATABASE_URL="$(host_db_url "$s_db_url")" DB_SCHEMA="$sSchema" bash -c "chmod +x ./mvnw && ./mvnw '$setup_script' --no-transfer-progress"
      fi
    done
  fi
done

start_slot_web "$target_slot"
activate_edge_slot "$target_slot"
cutover_completed="true"

wait_for_http_ok "public-frontend" "http://127.0.0.1:${public_port}/"
wait_for_http_ok "public-api" "http://127.0.0.1:${public_port}/api/v1/health"

for svc_info in $db_services; do
  sName="$(echo "$svc_info" | cut -d'|' -f1)"
  sSchema="$(echo "$svc_info" | cut -d'|' -f3)"
  sVerVar="${sName}_version"
  
  if [[ "$component" == "$sName" || "$component" == "full" ]]; then
    verify_schema_version "$sName" "$sSchema" "${!sVerVar}"
  fi
done

if [[ -n "$previous_slot" ]]; then
  stop_slot_workers "$previous_slot"
  previous_workers_stopped="true"
fi

start_slot_workers "$target_slot"

printf '%s\n' "$target_slot" > "$active_slot_file"

{
  echo "infra=${infra_version}"
  for svc_info in $all_services; do
    sName="$(echo "$svc_info" | cut -d'|' -f1)"
    sDirVar="${sName}_dir"
    sVerVar="${sName}_version"
    sDir="${!sDirVar}"
    sVer="${!sVerVar}"
    
    sLanguage=$(jq -r ".[] | select(.name==\"$sName\") | .language // \"typescript\"" registry/services.json)
    sBuildTool=$(jq -r ".[] | select(.name==\"$sName\") | .buildTool // \"gradle\"" registry/services.json)
    if [[ "$sLanguage" == "typescript" ]]; then
      sSemver="$(jq -r '.version // "1.0.0"' "$sDir/package.json" 2>/dev/null || echo "1.0.0")"
    elif [[ "$sLanguage" == "java" && "$sBuildTool" == "gradle" ]]; then
      sSemver="$(grep -oP 'version\s*=\s*\K[^\s]+' "$sDir/gradle.properties" 2>/dev/null || echo "1.0.0")"
    elif [[ "$sLanguage" == "java" && "$sBuildTool" == "maven" ]]; then
      sSemver="$(sed -n -E 's/.*<version>([^<]+)<\/version>.*/\1/p' "$sDir/pom.xml" 2>/dev/null | head -n 1 || true)"
      [[ -n "$sSemver" ]] || sSemver="1.0.0"
    else
      sSemver="1.0.0"
    fi
    echo "${sName}=${sSemver}@${sVer}"
  done
} > "$(version_file "$target_slot")"

if [[ -n "$previous_slot" ]]; then
  destroy_slot "$previous_slot"
fi

cutover_completed="false"
echo "Production cutover completed on slot ${target_slot}"
