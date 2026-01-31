# ArgoCD App-of-Apps

This directory contains ArgoCD Application manifests that deploy all infrastructure and application services using the app-of-apps pattern with GitOps.

## What is App-of-Apps?

The app-of-apps pattern uses a single ArgoCD Application to manage multiple child Applications. Each subdirectory contains Application manifests that ArgoCD watches and automatically syncs from git to the Kubernetes cluster.

## Directory Structure

```
app-of-apps/
├── bootstrap/              # Bootstrap applications (sync-wave -2 to -1)
│   └── sealed-secrets-bootstrap.yaml
├── operators/              # Infrastructure operators (sync-wave 0)
│   ├── cert-manager-crds.yaml
│   ├── cert-manager.yaml
│   ├── pulumi-operator.yaml
│   ├── sealed-secrets.yaml
│   ├── argo-rollouts.yaml
│   ├── external-dns.yaml
│   ├── cloudnative-pg.yaml
│   └── pxc-operator.yaml
├── istio/                 # Service mesh (sync-wave 1)
├── pulumi/                # Pulumi stack configuration (sync-wave 1)
├── home-assistant/        # Home automation (sync-wave 2+)
├── authentik/             # SSO provider (sync-wave 2+)
├── nextcloud/             # File sharing (sync-wave 2+)
└── new-relic/            # Monitoring (sync-wave 2+)
```

## Sync Waves

Applications are deployed in a controlled order using ArgoCD sync waves:

### Wave -2 to -1: Bootstrap
- **sealed-secrets-bootstrap**: Deploys SealedSecret manifests to `pulumi-operator-system` namespace
  - Contains encrypted AWS credentials and Cloudflare tokens
  - Must be deployed before Pulumi operator can run

### Wave 0: Operators
Infrastructure operators that provide core functionality:

- **pulumi-operator**: Runs Pulumi stacks in-cluster
- **sealed-secrets**: Decrypts SealedSecrets to Kubernetes Secrets
- **cert-manager**: Manages TLS certificates via Let's Encrypt
  - Includes ClusterIssuer for DNS-01 challenges
  - Gateway-shim controller enabled for automatic cert generation
- **argo-rollouts**: Progressive delivery and canary deployments
- **external-dns**: Automatic DNS record creation from HTTPRoutes
- **cloudnative-pg**: PostgreSQL operator
- **pxc-operator**: Percona XtraDB Cluster operator

### Wave 1: Service Mesh & Infrastructure
- **Istio**: Service mesh components (base, CNI, istiod, gateway, ztunnel)
- **Pulumi Stack**: Stack CRD that triggers Pulumi operator to create Cloudflare tokens

### Wave 2+: Applications
User-facing applications and services:

- **home-assistant**: Home automation platform with Mosquitto MQTT and Zigbee2MQTT
- **authentik**: SSO and identity provider
- **nextcloud**: File sharing and collaboration
- **new-relic**: Monitoring and observability

## Application Manifest Structure

Each Application manifest follows this pattern:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-service
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "0"  # Optional: control deployment order
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default

  # Source: Helm chart or git directory
  source:
    repoURL: https://charts.example.com
    targetRevision: "1.0.0"
    chart: my-service
    helm:
      releaseName: my-service
      values: |
        # Helm values here

  # Destination: where to deploy
  destination:
    server: https://kubernetes.default.svc
    namespace: my-namespace

  # Sync policy: automated or manual
  syncPolicy:
    automated:
      prune: true      # Remove resources deleted from git
      selfHeal: true   # Revert manual changes
    syncOptions:
      - CreateNamespace=true
    retry:
      limit: -1        # Unlimited retries
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
```

## Key Concepts

### Automated Sync

All applications use `automated` sync policy with `prune` and `selfHeal` enabled:
- Changes in git are automatically applied to the cluster
- Resources deleted from git are removed from the cluster
- Manual changes to the cluster are reverted to match git state

### Finalizers

Applications use `resources-finalizer.argocd.argoproj.io` to ensure proper cleanup when an Application is deleted.

### Sync Options

Common sync options used:
- `CreateNamespace=true`: Automatically create target namespace
- `ServerSideApply=true`: Use server-side apply for better conflict resolution
- `SkipDryRunOnMissingResource=true`: Skip validation for CRDs that may not exist yet
- `RespectIgnoreDifferences=true`: Respect ignore difference annotations

### Retry Logic

Applications are configured with exponential backoff retry:
- Initial delay: 5 seconds
- Backoff factor: 2x
- Maximum delay: 3 minutes
- Unlimited retries (`limit: -1`)

## Adding a New Application

1. **Create Application manifest:**

```yaml
# app-of-apps/my-app/my-service.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-service
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "2"  # After operators
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://charts.example.com
    targetRevision: "1.0.0"
    chart: my-service
  destination:
    server: https://kubernetes.default.svc
    namespace: my-service
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

2. **Commit and push to git:**

```bash
git add app-of-apps/my-app/
git commit -m "add my-service application"
git push
```

3. **ArgoCD automatically syncs:**
   - Detects new Application manifest
   - Creates Application in ArgoCD
   - Deploys resources to cluster

## Local Development

For local development, the `run.sh` script bypasses ArgoCD and installs Helm charts directly:

```bash
bash run.sh
```

The script:
1. Parses Application manifests in `app-of-apps/`
2. Extracts Helm chart information
3. Installs charts directly using `helm install`
4. Skips applications with `moonrepo.dev/skip-local: "true"` annotation

### Skipping Applications Locally

Add this annotation to skip an application in local development:

```yaml
metadata:
  annotations:
    moonrepo.dev/skip-local: "true"
```

## Deployment Flow

```
Git Repository (app-of-apps/)
    ↓
ArgoCD watches git
    ↓
Application manifests synced
    ↓
ArgoCD creates Applications
    ↓
Helm charts deployed (sync-wave order)
    ↓
Resources created in cluster
```

## Example: Adding a Service with HTTPRoute

To expose a service at `myservice.home.brandwhisper.cloud`:

1. **Create Application manifest:**

```yaml
# app-of-apps/my-app/my-service.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-service
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "2"
spec:
  project: default
  source:
    repoURL: https://charts.example.com
    chart: my-service
    targetRevision: "1.0.0"
  destination:
    server: https://kubernetes.default.svc
    namespace: my-service
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

2. **Create HTTPRoute:**

```yaml
# app-of-apps/my-app/route.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-service-route
  namespace: argocd
  annotations:
    argocd.argoproj.io/sync-wave: "3"  # After service deployment
spec:
  project: default
  source:
    repoURL: https://github.com/your-org/moonrepo
    targetRevision: HEAD
    path: infra/manifests/my-service  # Contains HTTPRoute YAML
  destination:
    server: https://kubernetes.default.svc
    namespace: my-service
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

3. **Commit and push:** ArgoCD deploys automatically

The wildcard certificate `*.home.brandwhisper.cloud` covers all subdomains, so no manual certificate creation is needed.

## Troubleshooting

### Application Out of Sync

```bash
# Check application status
argocd app get my-service

# Force sync
argocd app sync my-service

# Diff to see what changed
argocd app diff my-service
```

### Application Health Degraded

```bash
# Check application health
argocd app get my-service

# View resource status
kubectl get all -n my-namespace

# Check pod logs
kubectl logs -n my-namespace -l app=my-service
```

### Sync Wave Issues

If applications deploy in the wrong order:
1. Check sync-wave annotations
2. Ensure dependencies have lower wave numbers
3. Force sync with `--force` flag if needed

### Helm Values Not Applied

```bash
# Verify Application manifest in git
cat app-of-apps/my-app/my-service.yaml

# Check ArgoCD's view of values
argocd app get my-service -o yaml

# Hard refresh if needed
argocd app sync my-service --force
```

## Best Practices

1. **Use Sync Waves**: Control deployment order for dependencies
2. **Enable Automated Sync**: Let ArgoCD manage deployments
3. **Set Finalizers**: Ensure proper cleanup on deletion
4. **Use ServerSideApply**: Better conflict resolution for CRDs
5. **Group Related Resources**: Keep Application manifests organized by service
6. **Document Custom Values**: Add comments explaining non-obvious Helm values
7. **Test Locally First**: Use `bash run.sh` before committing

## Related Documentation

- [Infrastructure Overview](../README.md) - Infrastructure folder structure
- [Pulumi Stack](../pulumi/README.md) - Cloudflare token management
- [Secrets Management](../secrets/README.md) - Secrets workflow
- [Main README](../../README.md) - Project overview
