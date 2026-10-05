#!/usr/bin/env bash
# install-maintenance-cron.sh
# Idempotently installs the nightly freshclam update cron job and logrotate config.
set -euo pipefail

base_dir="${DEPLOY_BASE_DIR:-/opt/cima}"
script_path="${base_dir}/crm-infra/scripts/run-freshclam-update.sh"
log_path="/var/log/cima-freshclam.log"

if [[ ! -f "$script_path" ]]; then
  # Fallback to local path relative to this script
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  script_path="${script_dir}/run-freshclam-update.sh"
fi

if [[ ! -f "$script_path" ]]; then
  echo "[cron] ERROR: Target script $script_path not found." >&2
  exit 1
fi

chmod +x "$script_path"

echo "[cron] Configuring nightly ClamAV signature update..."

# 1. Ensure log file exists with safe permissions
if [[ -w "/var/log" || "${EUID:-$(id -u)}" -eq 0 ]]; then
  touch "$log_path" 2>/dev/null || true
  chmod 644 "$log_path" 2>/dev/null || true
else
  # Non-root fallback for log path
  log_dir="${base_dir}/logs"
  mkdir -p "$log_dir"
  log_path="${log_dir}/cima-freshclam.log"
  touch "$log_path"
fi

# 2. Installation: Prefer /etc/cron.d for clean modular host configuration
cron_d_file="/etc/cron.d/cima-freshclam"
installed="false"

if [[ -d "/etc/cron.d" && (-w "/etc/cron.d" || "${EUID:-$(id -u)}" -eq 0) ]]; then
  cat > "$cron_d_file" <<EOF
# /etc/cron.d/cima-freshclam
# Actualización diaria de firmas ClamAV a las 03:00 AM UTC
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

0 3 * * * root ${script_path} >> ${log_path} 2>&1
EOF
  chmod 644 "$cron_d_file"
  echo "[cron] Installed system cron task at $cron_d_file"
  installed="true"
fi

# Fallback to user crontab if /etc/cron.d is not available or not writable
if [[ "$installed" == "false" ]] && command -v crontab >/dev/null 2>&1; then
  current_crontab="$(crontab -l 2>/dev/null || true)"
  user_cron_job="0 3 * * * ${script_path} >> ${log_path} 2>&1"
  if echo "$current_crontab" | grep -Fq "$script_path"; then
    echo "[cron] Cron job already registered in user crontab."
  else
    (echo "$current_crontab"; echo "$user_cron_job") | crontab -
    echo "[cron] Registered cron job in user crontab."
  fi
  installed="true"
fi

# 3. Configure logrotate if /etc/logrotate.d is writable
logrotate_file="/etc/logrotate.d/cima-freshclam"
if [[ -d "/etc/logrotate.d" && (-w "/etc/logrotate.d" || "${EUID:-$(id -u)}" -eq 0) ]]; then
  cat > "$logrotate_file" <<EOF
${log_path} {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    create 0644 root root
}
EOF
  chmod 644 "$logrotate_file"
  echo "[cron] Configured logrotate at $logrotate_file"
fi

echo "[cron] ClamAV maintenance cron installation complete."
