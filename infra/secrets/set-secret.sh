#!/bin/bash
set -euo pipefail

# Script to set/update Cloudflare API token in AWS Secrets Manager
# Usage: ./set-secret.sh <secret-value>
# Example: ./set-secret.sh "your-cloudflare-api-token"

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
  aws secretsmanager put-secret-value \
    --secret-id "${FULL_SECRET_ID}" \
    --secret-string "${SECRET_VALUE}"
else
  echo "Error: Secret ${FULL_SECRET_ID} does not exist."
  echo "Run 'cd infra/pulumi-bootstrap && pulumi up' to create it first."
  exit 1
fi

echo "✓ Cloudflare API token updated successfully"
echo ""
echo "Next step: Run ./sync-secrets.sh to sync to cluster"
