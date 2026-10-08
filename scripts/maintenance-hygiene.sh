#!/usr/bin/env bash
set -euo pipefail

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Starting automated maintenance hygiene..."

# 1. Purgar imágenes inactivas con más de 72 horas de antigüedad
docker image prune -a -f --filter "until=72h" >/dev/null 2>&1 || true

# 2. Purgar caché de BuildKit conservando un piso máximo de 1.5GB
docker builder prune -f --keep-storage 1.5GB >/dev/null 2>&1 || true

# 3. Limpiar caché de paquetes APT del sistema operativo
sudo apt-get clean >/dev/null 2>&1 || true

# 4. Aspirar registros de journald con más de 14 días de antigüedad
sudo journalctl --vacuum-time=14d >/dev/null 2>&1 || true

echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Automated maintenance hygiene completed."
