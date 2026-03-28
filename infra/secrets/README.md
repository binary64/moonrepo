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
    ↓
Pulumi Operator uses secrets
    ↓
Pulumi stack accesses S3 backend (via AWS creds)
Pulumi creates Cloudflare tokens for cert-manager
```

## Directory Structure

```
infra/secrets/
├── README.md                           # This file
├── set-secret.sh                       # Update Cloudflare token in AWS
├── sync-secrets.sh                     # Fetch from AWS + seal
├── .gitignore                          # Ignore unsealed secrets
├── unsealed/                           # Local unsealed secrets (gitignored)
│   └── *.unsealed.yaml
└── sealed/                             # Sealed secrets (committed to git)
    └── pulumi-secrets.yaml             # Pulumi operator credentials
```

## Prerequisites

1. AWS credentials configured with access to Secrets Manager
2. `aws` CLI installed
3. `jq` installed (for parsing JSON)
4. `kubeseal` CLI installed
5. `kubectl` configured with prod cluster context
6. Secrets created in AWS (via pulumi-bootstrap)

## Workflow

### Initial Setup

1. Deploy the pulumi-bootstrap stack to create AWS resources:
   ```bash
   cd infra/pulumi-bootstrap
   pulumi up
   ```

   This creates:
   - KMS key for encryption
   - S3 bucket for Pulumi state
   - IAM user with access keys (stored in AWS Secrets Manager automatically)
   - AWS Secrets Manager secret for Cloudflare token (empty, you'll populate next)

2. Set your Cloudflare API token in AWS Secrets Manager:
   ```bash
   cd infra/secrets
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

### Updating the Cloudflare Token

When you need to rotate the Cloudflare API token:

1. Update the value in AWS Secrets Manager:
   ```bash
   ./set-secret.sh cloudflare-api-token-pulumi "new-cloudflare-token"
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

4. ArgoCD automatically syncs the new sealed secrets to the cluster

## Secrets Reference

### ptt-server-secret

- **Purpose**: Credentials for the PTT (push-to-talk) server pod
- **Namespace**: `ptt-server`
- **Keys**:
  - `ha-token` — Home Assistant long-lived access token for device control
  - `openai-api-key` — OpenAI API key for speech-to-text transcription
  - `gateway-token` — OpenClaw Gateway auth token (LAN-only, `ws://192.168.1.201:18789`)
  - `ptt-api-token` — Bearer token for authenticating inbound requests to the PTT server HTTP API (used by watch/phone clients to submit PTT audio)
- **Sealed secret file**: `infra/manifests/ptt-server/ptt-server-secret.yaml`
- **Used by**: `infra/manifests/ptt-server/deployment.yaml`

To seal a new token:

```bash
kubectl create secret generic ptt-server-secret \
  --namespace ptt-server \
  --from-literal=ha-token="<token>" \
  --from-literal=openai-api-key="<key>" \
  --from-literal=gateway-token="<token>" \
  --from-literal=ptt-api-token="<token>" \
  --dry-run=client -o yaml \
| kubeseal --context prod --controller-namespace sealed-secrets --format yaml \
> infra/manifests/ptt-server/ptt-server-secret.yaml
```

### gha-runner-secret

- **Purpose**: GitHub PAT for the self-hosted GHA runner to authenticate with GitHub and register as a runner for `binary64/ocdesktop`
- **Namespace**: `gha-runner`
- **Key**: `access-token`
- **Required scopes**: `repo` (full repo access for runner registration)
- **Sealed secret file**: `infra/manifests/gha-runner/gha-runner-secret-sealed.yaml` (co-located with its manifest; kustomize v5 requires resources to be within the kustomization directory)
- **Used by**: `infra/manifests/gha-runner/kustomization.yaml`

To seal a new/rotated token:

```bash
# Read PAT securely (not in shell history) and write to a restrictive temp file
read -rs GH_PAT
umask 077
PAT_FILE="$(mktemp /tmp/gha-pat.XXXXXX)"
chmod 600 "$PAT_FILE"  # Explicit 600: readable only by current user
trap 'rm -f "$PAT_FILE"; unset GH_PAT' EXIT
printf '%s' "$GH_PAT" > "$PAT_FILE"

kubectl create secret generic gha-runner-secret \
  --namespace gha-runner \
  --from-file=access-token="$PAT_FILE" \
  --dry-run=client -o yaml \
| kubeseal --context prod --controller-namespace sealed-secrets --format yaml \
> infra/manifests/gha-runner/gha-runner-secret-sealed.yaml

rm -f "$PAT_FILE"
unset GH_PAT
git add infra/manifests/gha-runner/gha-runner-secret-sealed.yaml
git commit -m "seal gha-runner secret"
git push
```

### cloudflare-api-token-pulumi
- **Purpose**: High-privilege token for Pulumi to CREATE restricted tokens for cert-manager
- **Get from**: https://dash.cloudflare.com/profile/api-tokens
- **Permissions needed**:
  - Account.Account Settings:Read
  - Zone.Zone:Read
  - User.API Tokens:Edit
- **Namespace**: `pulumi-operator-system`
- **Key**: `token`
- **Set via**: `./set-secret.sh cloudflare-api-token-pulumi "your-token"`

### pulumi-aws-credentials
- **Purpose**: AWS credentials for Pulumi operator to access S3 state backend
- **Source**: Auto-generated from IAM user created by pulumi-bootstrap
- **Namespace**: `pulumi-operator-system`
- **Keys**: `access-key-id`, `secret-access-key`
- **Set via**: Automatically populated by pulumi-bootstrap (no manual action needed)

## How It Works

### S3 Backend (No Pulumi Cloud)

Unlike typical Pulumi setups, we use **S3 as the backend** instead of Pulumi Cloud:

1. **pulumi-bootstrap** creates:
   - S3 bucket: `moonrepo-pulumi-state-{account-id}`
   - IAM user: `pulumi-deployer` with S3 access
   - Access keys stored in AWS Secrets Manager

2. **Pulumi operator** configured to use S3:
   ```yaml
   spec:
     backend: s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2
     envRefs:
       AWS_ACCESS_KEY_ID: ...    # From sealed secret
       AWS_SECRET_ACCESS_KEY: ...  # From sealed secret
   ```

3. **No Pulumi access token needed** - State managed in your own S3 bucket

### Token Hierarchy

1. **Cloudflare Master Token** (AWS Secrets Manager)
   - High privileges
   - Used BY Pulumi to create other tokens
   - Stored manually via `set-secret.sh`

2. **AWS IAM Access Keys** (AWS Secrets Manager)
   - Created automatically by pulumi-bootstrap
   - Used BY Pulumi operator to access S3 backend
   - Synced automatically via `sync-secrets.sh`

3. **Cloudflare DNS Token** (Created by Pulumi)
   - Restricted to DNS only
   - Created BY Pulumi stack
   - Injected into cert-manager namespace
   - Used BY cert-manager for DNS-01 challenges

## Security Notes

- ✅ Unsealed secrets are gitignored and never committed
- ✅ Secrets stored in AWS Secrets Manager (encrypted with KMS)
- ✅ Only sealed secrets are committed to git
- ✅ SealedSecrets can only be decrypted by the cluster's sealed-secrets controller
- ✅ AWS credentials required to read secrets from Secrets Manager
- ✅ No Pulumi Cloud dependency - state managed in your own S3 bucket
- ⚠️ Keep the sealed-secrets controller's private key backed up!
- ⚠️ Keep AWS credentials for Secrets Manager access secure

## Troubleshooting

### "Secret does not exist" error
Run `cd infra/pulumi-bootstrap && pulumi up` to create the AWS secrets first.

### "Failed to fetch secret from AWS"
Check your AWS credentials: `aws secretsmanager list-secrets`

### "Error from server: no endpoints available for service"
The sealed-secrets controller may not be running. Check: `kubectl get pods -n sealed-secrets`

### "Failed to seal secret"
Ensure you have the correct kubectl context: `kubectl config current-context`

### Pulumi operator can't access S3
Check that:
1. AWS credentials secret exists: `kubectl get secret pulumi-aws-credentials -n pulumi-operator-system`
2. S3 bucket exists: `aws s3 ls | grep moonrepo-pulumi-state`
3. IAM user has proper permissions: Check pulumi-bootstrap outputs
