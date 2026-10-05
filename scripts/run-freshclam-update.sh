#!/usr/bin/env sh
# run-freshclam-update.sh
# Scheduled nightly update for ClamAV signature database.
# Updates the persistent volume clamav_data_prod without requiring
# the 1.5GB clamd daemon to run 24/7.
set -eu

echo "→ [FreshClam] Starting ClamAV signatures update into clamav_data_prod..."

docker run --rm \
  --name clamav-freshclam-nightly \
  -v clamav_data_prod:/var/lib/clamav \
  clamav/clamav-debian:1.4 \
  freshclam --foreground --stdout

echo "✓ [FreshClam] Virus signatures successfully updated in clamav_data_prod."
