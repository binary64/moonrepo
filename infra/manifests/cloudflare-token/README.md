# Cloudflare Token Secret

This secret provides the Cloudflare API token to the WAN IP monitor, enabling
automatic DNS updates when the home public IP changes.

## Secret Details

- **Namespace:** `newrelic` (same as WAN IP monitor)
- **Type:** `SealedSecret` (bitnami.com/v1alpha1)
- **Key:** `apiToken`
- **Permissions required:** Zone:DNS:Edit on `brandwhisper.cloud`

## Setup

1. Get your Cloudflare API token from:
   - https://dash.cloudflare.com/profile/api-tokens
   - Or from the passwords sheet (Cloudflare row, "API Key" column)

2. Create the sealed secret:

   ```bash
   # From the cloudflare-token directory:
   kubectl create secret generic cloudflare-token \
     --namespace=newrelic \
     --from-literal=apiToken='YOUR_CLOUDFLARE_TOKEN' \
     --dry-run=client -o yaml \
   | kubeseal --controller-namespace sealed-secrets --format yaml \
     > secret-sealed.yaml
   ```

3. Commit and push:
   ```bash
   git add secret-sealed.yaml
   git commit -m "add cloudflare token for wan-ip-monitor"
   git push
   ```

4. ArgoCD will sync the secret automatically. Verify:
   ```bash
   kubectl get secret cloudflare-token -n newrelic -o jsonpath='{.data.apiToken}' | base64 -d
   ```

## Rotation

When rotating the Cloudflare token:

1. Update the token in Cloudflare dashboard
2. Re-run the `kubectl create secret ... | kubeseal` command above
3. Commit and push the new sealed secret
