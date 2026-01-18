# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a monorepo combining a Next.js web application with Kubernetes infrastructure-as-code. It uses Moon as the task runner and Bun as the package manager.

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
moon run pulumi-bootstrap:up       # Deploy KMS, S3 bucket, IAM user
```

The bootstrap stack uses local state and provisions:
- KMS key for S3 encryption
- S3 bucket (`moonrepo-pulumi-state-{account-id}`) with versioning
- IAM user (`pulumi-deployer`) with access key for CI/CD

After bootstrap, migrate main stack to S3 backend:
```bash
cd infra/pulumi
pulumi login s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2
```

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
apps/app/              Next.js 16 application (tagged 'next' for Moon task inheritance)
infra/pulumi/          Pulumi IaC for Cloudflare DNS and K8s secrets
infra/pulumi-bootstrap/ Pulumi IaC for AWS backend (KMS, S3, IAM) - uses local state
infra/app-of-apps/     ArgoCD Application manifests (Helm-based deployments)
infra/manifests/       Raw Kubernetes manifests (cert-manager issuers, etc.)
.moon/                 Moon workspace config
```

### Moon Configuration
- `workspace.yml`: Projects in `apps/*`, `packages/*`, `infra/pulumi`, `infra/pulumi-bootstrap`
- `toolchain.yml`: Bun package manager, TypeScript project references synced
- Tasks for Next.js apps inherited from moonrepo/moon-configs via tag

### Infrastructure Services
Deployed via Helm through ArgoCD Application manifests:
- Istio service mesh (base, CNI, istiod, gateway, ztunnel)
- Cert-manager with Cloudflare DNS-01
- Home Assistant with Mosquitto MQTT, Zigbee2MQTT
- Authentik (SSO), Nextcloud
- CloudNative-PG, Sealed Secrets, External DNS

### Kubernetes Setup
- Local: K3d with K3s v1.32.10 (single server, no agents)
- Production: K3s with RKE2 (see `install.sh`)
- Gateway API CRDs installed on cluster creation
