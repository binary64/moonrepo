# Infrastructure

This directory contains all infrastructure-as-code for the Kubernetes cluster, including Pulumi stacks, ArgoCD application manifests, and secrets management.

## Directory Structure

```
infra/
├── pulumi/                    # Main Pulumi stack (Cloudflare DNS + K8s secrets)
├── pulumi-bootstrap/          # Bootstrap stack (AWS S3 backend setup)
├── app-of-apps/              # ArgoCD Application manifests
│   ├── bootstrap/            # Bootstrap apps (sealed-secrets)
│   ├── operators/            # Infrastructure operators
│   ├── istio/               # Service mesh components
│   ├── home-assistant/      # Home automation
│   ├── authentik/           # SSO provider
│   ├── nextcloud/           # File sharing
│   ├── new-relic/           # Monitoring
│   └── pulumi/              # Pulumi operator configuration
├── secrets/                  # Secrets management scripts
└── manifests/               # Raw Kubernetes manifests (if needed)
```

## Components Overview

### Pulumi Stacks

#### pulumi-bootstrap
- **Purpose**: One-time AWS backend setup for Pulumi state storage
- **State Backend**: Local filesystem (single-use stack)
- **Resources Created**:
  - KMS key for encryption
  - S3 bucket for Pulumi state
  - IAM user for Pulumi operator
  - AWS Secrets Manager secrets (empty, populated separately)
- **Documentation**: [pulumi-bootstrap/README.md](pulumi-bootstrap/README.md)

#### pulumi
- **Purpose**: Cloudflare DNS management and Kubernetes secret injection
- **State Backend**: S3 bucket (created by pulumi-bootstrap)
- **Resources Created**:
  - Cloudflare API tokens (restricted to DNS only)
  - Kubernetes secrets for cert-manager
  - Kubernetes secrets for external-dns
- **Documentation**: [pulumi/README.md](pulumi/README.md)

### ArgoCD Applications

The `app-of-apps/` directory contains ArgoCD Application manifests that deploy all Kubernetes services via GitOps. Uses the app-of-apps pattern with sync-wave ordering for controlled deployment.

**Documentation**: [app-of-apps/README.md](app-of-apps/README.md)

### Secrets Management

The `secrets/` directory contains scripts to manage secrets using AWS Secrets Manager as the source of truth, synced to Kubernetes via SealedSecrets.

**Documentation**: [secrets/README.md](secrets/README.md)

## Deployment Order

1. **Bootstrap Stack** (pulumi-bootstrap)
   - Creates AWS infrastructure
   - Run once to set up S3 backend

2. **Secrets Setup** (secrets/)
   - Populate AWS Secrets Manager
   - Generate SealedSecrets
   - Commit sealed secrets to git

3. **ArgoCD Sync** (app-of-apps/)
   - ArgoCD deploys sealed-secrets controller
   - Sealed secrets are decrypted to K8s secrets
   - Pulumi operator runs main stack
   - Applications are deployed in sync-wave order

## Quick Start

### Initial Setup

```bash
# 1. Deploy AWS backend
cd pulumi-bootstrap
pulumi up

# 2. Migrate main stack to S3 backend
cd ../pulumi
pulumi login s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2

# 3. Set secrets
cd ../secrets
./set-secret.sh cloudflare-api-token-pulumi "your-token"
./sync-secrets.sh

# 4. Commit sealed secrets
git add sealed/
git commit -m "add sealed secrets"
git push
```

### Local Development

```bash
# Create K3d cluster and deploy all apps
bash run.sh
```

The `run.sh` script bypasses ArgoCD and directly installs Helm charts for local development.

## Architecture Patterns

### GitOps with ArgoCD

All infrastructure is defined declaratively in git. ArgoCD watches the repository and automatically syncs changes to the cluster.

**Benefits**:
- Version control for infrastructure
- Declarative state management
- Automatic drift detection and self-healing
- Audit trail of all changes

### Sync Waves

Applications are deployed in ordered waves:
- `-2 to -1`: Bootstrap (sealed-secrets, pulumi-operator)
- `0`: Operators (cert-manager, argo-rollouts, external-dns)
- `1`: Service mesh (Istio)
- `2+`: Applications

### In-Cluster Pulumi Execution

The Pulumi operator runs Pulumi stacks directly in the cluster, eliminating the need for external CI/CD pipelines for infrastructure changes.

**Flow**:
1. Developer pushes code to git
2. ArgoCD syncs Stack CRD
3. Pulumi operator detects change
4. Operator runs `pulumi up` in-cluster
5. Resources are created/updated

## Common Tasks

### Adding a New Service

See [app-of-apps/README.md](app-of-apps/README.md) for instructions on adding new applications.

### Updating Secrets

See [secrets/README.md](secrets/README.md) for secrets management workflow.

### Deploying Infrastructure Changes

```bash
# Preview changes
moon run pulumi:preview

# Apply changes
moon run pulumi:up
```

Or commit to git and let the Pulumi operator apply changes automatically.

## Related Documentation

- [Main README](../README.md) - Project overview
- [CLAUDE.md](../CLAUDE.md) - Development guidelines
- [Pulumi Bootstrap](pulumi-bootstrap/README.md) - AWS backend setup
- [Pulumi Stack](pulumi/README.md) - Cloudflare DNS management
- [App-of-Apps](app-of-apps/README.md) - ArgoCD application pattern
- [Secrets](secrets/README.md) - Secrets management workflow
