# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo combining a Next.js web application with Kubernetes infrastructure-as-code. It uses Moon as the task runner and Bun as the package manager. Infrastructure is deployed via GitOps (ArgoCD) with automated Pulumi stack execution via the Pulumi Kubernetes Operator.

## Commands

### Application Development
```bash
moon run :dev          # Start dev server for all projects
moon run :build        # Build all projects
moon run :lint         # Lint with Biome
moon run :type-check   # TypeScript type checking
```

### Infrastructure (Pulumi)
```bash
moon run pulumi:preview   # Preview infrastructure changes
moon run pulumi:up        # Deploy infrastructure
moon run pulumi:destroy   # Tear down infrastructure
```

### Pulumi Bootstrap (AWS Backend)
```bash
moon run pulumi-bootstrap:preview  # Preview AWS backend resources
moon run pulumi-bootstrap:up       # Deploy KMS, S3 bucket, IAM user, Secrets Manager
```

The bootstrap stack uses local state and provisions:
- KMS key for S3 encryption and Secrets Manager
- S3 bucket (`moonrepo-pulumi-state-{account-id}`) with versioning
- IAM user (`pulumi-deployer`) with access key for CI/CD
- AWS Secrets Manager secrets for Pulumi and Cloudflare tokens

After bootstrap, migrate main stack to S3 backend:
```bash
cd infra/pulumi
pulumi login s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2
```

### Secrets Management

Secrets are managed using AWS Secrets Manager (source of truth) and synced to Kubernetes via SealedSecrets:

```bash
cd infra/secrets

# Update secret in AWS Secrets Manager (encrypted with KMS)
./set-secret.sh pulumi-access-token "pul-xxxxx"
./set-secret.sh cloudflare-api-token-pulumi "your-cloudflare-token"

# Fetch from AWS and generate SealedSecrets
./sync-secrets.sh

# Commit sealed secrets to git (safe to commit)
git add sealed/
git commit -m "update sealed secrets"
```

**Key Principle:** AWS Secrets Manager is the source of truth. Unsealed secrets are gitignored. Only SealedSecrets are committed.

See [infra/secrets/README.md](infra/secrets/README.md) for complete documentation.

### Local Kubernetes Cluster
```bash
bash run.sh            # Create K3d cluster and deploy all apps via Helm
```

The `run.sh` script:
- Creates a K3d cluster named `moonrepo-dev` using `k3d-config.yaml`
- Parses ArgoCD Application manifests in `infra/app-of-apps/`
- Installs Helm charts directly (bypassing ArgoCD for local dev)
- Supports `moonrepo.dev/skip-local: "true"` annotation to skip resources locally

### Tool Versions
Managed via proto in `.prototools`: Moon 1.41.7, K3d 5.8.3, K9s 0.50.16, ArgoCD CLI 3.2.3, yq 4.49.2

## Architecture

```
apps/app/                     Next.js 16 application (tagged 'next' for Moon task inheritance)
infra/
├── pulumi/                   Pulumi IaC for Cloudflare DNS and K8s secrets
├── pulumi-bootstrap/         AWS backend setup (KMS, S3, IAM, Secrets Manager)
├── app-of-apps/              ArgoCD Application manifests (Helm-based deployments)
│   ├── bootstrap/            Bootstrap apps (sealed-secrets-bootstrap)
│   ├── operators/            Operators (cert-manager, pulumi-operator, argo-rollouts)
│   ├── istio/               Service mesh components (gateway with wildcard cert)
│   ├── home-assistant/      Home automation stack
│   └── ...                  Other applications
├── secrets/                  Secrets management (AWS → SealedSecrets)
│   ├── set-secret.sh        Update secrets in AWS
│   ├── sync-secrets.sh      Fetch from AWS and seal
│   └── sealed/              Sealed secrets (committed to git)
└── manifests/               Raw Kubernetes manifests
.moon/                        Moon workspace config
```

### Moon Configuration
- `workspace.yml`: Projects in `apps/*`, `packages/*`, `infra/pulumi`, `infra/pulumi-bootstrap`
- `toolchain.yml`: Bun package manager, TypeScript project references synced
- Tasks for Next.js apps inherited from moonrepo/moon-configs via tag

### Infrastructure Services

Deployed via Helm through ArgoCD Application manifests with sync-wave ordering:

**Bootstrap (sync-wave -2 to -1):**
- Pulumi Kubernetes Operator (automated Pulumi stack deployment in-cluster)
- Sealed Secrets controller (decrypts SealedSecrets to K8s Secrets)

**Operators (sync-wave 0):**
- Cert-manager with Cloudflare DNS-01 (wildcard TLS certificates)
  - Gateway-shim controller enabled for automatic cert generation from Gateway resources
  - Feature gate: `ExperimentalGatewayAPISupport=true`
- Argo Rollouts (progressive delivery, canary deployments)
- CloudNative-PG (PostgreSQL operator)
- External DNS (automatic DNS record creation from HTTPRoutes)

**Service Mesh (sync-wave 1):**
- Istio (base, CNI, istiod, gateway, ztunnel)

**Applications (sync-wave 2+):**
- Home Assistant with Mosquitto MQTT, Zigbee2MQTT
- Authentik (SSO)
- Nextcloud

### Network Architecture

**Gateway API (Istio):**
- Single Gateway with two HTTPS listeners:
  - `home.brandwhisper.cloud` - Home Assistant base domain
  - `*.home.brandwhisper.cloud` - Wildcard for all other services
- Wildcard TLS certificate auto-generated by cert-manager's gateway-shim controller
- HTTPRoutes for service routing:
  - `home.brandwhisper.cloud` → home-assistant:8123
  - `rollouts.home.brandwhisper.cloud` → argo-rollouts-dashboard:3100

**Cert-Manager:**
- Let's Encrypt production certificates with DNS-01 challenge
- Cloudflare DNS integration via API token
- Gateway-shim controller watches Gateway resources and auto-creates certificates
- Wildcard certificate: `*.home.brandwhisper.cloud` + `home.brandwhisper.cloud`

### Secrets Flow

```
AWS Secrets Manager (KMS encrypted, source of truth)
    ↓ (sync-secrets.sh fetches)
Local unsealed K8s Secrets (gitignored)
    ↓ (kubeseal encrypts)
SealedSecrets (committed to git, safe to commit)
    ↓ (ArgoCD syncs)
Sealed-secrets controller decrypts
    ↓
K8s Secrets in cluster (pulumi-operator-system namespace)
    ↓
Pulumi Operator uses secrets to authenticate
    ↓
Pulumi stack creates restricted Cloudflare tokens
    ↓
Tokens stored in cert-manager and external-dns namespaces
    ↓
Cert-manager uses tokens for DNS-01 challenges
```

**Token Hierarchy:**
1. **Cloudflare Master Token** (AWS Secrets Manager) - High privileges, used by Pulumi
2. **Cloudflare DNS Token** (Created by Pulumi) - Restricted to DNS only, used by cert-manager
3. **K8s Secrets** (Created by Pulumi) - Injected into cert-manager and external-dns namespaces

### Pulumi Operator

The Pulumi Kubernetes Operator runs Pulumi stacks in-cluster:
- Watches `Stack` CRD in `infra/app-of-apps/pulumi/stack.yaml`
- Automatically runs `pulumi up` on git push to master
- Uses secrets from `pulumi-operator-system` namespace
- Pulumi code adapted to detect in-cluster execution:
  ```typescript
  const k8sProvider = new k8s.Provider("prod",
    process.env.KUBERNETES_SERVICE_HOST
      ? {} // Running in-cluster
      : { context: "prod" } // Running locally
  );
  ```

### Kubernetes Setup
- Local: K3d with K3s v1.32.10 (single server, no agents)
- Production: K3s with RKE2 (see `install.sh`)
- Gateway API CRDs installed on cluster creation

## Adding New Services

To add a new service accessible at `myservice.home.brandwhisper.cloud`:

1. **Create HTTPRoute manifest:**
   ```yaml
   apiVersion: gateway.networking.k8s.io/v1
   kind: HTTPRoute
   metadata:
     name: myservice
     namespace: my-namespace
   spec:
     parentRefs:
     - name: gateway
       namespace: istio-system
     hostnames:
     - "myservice.home.brandwhisper.cloud"
     rules:
     - backendRefs:
       - name: myservice
         port: 8080
   ```

2. **Add ArgoCD Application:**
   ```yaml
   apiVersion: argoproj.io/v1alpha1
   kind: Application
   metadata:
     name: myservice
     namespace: argocd
   spec:
     source:
       repoURL: https://charts.example.com
       chart: myservice
       targetRevision: 1.0.0
     destination:
       server: https://kubernetes.default.svc
       namespace: my-namespace
     syncPolicy:
       automated:
         prune: true
         selfHeal: true
   ```

3. **Test locally:** `bash run.sh`

4. **Commit and push:** ArgoCD auto-deploys, cert-manager auto-generates certificate

**Note:** The wildcard certificate `*.home.brandwhisper.cloud` covers all subdomains automatically. No manual certificate creation needed.

## Updating Secrets

When rotating tokens or updating secrets:

```bash
cd infra/secrets

# Update secret value in AWS
./set-secret.sh cloudflare-api-token-pulumi "new-token-value"

# Fetch from AWS and regenerate SealedSecrets
./sync-secrets.sh

# Commit updated sealed secrets
git add sealed/
git commit -m "rotate cloudflare token"
git push
```

ArgoCD automatically syncs the new sealed secrets to the cluster. The sealed-secrets controller decrypts them to K8s Secrets.

## Troubleshooting

### Cert-Manager Issues

**Certificate not issued:**
```bash
# Check cert-manager logs
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager

# Verify gateway-shim controller is enabled
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager | grep "gateway-shim"

# Check certificate status
kubectl describe certificate home-tls -n istio-system
```

**Gateway-shim disabled:**
- Ensure `featureGates: "ExperimentalGatewayAPISupport=true"` in cert-manager values
- Restart cert-manager: `kubectl rollout restart deployment/cert-manager -n cert-manager`

### Secrets Issues

**"Failed to fetch secret from AWS":**
```bash
# Check AWS credentials
aws secretsmanager list-secrets

# Verify secret exists
aws secretsmanager describe-secret --secret-id moonrepo/pulumi-access-token
```

**"Failed to seal secret":**
```bash
# Check sealed-secrets controller
kubectl get pods -n sealed-secrets

# Fetch controller certificate
kubeseal --fetch-cert --context=prod
```

### Pulumi Operator Issues

**Stack not running:**
```bash
# Check operator logs
kubectl logs -n pulumi-operator-system -l app.kubernetes.io/name=pulumi-kubernetes-operator

# Check Stack status
kubectl get stack -n pulumi-operator-system moonrepo-cloudflare-prod

# Describe Stack for details
kubectl describe stack -n pulumi-operator-system moonrepo-cloudflare-prod
```

**Secrets missing:**
```bash
# Verify secrets exist
kubectl get secrets -n pulumi-operator-system

# Check sealed secrets are deployed
kubectl get sealedsecrets -n pulumi-operator-system
```

## Important Notes

### Git Workflow
- Commit changes to master branch
- ArgoCD watches git repository and auto-syncs to cluster
- Pulumi operator watches Stack CRD and auto-runs `pulumi up` on changes
- Use sync-waves to control deployment order

### Security
- Never commit plaintext secrets (they're gitignored)
- AWS Secrets Manager is the source of truth for sensitive values
- SealedSecrets can only be decrypted by the cluster's sealed-secrets controller
- Backup the sealed-secrets controller's private key (critical for disaster recovery)
- KMS key encrypts both S3 state and Secrets Manager secrets

### Local vs Production
- Local: Uses `bash run.sh` with direct Helm installs (no ArgoCD)
- Production: Uses ArgoCD for GitOps deployment
- Use `moonrepo.dev/skip-local: "true"` annotation for production-only resources
- Pulumi code auto-detects in-cluster vs local execution

### Network
- Gateway API is the routing layer (Istio implementation)
- External-DNS auto-creates Cloudflare DNS records from HTTPRoutes
- Cert-manager gateway-shim auto-creates certificates from Gateway listeners
- Single wildcard certificate covers all `*.home.brandwhisper.cloud` subdomains
