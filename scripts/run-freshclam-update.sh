#!/usr/bin/env bash
# run-freshclam-update.sh
# Scheduled nightly update for ClamAV signature database.
# Updates the persistent volume crm-infra_clamav_data_prod without requiring
# the 1.5GB clamd daemon to run 24/7.
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH:-}"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

echo "[$(timestamp)] [FreshClam] Starting ClamAV virus signature update..."

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
infra_dir="$(cd "${script_dir}/.." && pwd)"
compose_file="${infra_dir}/docker-compose.prod.yml"
env_file="${infra_dir}/.env.production"

if command -v docker >/dev/null 2>&1; then
  if [[ -f "$compose_file" ]]; then
    echo "[$(timestamp)] [FreshClam] Using docker compose with profile 'maintenance'..."
    compose_args=(-p "crm-infra" -f "$compose_file")
    if [[ -f "$env_file" ]]; then
      compose_args=(--env-file "$env_file" "${compose_args[@]}")
    fi
    docker compose "${compose_args[@]}" --profile maintenance run --rm clamav-freshclam
  else
    echo "[$(timestamp)] [FreshClam] Using standalone docker run..."
    docker run --rm \
      --name clamav-freshclam-nightly \
      -v crm-infra_clamav_data_prod:/var/lib/clamav \
      clamav/clamav-debian:1.4 \
      freshclam --foreground --stdout
  fi
  echo "[$(timestamp)] [FreshClam] Virus signatures successfully updated in crm-infra_clamav_data_prod."
else
  echo "[$(timestamp)] [FreshClam] ERROR: Docker command not found in PATH." >&2
  exit 1
fi
