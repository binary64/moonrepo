#!/bin/bash
set -euo pipefail

# Script to set/update Vercel secrets in AWS Secrets Manager
# Usage: ./set-vercel-secrets.sh <token> <org-id> <project-id-pawpicks>

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))
cd "$REPO_ROOT/infra/secrets"

check_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: $1 is not installed." >&2
    exit 1
  fi
}

check_tool "aws"
check_tool "jq"

if [ $# -ne 3 ]; then
  echo "Usage: $0 <vercel-token> <vercel-org-id> <vercel-project-id-pawpicks>"
  echo ""
  echo "This script sets the Vercel secrets in AWS Secrets Manager."
  echo "  - Token from: https://vercel.com/account/tokens"
  echo "  - Org/Project IDs from: vercel link (check .vercel/project.json)"
  exit 1
fi

VERCEL_TOKEN="$1"
VERCEL_ORG_ID="$2"
VERCEL_PROJECT_ID_PAWPICKS="$3"
PREFIX="moonrepo"
FULL_SECRET_ID="${PREFIX}/vercel-secrets"

SECRET_VALUE=$(jq -n \
  --arg token "$VERCEL_TOKEN" \
  --arg orgId "$VERCEL_ORG_ID" \
  --arg projPawpicks "$VERCEL_PROJECT_ID_PAWPICKS" \
  '{"token":$token,"org-id":$orgId,"project-id-pawpicks":$projPawpicks}')

echo "Setting Vercel secrets: ${FULL_SECRET_ID}"

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

echo "✓ Vercel secrets updated successfully"
echo ""
echo "Next step: Run ./sync-secrets.sh to sync to cluster"
