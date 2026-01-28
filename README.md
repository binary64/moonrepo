# Moonrepo: Full-Stack Infrastructure as Code

A monorepo combining a Next.js web application with Kubernetes infrastructure-as-code, managed with Moon and Bun. Features GitOps deployment via ArgoCD, automated Pulumi infrastructure management, and AWS-backed secrets management.

## 🚀 Quick Start

### Prerequisites

Tools are managed via [proto](https://moonrepo.dev/docs/proto/overview):
```bash
# Install proto if not already installed
curl -fsSL https://moonrepo.dev/install/proto.sh | bash

# Install required tools (managed in .prototools)
proto install

# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Install kubeseal for secrets management
brew install kubeseal  # or download from releases
```

### Local Development

1. **Start local Kubernetes cluster:**
   ```bash
   bash run.sh
   ```
   This creates a K3d cluster and deploys all infrastructure services.

2. **Develop the Next.js application:**
   ```bash
   moon run :dev
   ```

3. **Build the application:**
   ```bash
   moon run :build
   ```

## 📁 Project Structure

```
├── apps/
│   └── app/                    # Next.js 16 application
├── infra/
│   ├── pulumi/                # Cloudflare DNS & K8s secrets (AWS S3 backend)
│   ├── pulumi-bootstrap/      # AWS backend setup (local state)
│   ├── app-of-apps/           # ArgoCD Application manifests (Helm charts)
│   │   ├── bootstrap/         # Bootstrap apps (sealed-secrets)
│   │   ├── operators/         # Operators (cert-manager, pulumi, argo-rollouts)
│   │   ├── istio/            # Service mesh components
│   │   └── ...               # Application-specific manifests
│   ├── secrets/              # Secrets management (AWS → SealedSecrets)
│   │   ├── set-secret.sh     # Update secrets in AWS
│   │   ├── sync-secrets.sh   # Fetch from AWS and seal
│   │   └── sealed/           # Sealed secrets (committed to git)
│   └── manifests/            # Raw Kubernetes manifests
├── .moon/                     # Moon workspace configuration
└── .prototools               # Tool version management
```

## 🛠️ Development Commands

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

Bootstrap provisions:
- KMS key for S3 and Secrets Manager encryption
- S3 bucket (`moonrepo-pulumi-state-{account-id}`) with versioning
- IAM user (`pulumi-deployer`) with access keys
- AWS Secrets Manager secrets for Pulumi and Cloudflare tokens

### Secrets Management
```bash
cd infra/secrets

# Set secrets in AWS Secrets Manager (encrypted with KMS)
./set-secret.sh pulumi-access-token "pul-xxxxx"
./set-secret.sh cloudflare-api-token-pulumi "your-token"

# Fetch from AWS and generate SealedSecrets
./sync-secrets.sh

# Commit sealed secrets to git
git add sealed/ && git commit -m "update secrets"
```

See [infra/secrets/README.md](infra/secrets/README.md) for detailed documentation.

## 🏗️ Architecture

### Secrets Management Flow

```
AWS Secrets Manager (KMS encrypted)
    ↓ (sync-secrets.sh)
Local unsealed K8s Secrets (gitignored)
    ↓ (kubeseal)
SealedSecrets (committed to git)
    ↓ (ArgoCD syncs)
K8s Secrets in cluster
    ↓
Pulumi Operator uses secrets to deploy stack
    ↓
Pulumi creates restricted Cloudflare tokens
    ↓
Cert-manager uses tokens for DNS-01 challenges
```

**Key Principle:** AWS Secrets Manager is the source of truth. Local unsealed secrets are ephemeral. Only SealedSecrets are committed to git.

### Kubernetes Services

Deployed via Helm through ArgoCD Application manifests (sync-wave ordered):

**Bootstrap (-2 to -1):**
- Pulumi Kubernetes Operator (automated stack deployment)
- Sealed Secrets (secret decryption)

**Operators (0):**
- Cert-manager with Cloudflare DNS-01 (wildcard certificates)
- Argo Rollouts (progressive delivery)
- CloudNative-PG (PostgreSQL operator)
- External DNS (automatic DNS record management)

**Service Mesh (1):**
- Istio (base, CNI, istiod, gateway, ztunnel)

**Applications (2+):**
- Home Assistant with Mosquitto MQTT, Zigbee2MQTT
- Authentik (SSO)
- Nextcloud

### Infrastructure as Code

**Pulumi (TypeScript):**
- **pulumi-bootstrap**: AWS backend setup (KMS, S3, IAM, Secrets Manager)
- **pulumi**: Cloudflare API token creation and K8s secret injection

**ArgoCD (GitOps):**
- App-of-apps pattern with sync-wave ordering
- Automatic sync from git to cluster
- Health checks and self-healing

**Pulumi Operator:**
- Runs Pulumi stacks in-cluster
- Auto-deploys on git push
- Manages Cloudflare tokens and K8s secrets

### Network Architecture

**Gateway API (Istio):**
- Single Gateway with two HTTPS listeners:
  - `home.brandwhisper.cloud` - Home Assistant
  - `*.home.brandwhisper.cloud` - Wildcard for other services
- Wildcard TLS certificate issued by cert-manager
- HTTPRoutes for service routing:
  - `home.brandwhisper.cloud` → home-assistant:8123
  - `rollouts.home.brandwhisper.cloud` → argo-rollouts-dashboard:3100

**Cert-Manager:**
- Let's Encrypt with DNS-01 challenge
- Cloudflare DNS integration
- Gateway-shim controller for automatic certificate generation from Gateway resources
- Wildcard certificate: `*.home.brandwhisper.cloud`, `home.brandwhisper.cloud`

### Moon Configuration
- **Workspace**: Monorepo management with project isolation
- **Toolchain**: Bun package manager, TypeScript project references
- **Task Inheritance**: Next.js tasks from moonrepo/moon-configs

## 🔧 Tool Versions

Managed via proto in `.prototools`:
- **Moon**: 1.41.7
- **K3d**: 5.8.3 (K3s v1.32.10)
- **K9s**: 0.50.16
- **ArgoCD CLI**: 3.2.3
- **yq**: 4.49.2
- **shfmt**: 3.12.0

## 🚢 Deployment Workflow

### Production Setup (First Time)

1. **Deploy Bootstrap Stack:**
   ```bash
   cd infra/pulumi-bootstrap
   pulumi up
   ```

2. **Set Secrets in AWS:**
   ```bash
   cd ../secrets
   ./set-secret.sh pulumi-access-token "pul-xxxxx"
   ./set-secret.sh cloudflare-api-token-pulumi "your-token"
   ```

3. **Generate and Commit SealedSecrets:**
   ```bash
   ./sync-secrets.sh
   git add sealed/ && git commit -m "add sealed secrets" && git push
   ```

4. **ArgoCD Auto-Deploys:**
   - Sealed-secrets controller decrypts secrets
   - Pulumi operator runs your Pulumi stack
   - Pulumi creates Cloudflare tokens for cert-manager
   - Cert-manager issues wildcard certificate
   - Applications start with proper TLS

### Local Development

1. Run `bash run.sh` to create K3d cluster
2. Cluster uses `k3d-config.yaml` (single server, no agents)
3. Installs Gateway API CRDs on creation
4. Parses ArgoCD manifests in `infra/app-of-apps/`
5. Installs Helm charts directly (bypasses ArgoCD for local dev)
6. Supports `moonrepo.dev/skip-local: "true"` annotation

### Updating Secrets

```bash
cd infra/secrets
./set-secret.sh cloudflare-api-token-pulumi "new-token"
./sync-secrets.sh
git add sealed/ && git commit -m "rotate cloudflare token" && git push
```

ArgoCD automatically syncs the new sealed secrets to the cluster.

## 🌐 Network Configuration

### Local Cluster
- **Cluster Name**: `moonrepo-dev`
- **Port Mapping**: 8888:80 (load balancer)
- **Traefik**: Disabled (using Istio instead)
- **Gateway API**: CRDs installed for service mesh routing

### Production DNS
- **Domain**: `brandwhisper.cloud`
- **DNS Provider**: Cloudflare
- **External DNS**: Automatic DNS record creation from HTTPRoutes
- **TLS**: Wildcard certificate via cert-manager + Let's Encrypt

### Accessing Services

**Local:**
```bash
# Port forward to Gateway
kubectl port-forward -n istio-system svc/gateway-istio 8080:80

# Access services
curl http://home.localhost:8080  # Home Assistant (add to /etc/hosts)
```

**Production:**
- `https://home.brandwhisper.cloud` - Home Assistant
- `https://rollouts.home.brandwhisper.cloud` - Argo Rollouts Dashboard
- (Future services at `https://*.home.brandwhisper.cloud`)

## 🔒 Security

### Secrets Management
- **AWS Secrets Manager**: Source of truth (KMS encrypted)
- **Single KMS Key**: Shared across S3, Secrets Manager
- **SealedSecrets**: Cluster-specific encryption for GitOps
- **No Plaintext Secrets**: Never committed to git
- **Least Privilege**: Pulumi creates restricted tokens for services

### Token Hierarchy
1. **Cloudflare Master Token** (AWS Secrets Manager) → Used by Pulumi
2. **Cloudflare DNS Token** (Created by Pulumi) → Used by cert-manager/external-dns
3. **K8s Secrets** (Created by Pulumi) → Injected into namespaces

### Access Control
- IAM user with minimal permissions for Pulumi
- Service accounts with RBAC in Kubernetes
- Cert-manager uses service account tokens
- Sealed secrets controller holds private key (backup critical!)

### TLS/Certificates
- Let's Encrypt production certificates
- DNS-01 challenge (no HTTP exposure needed)
- Automatic renewal via cert-manager
- Wildcard support for easy service addition

## 📋 Development Guidelines

### Adding New Services

1. **Create HTTPRoute:**
   ```yaml
   apiVersion: gateway.networking.k8s.io/v1
   kind: HTTPRoute
   metadata:
     name: my-service
     namespace: my-namespace
   spec:
     parentRefs:
     - name: gateway
       namespace: istio-system
     hostnames:
     - "myservice.home.brandwhisper.cloud"
     rules:
     - backendRefs:
       - name: my-service
         port: 8080
   ```

2. **Add ArgoCD Application:**
   ```yaml
   apiVersion: argoproj.io/v1alpha1
   kind: Application
   metadata:
     name: my-service
     namespace: argocd
   spec:
     source:
       repoURL: https://charts.example.com
       chart: my-service
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
4. **Commit and push:** ArgoCD auto-deploys
5. **Certificate auto-generated:** Gateway-shim creates cert

### Code Quality
- **Linting**: Biome for consistent formatting
- **Type Checking**: TypeScript strict mode
- **CI/CD**: GitHub Actions with moon tasks
- **Testing**: Unit/integration tests for apps and infra

### Environment Variables
- Local: `.envrc.local` (direnv compatible)
- Production: Kubernetes secrets via Pulumi or AWS
- Never commit secrets to repository

## 🚨 Troubleshooting

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

# Verify controller certificate
kubeseal --fetch-cert --context=prod
```

**"Certificate not issued":**
```bash
# Check cert-manager logs
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager

# Verify gateway-shim controller is enabled
kubectl logs -n cert-manager -l app.kubernetes.io/name=cert-manager | grep gateway-shim

# Check certificate status
kubectl describe certificate home-tls -n istio-system
```

### Common Issues

**Cluster creation fails:**
```bash
k3d cluster delete moonrepo-dev
bash run.sh
```

**Port already in use:**
- Check if port 8888 is in use: `sudo lsof -i :8888`
- Update port in `k3d-config.yaml`

**Pulumi state issues:**
```bash
# Check state
pulumi stack ls

# Refresh resources
pulumi refresh

# Destroy and recreate
pulumi destroy
pulumi up
```

**Helm install failures:**
- Check cluster resources: `kubectl get nodes`
- Verify namespace exists: `kubectl get ns`
- Check pod logs: `kubectl logs -l app=service-name`

**HTTPRoute not working:**
```bash
# Check Gateway status
kubectl describe gateway gateway -n istio-system

# Check HTTPRoute status
kubectl describe httproute my-route -n my-namespace

# Verify Istio gateway pods
kubectl get pods -n istio-system
```

## 🤝 Contributing

1. Follow existing patterns in codebase
2. Update documentation for architectural changes
3. Test changes locally with `bash run.sh`
4. Run lint and type check before committing
5. Use `moonrepo.dev/skip-local: "true"` for prod-only resources
6. Document new secrets in `infra/secrets/README.md`

## 📚 Key Documentation

- [Secrets Management](infra/secrets/README.md) - AWS Secrets Manager + SealedSecrets workflow
- [CLAUDE.md](CLAUDE.md) - Instructions for Claude Code
- [AGENTS.md](AGENTS.md) - Development guidelines for AI agents

## 📄 License

Proprietary - See LICENSE file for details.

---

*Built with [Moon](https://moonrepo.dev), [Bun](https://bun.sh), [Pulumi](https://pulumi.com), and [ArgoCD](https://argoproj.github.io/cd/)*
