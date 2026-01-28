# Secrets Management

This directory manages secrets using AWS Secrets Manager (encrypted with KMS) as the source of truth, and SealedSecrets for GitOps deployment.

## Architecture

```
AWS Secrets Manager (KMS encrypted)
    ↓ (fetch via sync-secrets.sh)
Local unsealed K8s Secrets (gitignored)
    ↓ (seal via kubeseal)
SealedSecrets (committed to git)
    ↓ (ArgoCD syncs)
K8s Secrets in cluster
```

## Directory Structure

```
infra/secrets/
├── README.md                           # This file
├── set-secret.sh                       # Update secrets in AWS
├── sync-secrets.sh                     # Fetch from AWS + seal
├── .gitignore                          # Ignore unsealed secrets
├── unsealed/                           # Local unsealed secrets (gitignored)
│   └── *.unsealed.yaml
└── sealed/                             # Sealed secrets (committed to git)
    └── pulumi-secrets.yaml
```

## Prerequisites

1. AWS credentials configured with access to Secrets Manager
2. `aws` CLI installed
3. `kubeseal` CLI installed
4. `kubectl` configured with prod cluster context
5. Secrets created in AWS (via pulumi-bootstrap)

## Workflow

### Initial Setup

1. Deploy the pulumi-bootstrap stack to create AWS resources:
   ```bash
   cd infra/pulumi-bootstrap
   pulumi up
   ```

2. Set your secret values in AWS Secrets Manager:
   ```bash
   cd infra/secrets
   ./set-secret.sh pulumi-access-token "pul-xxxxx"
   ./set-secret.sh cloudflare-api-token-pulumi "your-cloudflare-token"
   ```

3. Sync secrets to cluster:
   ```bash
   ./sync-secrets.sh
   ```

4. Commit sealed secrets:
   ```bash
   git add sealed/
   git commit -m "add sealed secrets"
   git push
   ```

### Updating a Secret

When you need to rotate or update a secret:

1. Update the value in AWS Secrets Manager:
   ```bash
   ./set-secret.sh cloudflare-api-token-pulumi "new-token-value"
   ```

2. Sync to generate new SealedSecrets:
   ```bash
   ./sync-secrets.sh
   ```

3. Commit and push:
   ```bash
   git add sealed/
   git commit -m "rotate cloudflare token"
   git push
   ```

4. ArgoCD will automatically sync the new sealed secrets to the cluster

## Secrets Reference

### pulumi-access-token
- **Purpose**: Authentication for Pulumi operator to manage state
- **Get from**: https://app.pulumi.com/account/tokens
- **Namespace**: `pulumi-operator-system`
- **Key**: `accessToken`

### cloudflare-api-token-pulumi
- **Purpose**: High-privilege token for Pulumi to CREATE restricted tokens
- **Get from**: https://dash.cloudflare.com/profile/api-tokens
- **Permissions needed**:
  - Account.Account Settings:Read
  - Zone.Zone:Read
  - User.API Tokens:Edit
- **Namespace**: `pulumi-operator-system`
- **Key**: `token`

## Security Notes

- ✅ Unsealed secrets are gitignored and never committed
- ✅ Secrets stored in AWS Secrets Manager (encrypted with KMS)
- ✅ Only sealed secrets are committed to git
- ✅ SealedSecrets can only be decrypted by the cluster's sealed-secrets controller
- ✅ AWS credentials required to read secrets from Secrets Manager
- ⚠️ Keep the sealed-secrets controller's private key backed up!

## Troubleshooting

### "Secret does not exist" error
Run `cd infra/pulumi-bootstrap && pulumi up` to create the AWS secrets first.

### "Failed to fetch secret from AWS"
Check your AWS credentials: `aws secretsmanager list-secrets`

### "Error from server: no endpoints available for service"
The sealed-secrets controller may not be running. Check: `kubectl get pods -n sealed-secrets`

### "Failed to seal secret"
Ensure you have the correct kubectl context: `kubectl config current-context`
