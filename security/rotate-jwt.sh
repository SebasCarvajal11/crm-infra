#!/usr/bin/env bash
set -euo pipefail

# ─── JWT Key Rotation Script for CIMA CRM ───
# Generates a new RSA keypair, archives the old one, and encrypts
# the updated secrets with sops.
#
# Usage:
#   ./rotate-jwt.sh [--service auth|collab] [--overlap-hours 24]
#
# Requirements:
#   - age (for sops encryption)
#   - sops (for secret encryption)
#   - node (for RSA key generation)
#
# The script expects SOPS_AGE_KEY environment variable to be set
# with the age private key, or the key at ~/.config/sops/age/keys.txt.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_ROOT="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="${INFRA_ROOT}/secrets"

service="${1:-auth}"
overlap_hours="${2:-24}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"

log() { echo "[rotate-jwt] $(date -u +%H:%M:%S) $*"; }

# Validate service
if [[ "$service" != "auth" && "$service" != "collab" ]]; then
  echo "Error: service must be 'auth' or 'collab'" >&2
  exit 1
fi

# Check required tools
for cmd in node sops age-keygen; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: $cmd is required but not installed" >&2
    exit 1
  fi
done

# Step 1: Generate new RSA keypair
log "Generating new RSA-2048 keypair for ${service}..."
read -r new_private new_public < <(node -e "
const { generateKeyPairSync } = require('node:crypto');
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const esc = (pem) => JSON.stringify(pem.trimEnd());
console.log(esc(privateKey) + ' ' + esc(publicKey));
")

log "New keys generated (KID: ${service}-rsa-${timestamp})"

# Step 2: Archive old keys (if they exist in env or file)
env_file="${INFRA_ROOT}/../crm-${service}/.env.production"
if [[ -f "$env_file" ]]; then
  log "Archiving current keys from ${env_file}..."
  archive_file="${SECRETS_DIR}/${service}.jwt-archive.${timestamp}.txt"
  {
    echo "# Archived at ${timestamp}"
    echo "# Overlap window: ${overlap_hours} hours"
    echo "# After overlap, remove JWT_PRIVATE_KEY_PREV from service env"
    grep -E '^JWT_PRIVATE_KEY=|^JWT_PUBLIC_KEY=|^SERVICE_JWT_PRIVATE_KEY=|^SERVICE_JWT_PUBLIC_KEY=' "$env_file" 2>/dev/null || true
  } > "$archive_file"
  log "Archive written to ${archive_file}"
fi

# Step 3: Update the env file with new keys
log "Updating ${env_file} with new keys..."
if [[ ! -f "$env_file" ]]; then
  echo "Warning: ${env_file} not found — creating from scratch"
  touch "$env_file"
fi

# Remove old key lines
sed -i.bak '/^JWT_PRIVATE_KEY=/d; /^JWT_PUBLIC_KEY=/d; /^SERVICE_JWT_PRIVATE_KEY=/d; /^SERVICE_JWT_PUBLIC_KEY=/d; /^JWT_KID=/d; /^SERVICE_JWT_KID=/d' "$env_file"
rm -f "${env_file}.bak"

if [[ "$service" == "auth" ]]; then
  echo "JWT_PRIVATE_KEY=${new_private}" >> "$env_file"
  echo "JWT_PUBLIC_KEY=${new_public}" >> "$env_file"
  echo "JWT_KID=${service}-rsa-${timestamp}" >> "$env_file"
else
  echo "SERVICE_JWT_PRIVATE_KEY=${new_private}" >> "$env_file"
  echo "SERVICE_JWT_PUBLIC_KEY=${new_public}" >> "$env_file"
  echo "SERVICE_JWT_KID=${service}-rsa-${timestamp}" >> "$env_file"
fi

log "Keys updated in ${env_file}"

# Step 4: Encrypt with sops if available
if command -v sops >/dev/null 2>&1; then
  enc_file="${SECRETS_DIR}/crm-${service}.env.enc"
  log "Encrypting ${env_file} → ${enc_file}..."
  sops -e "$env_file" > "$enc_file"
  log "Encrypted secret written to ${enc_file}"
else
  log "sops not found — skipping encryption"
fi

# Step 5: Summary
log ""
log "═══════════════════════════════════════════════════════"
log "  Key rotation complete for crm-${service}"
log "═══════════════════════════════════════════════════════"
log ""
log "  New KID: ${service}-rsa-${timestamp}"
log "  Overlap window: ${overlap_hours} hours"
log ""
log "  Next steps:"
log "  1. Deploy the updated service with the new keys"
log "  2. During the overlap window, the service should accept"
log "     BOTH the new and old keys (implement in auth middleware)"
log "  3. After ${overlap_hours}h, remove JWT_PRIVATE_KEY_PREV"
log "     from the service environment"
log "  4. If using sops, commit the encrypted file:"
log "     git add ${SECRETS_DIR}/"
log ""
