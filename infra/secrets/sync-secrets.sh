#!/bin/bash
set -euo pipefail

# Script to fetch secrets from AWS Secrets Manager and seal them for K8s
# This is the main script you run to sync secrets to the cluster

# Find repo root and move to script directory
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || (cd "$(dirname "$0")/../.." && pwd))
cd "$REPO_ROOT/infra/secrets"

# Configuration
PREFIX="moonrepo"
SEALED_SECRETS_NAMESPACE="sealed-secrets"
PULUMI_OPERATOR_NAMESPACE="pulumi-operator-system"

# Check for required tools
check_tool() {
  if ! command -v "$1" &>/dev/null; then
    echo "Error: $1 is not installed." >&2
    exit 1
  fi
}

check_tool "aws"
check_tool "jq"
check_tool "kubeseal"
check_tool "kubectl"

# Detect context and set defaults
CURRENT_CONTEXT=$(kubectl config current-context)
CONTEXT="${KUBECTL_CONTEXT:-$CURRENT_CONTEXT}"

echo "Syncing secrets from AWS Secrets Manager..."
echo "Target Kubernetes context: ${CONTEXT}"
echo "Current Kubernetes context: ${CURRENT_CONTEXT}"

if [ "$CONTEXT" != "$CURRENT_CONTEXT" ]; then
  echo "Warning: Target context ($CONTEXT) differs from current context ($CURRENT_CONTEXT)."
  echo "Attempting to switch context..."
  if ! kubectl config use-context "$CONTEXT" &>/dev/null; then
    echo "Error: Could not switch to context '$CONTEXT'. Is it configured?" >&2
    exit 1
  fi
fi

# Validate context environment
if [[ "$CONTEXT" == *"prod"* ]] || [[ "$CONTEXT" == *"rke2"* ]]; then
  ENV_TYPE="production"
elif [[ "$CONTEXT" == *"local"* ]] || [[ "$CONTEXT" == *"k3d"* ]]; then
  ENV_TYPE="local"
else
  ENV_TYPE="unknown"
  echo "Warning: Unrecognized context type. Proceeding with caution."
fi

echo "Environment type detected: ${ENV_TYPE}"
echo ""

# Create unsealed directory if it doesn't exist
mkdir -p unsealed

# Fetch secrets from AWS Secrets Manager
echo "1. Fetching secrets from AWS..."

if ! CLOUDFLARE_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "${PREFIX}/cloudflare-api-token-pulumi" \
  --query SecretString \
  --output text); then
  echo "Error: Failed to fetch cloudflare-api-token-pulumi from AWS." >&2
  exit 1
fi

if ! AWS_CREDENTIALS=$(aws secretsmanager get-secret-value \
  --secret-id "${PREFIX}/pulumi-aws-credentials" \
  --query SecretString \
  --output text); then
  echo "Error: Failed to fetch pulumi-aws-credentials from AWS." >&2
  exit 1
fi

AWS_ACCESS_KEY_ID=$(echo "$AWS_CREDENTIALS" | jq -r '.["access-key-id"]')
AWS_SECRET_ACCESS_KEY=$(echo "$AWS_CREDENTIALS" | jq -r '.["secret-access-key"]')

if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
  echo "Error: Parsed AWS credentials are empty." >&2
  exit 1
fi

echo "✓ Secrets fetched from AWS"

# Generate unsealed K8s secrets
echo ""
echo "2. Generating K8s Secret manifests..."

cat > unsealed/pulumi-secrets.unsealed.yaml <<EOF
---
apiVersion: v1
kind: Secret
metadata:
  name: cloudflare-api-token-pulumi
  namespace: ${PULUMI_OPERATOR_NAMESPACE}
type: Opaque
stringData:
  token: "${CLOUDFLARE_TOKEN}"
---
apiVersion: v1
kind: Secret
metadata:
  name: pulumi-aws-credentials
  namespace: ${PULUMI_OPERATOR_NAMESPACE}
type: Opaque
stringData:
  access-key-id: "${AWS_ACCESS_KEY_ID}"
  secret-access-key: "${AWS_SECRET_ACCESS_KEY}"
EOF

echo "✓ Unsealed secrets generated in unsealed/"

# Seal the secrets
echo ""
echo "3. Sealing secrets with kubeseal..."

mkdir -p sealed

if ! kubeseal --context="${CONTEXT}" \
  --controller-namespace="${SEALED_SECRETS_NAMESPACE}" \
  --format=yaml \
  < unsealed/pulumi-secrets.unsealed.yaml \
  > sealed/pulumi-secrets.yaml; then
  echo "Error: kubeseal failed to seal the secrets." >&2
  echo "Is the sealed-secrets controller running in the '$CONTEXT' cluster?" >&2
  exit 1
fi

echo "✓ Sealed secrets generated in sealed/"

# Show what was created
echo ""
echo "Files created:"
echo "  - unsealed/pulumi-secrets.unsealed.yaml (gitignored)"
echo "  - sealed/pulumi-secrets.yaml (ready to commit)"
echo ""
echo "Next steps:"
echo "  1. Review the sealed secrets: cat sealed/pulumi-secrets.yaml"
echo "  2. Commit to git: git add sealed/ && git commit -m 'update sealed secrets'"
echo "  3. ArgoCD will sync them to the cluster"
