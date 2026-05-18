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

for cmd in git docker pnpm node flock; do
  require_command "$cmd"
done

base_dir="${DEPLOY_BASE_DIR:?DEPLOY_BASE_DIR is required}"
branch="${DEPLOY_BRANCH:-main}"
stack_dir="$base_dir/crm-infra"
lock_dir="$base_dir/.deploy-lock"

mkdir -p "$lock_dir"
exec 9>"$lock_dir/production.lock"
flock 9

repo_path() {
  printf '%s/%s' "$base_dir" "$1"
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
  printf '%s' "${runtime_url/postgres_db:5432/127.0.0.1:${host_port}}"
}

sync_repo "$stack_dir"

auth_dir="$(repo_path crm-auth)"
collab_dir="$(repo_path crm-collab)"
media_dir="$(repo_path crm-media)"
frontend_dir="$(repo_path crm-frontend)"

case "$component" in
  auth)
    sync_repo "$auth_dir"
    ;;
  collab)
    sync_repo "$collab_dir"
    ;;
  media)
    sync_repo "$media_dir"
    ;;
  frontend)
    sync_repo "$frontend_dir"
    ;;
  full)
    sync_repo "$auth_dir"
    sync_repo "$collab_dir"
    sync_repo "$media_dir"
    sync_repo "$frontend_dir"
    ;;
esac

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

(
  cd "$stack_dir"
  docker compose -f docker-compose.prod.yml up -d postgres_db redis clamav-scanner
)

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
      docker compose -f docker-compose.prod.yml exec -T postgres_db pg_isready -U "$user" -d "$db" >/dev/null 2>&1
    ); then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "Postgres did not become ready in time" >&2
  exit 1
}

wait_for_postgres

if [[ "$component" == "auth" || "$component" == "full" ]]; then
  run_in_repo "$auth_dir" pnpm install --frozen-lockfile
  auth_database_url="$(grep '^DATABASE_URL=' "$auth_dir/.env.production" | cut -d= -f2-)"
  with_dotenv "$auth_dir" "$auth_dir/.env.production" env DATABASE_URL="$(host_db_url "$auth_database_url")" pnpm db:push
fi

if [[ "$component" == "collab" || "$component" == "full" ]]; then
  run_in_repo "$collab_dir" pnpm install --frozen-lockfile
  collab_database_url="$(grep '^DATABASE_URL=' "$collab_dir/.env.production" | cut -d= -f2-)"
  with_dotenv "$collab_dir" "$collab_dir/.env.production" env DATABASE_URL="$(host_db_url "$collab_database_url")" pnpm db:push
fi

if [[ "$component" == "media" || "$component" == "full" ]]; then
  run_in_repo "$media_dir" pnpm install --frozen-lockfile
  media_database_url="$(grep '^DATABASE_URL=' "$media_dir/.env.production" | cut -d= -f2-)"
  with_dotenv "$media_dir" "$media_dir/.env.production" env DATABASE_URL="$(host_db_url "$media_database_url")" pnpm db:push
fi

run_in_repo "$stack_dir" env \
  KRAKEND_AUTH_HOST="http://auth:3000" \
  KRAKEND_COLLAB_HOST="http://collab:3001" \
  KRAKEND_MEDIA_HOST="http://media:3002" \
  GATEWAY_TRUST_SECRET="${GATEWAY_TRUST_SECRET}" \
  CIMA_AUTH_PATH="$auth_dir" \
  CIMA_COLLAB_PATH="$collab_dir" \
  pnpm gateway:build

service_args=()
case "$component" in
  infra)
    service_args=(api-gateway)
    ;;
  auth)
    service_args=(auth auth-email-worker auth-token-cleanup-worker api-gateway)
    ;;
  collab)
    service_args=(collab collab-orphan-oci-worker api-gateway)
    ;;
  media)
    service_args=(media api-gateway)
    ;;
  frontend)
    service_args=(frontend)
    ;;
  full)
    service_args=(
      auth
      auth-email-worker
      auth-token-cleanup-worker
      media
      collab
      collab-orphan-oci-worker
      api-gateway
      frontend
    )
    ;;
esac

(
  cd "$stack_dir"
  set -a
  # shellcheck disable=SC1090
  source "$stack_dir/.env.production"
  set +a
  docker compose -f docker-compose.prod.yml up -d --build "${service_args[@]}"
)
