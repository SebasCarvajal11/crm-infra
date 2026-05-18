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
  git -C "$path" fetch --prune origin
  git -C "$path" checkout "$branch"
  git -C "$path" pull --ff-only origin "$branch"
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

if [[ "$component" == "auth" || "$component" == "full" ]]; then
  run_in_repo "$auth_dir" pnpm install --frozen-lockfile
  with_dotenv "$auth_dir" "$auth_dir/.env.production" pnpm db:push
fi

if [[ "$component" == "collab" || "$component" == "full" ]]; then
  run_in_repo "$collab_dir" pnpm install --frozen-lockfile
  with_dotenv "$collab_dir" "$collab_dir/.env.production" pnpm db:push
fi

if [[ "$component" == "media" || "$component" == "full" ]]; then
  run_in_repo "$media_dir" pnpm install --frozen-lockfile
  with_dotenv "$media_dir" "$media_dir/.env.production" pnpm db:push
fi

run_in_repo "$stack_dir" env \
  KRAKEND_AUTH_HOST="http://auth:3000" \
  KRAKEND_COLLAB_HOST="http://collab:3001" \
  KRAKEND_MEDIA_HOST="http://media:3002" \
  CIMA_AUTH_PATH="$auth_dir" \
  CIMA_COLLAB_PATH="$collab_dir" \
  pnpm gateway:build

service_args=()
case "$component" in
  infra)
    service_args=(postgres_db redis clamav-scanner api-gateway)
    ;;
  auth)
    service_args=(auth auth-email-worker auth-token-cleanup-worker)
    ;;
  collab)
    service_args=(collab collab-orphan-oci-worker)
    ;;
  media)
    service_args=(media)
    ;;
  frontend)
    service_args=(frontend)
    ;;
  full)
    service_args=(
      postgres_db
      redis
      clamav-scanner
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

if [[ ! -f "$stack_dir/.env.production" ]]; then
  echo "Missing environment file: $stack_dir/.env.production" >&2
  exit 1
fi

(
  cd "$stack_dir"
  set -a
  # shellcheck disable=SC1090
  source "$stack_dir/.env.production"
  set +a
  docker compose -f docker-compose.prod.yml up -d --build "${service_args[@]}"
)
