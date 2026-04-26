#!/bin/bash
# bootstrap-rke2-config.sh — Initial setup of GitOps-managed RKE2 config on NUC
#
# Run this ONCE after the NUC is powered on and the cluster is accessible.
# It:
#   1. Creates the rke2-config ConfigMap from the current config
#   2. Sets up the WAN IP monitor to auto-update Cloudflare + ConfigMap
#   3. Restarts RKE2 to ensure config is in effect
#
# Usage: ./bootstrap-rke2-config.sh

set -euo pipefail

echo "=== RKE2 Config GitOps Bootstrap ==="
echo ""

# Check kubectl access
if ! kubectl get nodes > /dev/null 2>&1; then
  echo "ERROR: kubectl cannot reach the cluster. Is the NUC online and k8s running?"
  exit 1
fi

echo "✓ Cluster reachable"

# Create the rke2-config ConfigMap from the local manifest
echo "Creating rke2-config ConfigMap..."
kubectl apply -f infra/manifests/rke2-config/configmap.yaml

# Deploy the WAN IP monitor updates (Cloudflare + ConfigMap auto-update)
echo "Updating WAN IP monitor CronJob..."
kubectl apply -k infra/manifests/wan-ip-monitor/

# Seal and deploy the Cloudflare token secret
echo ""
echo "NOTE: Cloudflare token secret needs to be sealed and applied:"
echo "  cd infra/manifests/cloudflare-token"
echo "  # Edit secret.yaml with your token from the passwords sheet"
echo "  kubectl create secret generic cloudflare-token \\"
echo "    --namespace=newrelic \\"
echo "    --from-literal=apiToken='YOUR_TOKEN' \\"
echo "    --dry-run=client -o yaml \\"
echo "  | kubeseal --controller-namespace sealed-secrets --format yaml \\"
echo "    > secret-sealed.yaml"
echo "  kubectl apply -f secret-sealed.yaml"
echo ""

# Apply the rke2-config Application (ArgoCD will sync the ConfigMap)
echo "Creating ArgoCD Application for rke2-config..."
kubectl apply -f infra/app-of-apps/rke2-config/application.yaml

# Run the apply script to sync config to host filesystem
echo ""
echo "Running apply-rke2-config.sh on NUC..."
./infra/manifests/rke2-config/apply-rke2-config.sh --restart

echo ""
echo "=== Bootstrap complete ==="
echo ""
echo "Verify:"
echo "  kubectl get configmap rke2-config -o yaml"
echo "  kubectl get pods -A | grep rke2"
echo "  dig +short home.brandwhisper.cloud  # should return current WAN IP"
