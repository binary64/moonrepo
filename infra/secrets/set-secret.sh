#!/bin/bash
set -euo pipefail

# Script to set/update secrets in AWS Secrets Manager
# Usage: ./set-secret.sh <secret-name> <secret-value>
# Example: ./set-secret.sh pulumi-access-token "pul-xxxxx"

if [ $# -ne 2 ]; then
  echo "Usage: $0 <secret-name> <secret-value>"
  echo ""
  echo "Available secrets:"
  echo "  - pulumi-access-token"
  echo "  - cloudflare-api-token-pulumi"
  exit 1
fi

SECRET_NAME="$1"
SECRET_VALUE="$2"
PREFIX="moonrepo"

# Validate secret name
if [[ ! "$SECRET_NAME" =~ ^(pulumi-access-token|cloudflare-api-token-pulumi)$ ]]; then
  echo "Error: Invalid secret name. Must be one of: pulumi-access-token, cloudflare-api-token-pulumi"
  exit 1
fi

FULL_SECRET_ID="${PREFIX}/${SECRET_NAME}"

echo "Setting secret: ${FULL_SECRET_ID}"

# Check if secret exists, if not create it
if aws secretsmanager describe-secret --secret-id "${FULL_SECRET_ID}" &>/dev/null; then
  echo "Secret exists, updating value..."
  aws secretsmanager put-secret-value \
    --secret-id "${FULL_SECRET_ID}" \
    --secret-string "${SECRET_VALUE}"
else
  echo "Error: Secret ${FULL_SECRET_ID} does not exist. Run 'cd infra/pulumi-bootstrap && pulumi up' to create it first."
  exit 1
fi

echo "✓ Secret updated successfully"
echo ""
echo "Next step: Run ./sync-secrets.sh to sync to cluster"
