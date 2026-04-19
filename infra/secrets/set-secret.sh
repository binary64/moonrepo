#!/bin/bash
set -euo pipefail

# Script to set/update any secret in AWS Secrets Manager under the moonrepo/ prefix.
#
# Usage:
#   ./set-secret.sh <secret-name> <secret-value>
#
# Examples:
#   ./set-secret.sh cloudflare-api-token-pulumi "cf-xxxxx"
#   ./set-secret.sh pulumi-access-token         "pul-xxxxx"
#   ./set-secret.sh hermes-ha-token             "eyJhbGciOi..."
#
# The secret is stored at: moonrepo/<secret-name>
#
# If a one-arg form is given (legacy Cloudflare-only behaviour), it is rejected
# with a pointer to the new usage so nothing is silently written under the
# wrong key.

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))
cd "$REPO_ROOT/infra/secrets"

check_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: $1 is not installed." >&2
    exit 1
  fi
}
check_tool "aws"

if [ $# -ne 2 ]; then
  cat >&2 <<EOF
Usage: $0 <secret-name> <secret-value>

Stores <secret-value> in AWS Secrets Manager as 'moonrepo/<secret-name>'.

Examples:
  $0 cloudflare-api-token-pulumi "cf-xxxxx"
  $0 hermes-ha-token             "eyJhbGciOi..."

Common secrets:
  cloudflare-api-token-pulumi  — Cloudflare API token for Pulumi
  pulumi-access-token          — Pulumi Cloud access token
  pulumi-aws-credentials       — JSON blob {access-key-id, secret-access-key}
  hermes-ha-token              — Home Assistant long-lived access token (for Hermes)
EOF
  exit 1
fi

SECRET_NAME="$1"
SECRET_VALUE="$2"
PREFIX="moonrepo"
FULL_SECRET_ID="${PREFIX}/${SECRET_NAME}"

# Basic name sanity: lowercase alnum + dash only.
if ! [[ "$SECRET_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "Error: secret name '$SECRET_NAME' is invalid (use lowercase alnum + dashes)." >&2
  exit 1
fi

if [ -z "$SECRET_VALUE" ]; then
  echo "Error: secret value is empty." >&2
  exit 1
fi

echo "Setting secret: ${FULL_SECRET_ID}"

if aws secretsmanager describe-secret --secret-id "${FULL_SECRET_ID}" &>/dev/null; then
  echo "Secret exists, updating value..."
  if ! aws secretsmanager put-secret-value \
    --secret-id "${FULL_SECRET_ID}" \
    --secret-string "${SECRET_VALUE}" >/dev/null; then
    echo "Error: Failed to update secret in AWS Secrets Manager." >&2
    exit 1
  fi
else
  echo "Secret does not exist, creating..."
  if ! aws secretsmanager create-secret \
    --name "${FULL_SECRET_ID}" \
    --secret-string "${SECRET_VALUE}" >/dev/null; then
    echo "Error: Failed to create secret in AWS Secrets Manager." >&2
    exit 1
  fi
fi

echo "✓ Secret ${FULL_SECRET_ID} updated successfully"
echo ""
echo "Next step (cluster secrets): Run ./sync-secrets.sh to re-seal for the cluster."
echo "Next step (hermes host secrets): Run ~/moonrepo/hermes/bootstrap-env.sh on jupiter."
