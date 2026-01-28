#!/bin/bash
set -euo pipefail

# Script to fetch secrets from AWS Secrets Manager and seal them for K8s
# This is the main script you run to sync secrets to the cluster

PREFIX="moonrepo"
CONTEXT="${KUBECTL_CONTEXT:-prod}"
SEALED_SECRETS_NAMESPACE="sealed-secrets"
PULUMI_OPERATOR_NAMESPACE="pulumi-operator-system"

echo "Syncing secrets from AWS Secrets Manager..."
echo "Kubernetes context: ${CONTEXT}"
echo ""

# Create unsealed directory if it doesn't exist
mkdir -p unsealed

# Fetch secrets from AWS Secrets Manager
echo "1. Fetching secrets from AWS..."

PULUMI_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "${PREFIX}/pulumi-access-token" \
  --query SecretString \
  --output text)

CLOUDFLARE_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id "${PREFIX}/cloudflare-api-token-pulumi" \
  --query SecretString \
  --output text)

echo "✓ Secrets fetched from AWS"

# Generate unsealed K8s secrets
echo ""
echo "2. Generating K8s Secret manifests..."

cat > unsealed/pulumi-secrets.unsealed.yaml <<EOF
---
apiVersion: v1
kind: Secret
metadata:
  name: pulumi-access-token
  namespace: ${PULUMI_OPERATOR_NAMESPACE}
type: Opaque
stringData:
  accessToken: "${PULUMI_TOKEN}"
---
apiVersion: v1
kind: Secret
metadata:
  name: cloudflare-api-token-pulumi
  namespace: ${PULUMI_OPERATOR_NAMESPACE}
type: Opaque
stringData:
  token: "${CLOUDFLARE_TOKEN}"
EOF

echo "✓ Unsealed secrets generated in unsealed/"

# Seal the secrets
echo ""
echo "3. Sealing secrets with kubeseal..."

mkdir -p sealed

kubeseal --context="${CONTEXT}" \
  --controller-namespace="${SEALED_SECRETS_NAMESPACE}" \
  --format=yaml \
  < unsealed/pulumi-secrets.unsealed.yaml \
  > sealed/pulumi-secrets.yaml

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
