#!/bin/bash
set -euo pipefail

# apply-rke2-config.sh — Sync RKE2 config from ConfigMap to NUC host filesystem
#
# Usage: ./apply-rke2-config.sh [--dry-run] [--restart]
#
# This script:
#   1. Fetches the rke2-config ConfigMap from the cluster
#   2. Writes the config.yaml to /etc/rancher/rke2/ on the NUC
#   3. Optionally restarts the RKE2 service to pick up changes
#
# Requirements:
#   - kubectl configured and authenticated
#   - SSH access to the NUC at 192.168.1.201 (or via SOCKS5 proxy)
#   - RKE2 installed on the NUC
#
# The WAN IP monitor calls this automatically when the home public IP changes.

SSH_HOST="${SSH_HOST:-192.168.1.201}"
SSH_USER="${SSH_USER:-arthur}"
CONFIGMAP_NAMESPACE="${CONFIGMAP_NAMESPACE:-default}"
CONFIGMAP_NAME="${CONFIGMAP_NAME:-rke2-config}"
RKE2_CONFIG_PATH="${RKE2_CONFIG_PATH:-/etc/rancher/rke2/config.yaml}"
DRY_RUN=false
RESTART=false

# Parse args
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=true; shift ;;
    --restart) RESTART=true; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

echo "=== RKE2 Config Sync ==="
echo "Target: ${SSH_USER}@${SSH_HOST}"
echo "ConfigMap: ${CONFIGMAP_NAMESPACE}/${CONFIGMAP_NAME}"
echo "Destination: ${RKE2_CONFIG_PATH}"
echo ""

# Fetch the config from the ConfigMap
echo "Fetching config from ConfigMap..."
CONFIG_YAML=$(kubectl get configmap "${CONFIGMAP_NAME}" -n "${CONFIGMAP_NAMESPACE}" -o jsonpath='{.data.config\.yaml}')

if [[ -z "${CONFIG_YAML}" ]]; then
  echo "ERROR: Failed to fetch ConfigMap or config.yaml data is empty"
  exit 1
fi

# Show what we're about to write (for verification)
echo ""
echo "Config to apply:"
echo "---"
echo "${CONFIG_YAML}"
echo "---"
echo ""

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "DRY RUN — not writing to NUC"
  exit 0
fi

# Copy to NUC via SSH. Remote path is quoted so it's expanded once on the
# remote shell and can't be mangled by whitespace/globbing.
echo "Copying config to NUC..."
printf '%s\n' "${CONFIG_YAML}" | ssh "${SSH_USER}@${SSH_HOST}" "sudo tee -- '${RKE2_CONFIG_PATH}'" > /dev/null

echo "Config written successfully."

# Validate the config file exists and is readable. With set -euo pipefail an
# explicit `$?` check would be unreachable, so branch on the command directly.
if ! ssh "${SSH_USER}@${SSH_HOST}" "sudo cat -- '${RKE2_CONFIG_PATH}'" > /dev/null 2>&1; then
  echo "ERROR: Config file not accessible on NUC after write"
  exit 1
fi

echo "Config verified on NUC."

# Restart RKE2 if requested
if [[ "${RESTART}" == "true" ]]; then
  echo "Restarting RKE2 service..."
  ssh "${SSH_USER}@${SSH_HOST}" "sudo systemctl restart rke2-server" || {
    echo "ERROR: Failed to restart rke2-server"
    exit 1
  }

  echo "Waiting for RKE2 to become ready..."
  sleep 5

  # Check kubelet health
  ssh "${SSH_USER}@${SSH_HOST}" "sudo systemctl status rke2-server --no-pager -l" | head -10

  echo ""
  echo "RKE2 restart complete. Verify cluster health:"
  echo "  kubectl get nodes"
  echo "  kubectl get pods -A"
else
  echo ""
  echo "RKE2 not restarted (use --restart to apply changes)"
  echo "To manually restart: ssh ${SSH_USER}@${SSH_HOST} 'sudo systemctl restart rke2-server'"
fi

echo ""
echo "Done."
