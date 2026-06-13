#!/usr/bin/env bash
set -euo pipefail

base_dir="${DEPLOY_BASE_DIR:?DEPLOY_BASE_DIR is required}"
owner="${GITHUB_OWNER:-SebasCarvajal11}"
branch="${DEPLOY_BRANCH:-main}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

for cmd in git docker pnpm node; do
  require_command "$cmd"
done

mkdir -p "$base_dir"

ensure_docker_primitive() {
  local kind="$1"
  local name="$2"

  if ! docker "$kind" inspect "$name" >/dev/null 2>&1; then
    docker "$kind" create "$name" >/dev/null
  fi
}

clone_or_update() {
  local repo_name="$1"
  local repo_url="https://github.com/${owner}/${repo_name}.git"
  local repo_path="${base_dir}/${repo_name}"

  if [[ "$repo_name" == "crm-marketing" ]]; then
    repo_url="https://github.com/arisocode/CIMA---Marketing-Analytics-Backend.git"
  fi

  if [[ ! -d "$repo_path/.git" ]]; then
    git clone "$repo_url" "$repo_path"
  fi

  git -C "$repo_path" fetch --prune origin "$branch"
  git -C "$repo_path" checkout --force -B "$branch" "origin/$branch"
}

for repo in crm-infra crm-auth crm-collab crm-media crm-frontend crm-marketing; do
  clone_or_update "$repo"
done

ensure_env_file() {
  local repo_name="$1"
  local example_path="${base_dir}/${repo_name}/.env.production.example"
  local env_path="${base_dir}/${repo_name}/.env.production"

  if [[ ! -f "$env_path" && -f "$example_path" ]]; then
    cp "$example_path" "$env_path"
    echo "Created ${env_path} from template. Fill real values before deploying."
  fi
}

for repo in crm-infra crm-auth crm-collab crm-media crm-frontend crm-marketing; do
  ensure_env_file "$repo"
done

# --- SOPS secret decryption ---
# If sops is available and encrypted env files exist, decrypt them
# to overwrite the template .env.production files with real values.
# Requires SOPS_AGE_KEY environment variable (or age key at ~/.config/sops/age/keys.txt).
decrypt_sops_secrets() {
  if ! command -v sops >/dev/null 2>&1; then
    echo "[sops] sops not found — skipping secret decryption"
    return 0
  fi

  local secrets_dir="${base_dir}/crm-infra/secrets"
  if [[ ! -d "$secrets_dir" ]]; then
    echo "[sops] No secrets/ directory — skipping"
    return 0
  fi

  for enc_file in "$secrets_dir"/*.env.enc; do
    [[ -f "$enc_file" ]] || continue
    local basename
    basename="$(basename "$enc_file" .env.enc)"
    local target="${base_dir}/${basename}/.env.production"

    echo "[sops] Decrypting ${enc_file} → ${target}"
    sops -d "$enc_file" > "$target"
  done
}

decrypt_sops_secrets

mkdir -p "${base_dir}/crm-infra/deploy/runtime"

ensure_docker_primitive network crm-shared-backplane
ensure_docker_primitive volume crm-infra_postgres_data_prod
ensure_docker_primitive volume crm-infra_clamav_data_prod

if [[ ! -f "${base_dir}/.active-slot" ]]; then
  printf 'blue\n' > "${base_dir}/.active-slot"
fi

if [[ ! -f "${base_dir}/crm-infra/deploy/runtime/edge.conf" ]]; then
  cat > "${base_dir}/crm-infra/deploy/runtime/edge.conf" <<'EOF'
server {
    listen 80;
    server_name _;

    location / {
        return 503;
    }
}
EOF
fi

echo "Server bootstrap complete under ${base_dir}"
echo "Next steps:"
echo "1. Fill each .env.production with real values."
echo "2. Ensure OCI config exists at the path referenced by crm-collab and crm-media."
echo "3. Run crm-infra/deploy/remote/deploy-component.sh full"
