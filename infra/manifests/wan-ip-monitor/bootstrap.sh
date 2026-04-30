#!/bin/bash
# wan-ip-bootstrap.sh — Run once after NUC boots to patch all WAN IP resources
#
# This manually triggers the WAN IP update logic to patch:
#   - rke2-config ConfigMap
#   - Istio Gateway address
#   - external-dns home-network secret
#
# Usage: ./wan-ip-bootstrap.sh
#
# Runs the check-wan-ip.sh script from the ConfigMap directly, bypassing
# the CronJob schedule. Use this after power-on before waiting 5 minutes.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== WAN IP Bootstrap ==="
echo "Manually triggering WAN IP update to patch all resources..."
echo ""

# Run the script directly from the ConfigMap (same logic as CronJob)
kubectl -n newrelic create configmap wan-ip-monitor-temp \
  --from-file=check-wan-ip.sh="${SCRIPT_DIR}/configmap.yaml" \
  -o yaml --dry-run=client | kubectl apply -f -

# Execute the script in a one-shot pod to patch resources
kubectl run wan-ip-bootstrap \
  --image=curlimages/curl:8.18.0 \
  --restart=Never \
  --namespace=newrelic \
  --serviceaccount=wan-ip-monitor \
  --overrides='
{
  "spec": {
    "containers": [
      {
        "name": "wan-ip-monitor",
        "image": "curlimages/curl:8.18.0",
        "command": ["/bin/sh", "/scripts/check-wan-ip.sh"],
        "env": [
          {"name": "NR_LICENSE_KEY", "valueFrom": {"secretKeyRef": {"name": "newrelic-secret", "key": "licenseKey"}}},
          {"name": "NR_ACCOUNT_ID", "valueFrom": {"configMapKeyRef": {"name": "wan-ip-monitor-config", "key": "NR_ACCOUNT_ID"}}},
          {"name": "CLOUDFLARE_API_TOKEN", "valueFrom": {"secretKeyRef": {"name": "cloudflare-token", "key": "apiToken"}}},
          {"name": "CLOUDFLARE_ZONE_ID", "value": "ecb09a98b97ba002587403424405610f"}
        ],
        "volumeMounts": [
          {"name": "scripts", "mountPath": "/scripts"}
        ]
      }
    ],
    "volumes": [
      {
        "name": "scripts",
        "configMap": {"name": "wan-ip-monitor-script", "defaultMode": 755}
      }
    ]
  }
}' \
  --wait=true \
  --timeout=60s

echo ""
echo "Bootstrap complete. Cleaning up pod..."
kubectl delete pod wan-ip-bootstrap -n newrelic --ignore-not-found=true

echo ""
echo "Verify patches:"
echo "  kubectl get configmap rke2-config -o jsonpath='{.data.config\\.yaml}' | grep advertise-address"
echo "  kubectl get gateway gateway -n istio-system -o jsonpath='{.spec.addresses[0].value}'"
echo "  kubectl get secret home-network -n external-dns -o jsonpath='{.data.public-ip}' | base64 -d"
