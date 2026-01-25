# Moonrepo: Full-Stack Infrastructure as Code

A monorepo combining a Next.js web application with Kubernetes infrastructure-as-code, managed with Moon and Bun.

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
│   ├── app-of-apps/           # ArgoCD Application manifests (24 Helm charts)
│   └── manifests/             # Raw Kubernetes manifests
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
moon run pulumi-bootstrap:up       # Deploy KMS, S3 bucket, IAM user
```

## 🏗️ Architecture

### Kubernetes Services
Deployed via Helm through ArgoCD Application manifests:
- **Service Mesh**: Istio (base, CNI, istiod, gateway, ztunnel)
- **Certificate Management**: Cert-manager with Cloudflare DNS-01
- **Home Automation**: Home Assistant with Mosquitto MQTT, Zigbee2MQTT
- **Self-Hosted Services**: Authentik (SSO), Nextcloud
- **Database**: CloudNative-PG (PostgreSQL operator)
- **Secrets**: Sealed Secrets, External DNS

### Infrastructure as Code
- **Pulumi**: Infrastructure provisioning with TypeScript
- **AWS Backend**: KMS-encrypted S3 bucket for state storage
- **Cloudflare**: DNS management and TLS certificates
- **ArgoCD**: GitOps for Kubernetes deployments

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

### Local Development
1. Run `bash run.sh` to create K3d cluster
2. Cluster uses `k3d-config.yaml` (single server, no agents)
3. Installs Gateway API CRDs on creation
4. Parses ArgoCD manifests in `infra/app-of-apps/`
5. Installs Helm charts directly (bypasses ArgoCD for local dev)
6. Supports `moonrepo.dev/skip-local: "true"` annotation

### Pulumi State Management

**Bootstrap Phase (local state):**
```bash
moon run pulumi-bootstrap:up
```
Provisions:
- KMS key for S3 encryption
- S3 bucket (`moonrepo-pulumi-state-{account-id}`) with versioning
- IAM user (`pulumi-deployer`) with access key for CI/CD

**Production Deployment (S3 backend):**
```bash
cd infra/pulumi
pulumi login s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2
moon run pulumi:up
```

## 🌐 Network Configuration

### Local Cluster
- **Cluster Name**: `moonrepo-dev`
- **Port Mapping**: 8888:80 (load balancer)
- **Traefik**: Disabled (using Istio instead)
- **Gateway API**: CRDs installed for service mesh routing

### Production Considerations
- See `install.sh` for RKE2-based K3s production setup
- Cloudflare DNS management via Pulumi
- External DNS for automatic DNS record management

## 🔒 Security

### Secrets Management
- **Kubernetes**: Sealed Secrets operator
- **AWS**: KMS-encrypted S3 bucket for Pulumi state
- **Database**: CloudNative-PG with encryption at rest
- **TLS**: Cert-manager with Let's Encrypt via Cloudflare

### Access Control
1. IAM user with minimal permissions for Pulumi
2. Service accounts with role-based access in Kubernetes
3. OIDC integration for ArgoCD (planned)

## 📋 Development Guidelines

### Adding New Services
1. Create Helm chart or use existing community chart
2. Add Application manifest to `infra/app-of-apps/`
3. Configure annotations for local development
4. Test with `bash run.sh`
5. Create Pulumi resources for DNS/secrets if needed

### Code Quality
- **Linting**: Biome for consistent formatting
- **Type Checking**: TypeScript strict mode
- **CI/CD**: GitHub Actions with moon tasks
- **Testing**: Unit/integration tests for apps and infra

### Environment Variables
- Local: `.envrc.local` (direnv compatible)
- Production: Kubernetes secrets via Pulumi
- Never commit secrets to repository

## 🚨 Troubleshooting

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

## 🤝 Contributing

1. Follow existing patterns in codebase
2. Update CLAUDE.md for significant architectural changes
3. Test changes locally with `bash run.sh`
4. Run lint and type check before committing
5. Update README.md for new features/changes

## 📄 License

Proprietary - See LICENSE file for details.

---

*Built with [Moon](https://moonrepo.dev), [Bun](https://bun.sh), [Pulumi](https://pulumi.com), and [ArgoCD](https://argoproj.github.io/cd/)*