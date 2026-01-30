# Pulumi Stack - Cloudflare DNS & Kubernetes Secrets

This Pulumi stack manages Cloudflare API tokens and injects them as Kubernetes secrets for cert-manager and external-dns.

## Purpose

This stack implements the principle of least privilege by:
1. Creating restricted Cloudflare API tokens (DNS-only permissions)
2. Injecting these tokens into Kubernetes secrets
3. Allowing cert-manager to issue TLS certificates via DNS-01 challenges
4. Allowing external-dns to manage DNS records

## What It Creates

### Cloudflare Resources

- **API Token** (`cert-manager-dns-token`)
  - **Permissions**:
    - Zone DNS Write (ID: `4755a26eedb94da69e1066d98aa820be`)
    - Zone Read (ID: `c8fed203ed3043cba015a93ad1616f1f`)
  - **Scope**: Restricted to `brandwhisper.cloud` zone only
  - **Purpose**: Used by cert-manager for DNS-01 challenges and by external-dns for record management

### Kubernetes Resources

- **Secret** (`cloudflare-api-token` in `cert-manager` namespace)
  - Contains the API token for DNS-01 challenges
  - Used by cert-manager ClusterIssuer

- **Secret** (`cloudflare-api-token` in `external-dns` namespace)
  - Contains the API token for DNS record management
  - Used by external-dns controller

## Architecture

### Token Hierarchy

```
Cloudflare Master Token (AWS Secrets Manager)
    ↓ (Used by Pulumi to authenticate)
Pulumi creates restricted token
    ↓
Cloudflare DNS Token (created by this stack)
    ↓ (Injected into K8s)
Kubernetes Secrets
    ├─→ cert-manager namespace (DNS-01 challenges)
    └─→ external-dns namespace (DNS record management)
```

### In-Cluster vs Local Execution

The stack automatically detects where it's running:

```typescript
const k8sProvider = new k8s.Provider("prod",
  process.env.KUBERNETES_SERVICE_HOST
    ? {} // Running in-cluster (via Pulumi operator)
    : { context: "prod" } // Running locally
);
```

**In-Cluster (Production)**:
- Pulumi operator runs the stack inside the cluster
- Uses in-cluster Kubernetes service account
- Triggered automatically on git push

**Local Development**:
- Use `moon run pulumi:preview` or `moon run pulumi:up`
- Requires `prod` kubectl context configured
- Useful for testing changes before committing

## State Backend

This stack uses **AWS S3** as the state backend (not Pulumi Cloud):

```
Backend: s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2
```

The S3 bucket and KMS encryption key are created by the `pulumi-bootstrap` stack.

### Initial Setup

After deploying `pulumi-bootstrap`, migrate to S3 backend:

```bash
cd infra/pulumi
pulumi login s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2
```

Replace `{account-id}` with your AWS account ID.

## Prerequisites

### AWS Secrets Manager

The Pulumi operator requires these secrets in the `pulumi-operator-system` namespace:

1. **cloudflare-api-token-pulumi** (Cloudflare master token)
   - High-privilege token for creating other tokens
   - Set via: `cd infra/secrets && ./set-secret.sh cloudflare-api-token-pulumi "your-token"`

2. **pulumi-aws-credentials** (AWS credentials for S3 backend access)
   - Auto-created by `pulumi-bootstrap` stack
   - Contains IAM user access keys

These are synced from AWS Secrets Manager to Kubernetes via the secrets management workflow.

### Cloudflare Token Permissions

The master token in AWS Secrets Manager must have:
- **Account.Account Settings:Read**
- **Zone.Zone:Read**
- **User.API Tokens:Edit** (to create new tokens)

Get a token from: https://dash.cloudflare.com/profile/api-tokens

## Usage

### Local Development

Preview changes:
```bash
moon run pulumi:preview
```

Apply changes:
```bash
moon run pulumi:up
```

Destroy resources:
```bash
moon run pulumi:destroy
```

### Production (Automated)

The Pulumi operator automatically runs this stack when changes are committed:

1. Commit changes to `infra/pulumi/`
2. Push to master branch
3. ArgoCD syncs Stack CRD in `infra/app-of-apps/pulumi/`
4. Pulumi operator detects change
5. Operator runs `pulumi up` in-cluster
6. Resources are created/updated

Check stack status:
```bash
kubectl get stack -n pulumi-operator-system moonrepo-cloudflare-prod
kubectl describe stack -n pulumi-operator-system moonrepo-cloudflare-prod
```

View operator logs:
```bash
kubectl logs -n pulumi-operator-system -l app.kubernetes.io/name=pulumi-kubernetes-operator
```

## Files

```
infra/pulumi/
├── index.ts              # Main Pulumi program
├── Pulumi.yaml          # Project configuration
├── Pulumi.prod.yaml     # Stack configuration (prod)
├── package.json         # Node.js dependencies
├── moon.yml             # Moon task configuration
├── tsconfig.json        # TypeScript configuration
└── secrets-template.yaml # Template for manual secret creation (deprecated)
```

### Key Files

- **index.ts**: Main logic for creating Cloudflare tokens and K8s secrets
- **Pulumi.yaml**: Defines project name and runtime (Node.js with Bun)
- **Pulumi.prod.yaml**: Stack-specific configuration for production

## Configuration

The stack uses sensible defaults with minimal configuration:

```yaml
# Pulumi.prod.yaml
config:
  # No configuration needed - all values are defaults or auto-discovered
```

Domain is hardcoded to `brandwhisper.cloud` in index.ts:
```typescript
const domain = "brandwhisper.cloud";
```

## Outputs

The stack exports these values:

```typescript
export const zoneId = zone.zoneId;      // Cloudflare zone ID
export const tokenId = certManagerToken.id;  // Created token ID
```

View outputs:
```bash
pulumi stack output
```

## How It Works

1. **Authenticate with Cloudflare**
   - Uses master token from AWS Secrets Manager (provided by sealed secrets)
   - Pulumi provider configured via environment variables

2. **Look up Zone**
   - Retrieves zone ID for `brandwhisper.cloud`
   - Used to scope the token permissions

3. **Create Restricted Token**
   - Creates token with DNS-only permissions
   - Scoped to specific zone
   - Includes both Write and Read permissions (required for DNS-01)

4. **Inject into Kubernetes**
   - Creates secret in `cert-manager` namespace
   - Creates secret in `external-dns` namespace
   - Both use the same token value

5. **Cert-Manager Uses Token**
   - ClusterIssuer references the secret
   - DNS-01 solver uses token to create TXT records
   - Let's Encrypt validates domain ownership
   - Certificate is issued

## Security Considerations

### Token Scoping

The created token has minimal permissions:
- ✅ Can only edit DNS records
- ✅ Can only access the `brandwhisper.cloud` zone
- ✅ Cannot access account settings or other zones
- ✅ Can be revoked independently of the master token

### Secret Management

- Master token stored in AWS Secrets Manager (KMS encrypted)
- Master token synced to K8s as SealedSecret (cluster-specific encryption)
- Created token stored in K8s secrets (automatically rotated when stack updates)
- No tokens in git or local files

### Token Rotation

To rotate the Cloudflare master token:

```bash
cd infra/secrets
./set-secret.sh cloudflare-api-token-pulumi "new-token"
./sync-secrets.sh
git add sealed/
git commit -m "rotate cloudflare token"
git push
```

The Pulumi operator will automatically:
1. Detect the new sealed secret
2. Use the new master token
3. Recreate the DNS token
4. Update the K8s secrets

## Troubleshooting

### Stack Not Running

Check if the Pulumi operator is running:
```bash
kubectl get pods -n pulumi-operator-system
```

Check Stack status:
```bash
kubectl describe stack -n pulumi-operator-system moonrepo-cloudflare-prod
```

### Authentication Errors

Verify secrets exist:
```bash
kubectl get secret cloudflare-api-token-pulumi -n pulumi-operator-system
kubectl get secret pulumi-aws-credentials -n pulumi-operator-system
```

Check if sealed-secrets controller is running:
```bash
kubectl get pods -n sealed-secrets
```

### Token Permissions Insufficient

If cert-manager fails DNS-01 challenges:
1. Verify the master token has correct permissions in Cloudflare dashboard
2. Check cert-manager logs: `kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager`
3. Verify the created token has both Zone DNS Write and Zone Read permissions

### State Backend Issues

If Pulumi can't access S3 state:
```bash
# Check AWS credentials secret
kubectl get secret pulumi-aws-credentials -n pulumi-operator-system -o yaml

# Verify S3 bucket exists
aws s3 ls | grep moonrepo-pulumi-state

# Check IAM user permissions
aws iam get-user --user-name pulumi-deployer
```

## Related Documentation

- [Pulumi Bootstrap](../pulumi-bootstrap/README.md) - AWS backend setup
- [Secrets Management](../secrets/README.md) - How to update the master token
- [App-of-Apps](../app-of-apps/README.md) - How the stack is deployed via ArgoCD
- [Infrastructure Overview](../README.md) - Overall infrastructure architecture
