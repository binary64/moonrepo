#!/bin/bash
set -euo pipefail

# Script to set/update Cloudflare API token in AWS Secrets Manager
# Usage: ./set-secret.sh <secret-value>
# Example: ./set-secret.sh "your-cloudflare-api-token"

# Find repo root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))
cd "$REPO_ROOT/infra/secrets"

# Check for required tools
check_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: $1 is not installed." >&2
    exit 1
  fi
}

check_tool "aws"

if [ $# -ne 1 ]; then
  echo "Usage: $0 <cloudflare-api-token>"
  echo ""
  echo "This script sets the Cloudflare API token in AWS Secrets Manager."
  echo "Get your token from: https://dash.cloudflare.com/profile/api-tokens"
  echo ""
  echo "Required permissions:"
  echo "  - Account.Account Settings:Read"
  echo "  - Zone.Zone:Read"
  echo "  - User.API Tokens:Edit"
  exit 1
fi

SECRET_VALUE="$1"
PREFIX="moonrepo"
SECRET_NAME="cloudflare-api-token-pulumi"
FULL_SECRET_ID="${PREFIX}/${SECRET_NAME}"

echo "Setting Cloudflare API token: ${FULL_SECRET_ID}"

# Check if secret exists
if aws secretsmanager describe-secret --secret-id "${FULL_SECRET_ID}" &>/dev/null; then
  echo "Secret exists, updating value..."
  if ! aws secretsmanager put-secret-value \
    --secret-id "${FULL_SECRET_ID}" \
    --secret-string "${SECRET_VALUE}"; then
    echo "Error: Failed to update secret in AWS Secrets Manager." >&2
    exit 1
  fi
else
  echo "Error: Secret ${FULL_SECRET_ID} does not exist." >&2
  echo "Run 'cd infra/pulumi-bootstrap && pulumi up' to create it first." >&2
  exit 1
fi

echo "✓ Cloudflare API token updated successfully"
echo ""
echo "Next step: Run ./sync-secrets.sh to sync to cluster"
