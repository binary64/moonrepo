# AGENTS.md - Development Guidelines

This document provides guidelines for agentic coding assistants working in this monorepo.

## 🛠️ Build & Development Commands

### Moon Task Runner
All development commands use Moon as the primary task runner:

```bash
# Application development
moon run :dev          # Start Next.js dev server
moon run :build        # Build all projects
moon run :lint         # Lint with Biome (all projects)
moon run :type-check   # TypeScript type checking (all projects)

# Infrastructure
moon run pulumi:preview   # Preview Pulumi changes
moon run pulumi:up        # Deploy Pulumi infrastructure
moon run pulumi:destroy   # Destroy Pulumi infrastructure

# Pulumi bootstrap (AWS backend)
moon run pulumi-bootstrap:preview  # Preview AWS backend
moon run pulumi-bootstrap:up       # Deploy AWS backend

# Run single project tasks
moon run app:dev       # Run dev server for app only
moon run app:build     # Build app only
```

### Secrets Management
```bash
cd infra/secrets

# Update secrets in AWS Secrets Manager (encrypted with KMS)
./set-secret.sh pulumi-access-token "pul-xxxxx"
./set-secret.sh cloudflare-api-token-pulumi "your-token"

# Fetch from AWS and generate SealedSecrets
./sync-secrets.sh

# Commit sealed secrets (safe to commit)
git add sealed/ && git commit -m "update secrets"
```

**Never commit plaintext secrets.** AWS Secrets Manager is the source of truth. See [infra/secrets/README.md](infra/secrets/README.md).

### Local Kubernetes Development
```bash
# Create local cluster and deploy all apps
bash run.sh

# Check cluster status
kubectl get nodes
kubectl get pods -A

# Access specific services
k9s  # Terminal UI for Kubernetes
```

### Testing
```bash
# Type checking (already configured in Moon)
moon run :type-check

# Linting
moon run :lint

# Run tests (when implemented)
# Note: No test framework currently configured - use patterns from existing code
```

## 🎨 Code Style Guidelines

### TypeScript/JavaScript
- **Strict TypeScript**: Enable strict mode (already configured)
- **Imports**: Use ES6 imports, organize with Biome's `organizeImports`
- **Naming**: camelCase for variables/functions, PascalCase for classes/components
- **Error Handling**: Use try/catch with proper error types, avoid generic `catch (e)`

### React/Next.js (apps/app/)
- **Components**: Use functional components with TypeScript interfaces
- **File Structure**: Follow Next.js App Router conventions
- **Styling**: Use CSS Modules (`.module.css`) as seen in existing code
- **Images**: Use Next.js `Image` component with proper optimization

### Pulumi Infrastructure (infra/pulumi/, infra/pulumi-bootstrap/)
- **Resource Naming**: Use kebab-case with `moonrepo-` prefix
- **Configuration**: Externalize config using `pulumi.Config()`
- **Outputs**: Export meaningful outputs for cross-stack references
- **Security**: Follow Cloudflare/AWS security best practices
- **In-Cluster Detection**: Use `process.env.KUBERNETES_SERVICE_HOST` to detect in-cluster execution
  ```typescript
  const k8sProvider = new k8s.Provider("prod",
    process.env.KUBERNETES_SERVICE_HOST
      ? {} // Running in-cluster via Pulumi operator
      : { context: "prod" } // Running locally
  );
  ```

### Kubernetes Manifests (infra/app-of-apps/, infra/manifests/)
- **Annotations**: Use `moonrepo.dev/skip-local: "true"` for resources to skip in local dev
- **Sync Waves**: Use `argocd.argoproj.io/sync-wave` for deployment ordering
  - `-2` to `-1`: Bootstrap (Pulumi operator, sealed-secrets)
  - `0`: Operators (cert-manager, argo-rollouts, etc.)
  - `1`: Service mesh (Istio)
  - `2+`: Applications
- **Labels**: Consistent labeling for resource grouping
- **Helm Values**: Externalize configuration, use minimal overrides

### Gateway API & HTTPRoutes
- **Hostnames**: Use `*.home.brandwhisper.cloud` pattern for new services
- **Parent Refs**: Always reference the Istio gateway in `istio-system` namespace
- **Backend Refs**: Use service name and port from the same namespace
- **Example:**
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

## 📁 Project Structure Conventions

### Apps (apps/)
```
apps/app/
├── src/app/           # Next.js App Router pages
├── src/components/    # Reusable components (if added)
├── src/lib/          # Utilities and helpers (if added)
└── src/styles/       # Global styles (if added)
```

### Infrastructure (infra/)
```
infra/
├── pulumi/                   # Cloudflare DNS & K8s secrets
├── pulumi-bootstrap/         # AWS backend setup
├── app-of-apps/              # ArgoCD Application manifests
│   ├── bootstrap/            # Bootstrap apps (sync-wave -1)
│   ├── operators/            # Operators (sync-wave 0)
│   ├── istio/               # Service mesh (sync-wave 1)
│   └── ...                  # Applications (sync-wave 2+)
├── secrets/                  # Secrets management (AWS → SealedSecrets)
│   ├── set-secret.sh        # Update secrets in AWS
│   ├── sync-secrets.sh      # Fetch and seal
│   ├── sealed/              # Sealed secrets (committed)
│   └── unsealed/            # Unsealed secrets (gitignored)
└── manifests/               # Raw Kubernetes manifests
```

### Configuration Files
- **Moon**: `.moon/workspace.yml`, `.moon/toolchain.yml`, `moon.yml` per project
- **TypeScript**: `tsconfig.json` with strict mode enabled
- **Biome**: `biome.json` with recommended rules
- **Package Management**: `bunfig.toml`, `package.json` with workspaces

## 🔧 Tool Configuration

### Biome (Formatter & Linter)
- **Indentation**: 2 spaces
- **Line Width**: Follow Biome defaults
- **Imports**: Auto-organized by Biome
- **Rules**: Use recommended rules for Next.js and React

### TypeScript Configuration
- **Target**: ES2017
- **Strict**: true
- **Module Resolution**: bundler
- **Paths**: Configured with `@/*` alias for `./src/*`

### Git Hooks & VCS
- Biome runs on VCS-enabled files only
- Follow existing commit message patterns
- Use conventional commits when applicable

## 🚀 Development Workflow

### Adding New Features
1. **UI Components**: Add to `apps/app/src/components/` with TypeScript interfaces
2. **Pages/Routes**: Follow Next.js App Router in `apps/app/src/app/`
3. **Infrastructure**: Add Pulumi resources or ArgoCD Application manifests
4. **Local Testing**: Verify with `bash run.sh` for Kubernetes resources
5. **Linting**: Always run `moon run :lint` before committing

### Adding New Kubernetes Services

1. **Create Helm-based ArgoCD Application:**
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

2. **Create HTTPRoute for external access:**
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

3. **Test locally:** `bash run.sh`
4. **Commit and push:** ArgoCD auto-deploys, cert-manager auto-generates certificate

**Note:** No manual certificate creation needed. The wildcard cert covers all `*.home.brandwhisper.cloud`.

### Modifying Infrastructure
1. **Preview Changes**: `moon run pulumi:preview` before deployment
2. **Local Testing**: Use `moonrepo.dev/skip-local: "true"` annotation if needed
3. **State Management**: Pulumi state stored in AWS S3 (post-bootstrap)
4. **Secrets**: Use AWS Secrets Manager (see secrets workflow), never hardcode

### Managing Secrets

**Adding/Updating Secrets:**
```bash
cd infra/secrets
./set-secret.sh secret-name "secret-value"
./sync-secrets.sh
git add sealed/ && git commit -m "update secret"
```

**Available Secrets:**
- `pulumi-access-token` - Pulumi Cloud access token
- `cloudflare-api-token-pulumi` - Cloudflare token for Pulumi (high privileges)

**Secret Flow:**
1. Update in AWS Secrets Manager (source of truth, KMS encrypted)
2. Fetch and seal locally (unsealed files are gitignored)
3. Commit sealed secrets to git (safe to commit)
4. ArgoCD syncs to cluster, sealed-secrets controller decrypts

### Error Handling Patterns
```typescript
// TypeScript/Next.js
try {
  // operation
} catch (error) {
  if (error instanceof SpecificError) {
    // handle specific error
  } else {
    // log and rethrow or handle generically
    console.error('Unexpected error:', error);
    throw new Error('Operation failed');
  }
}

// Pulumi
const resource = new SomeResource('name', {
  // config
}, { protect: true }); // Use protect for critical resources
```

## 📝 Documentation Standards

### Code Comments
- Document complex logic or non-obvious decisions
- Use JSDoc for public APIs and functions
- Avoid obvious comments (e.g., "increment i")

### README & Documentation
- Update `README.md` for significant architectural changes
- Document new environment variables or configuration
- Keep `CLAUDE.md` updated for agent instructions
- Document new secrets in `infra/secrets/README.md`

### Commit Messages
- Descriptive, concise commit messages
- Reference issues or tickets when applicable
- Follow existing repository patterns

## ⚠️ Common Pitfalls & Solutions

### Tool Version Conflicts
- Use tools managed by proto (see `.prototools`)
- Never assume global tool versions
- Check `engines` in `package.json` for Node.js/Bun versions

### Local vs Production Differences
- Annotate resources with `moonrepo.dev/skip-local: "true"` when needed
- Test both local (`bash run.sh`) and production deployment paths
- Use Pulumi config for environment-specific values

### TypeScript Project References
- Moon syncs TypeScript project references automatically
- Don't manually edit `tsconfig.json` references
- Use `moon run :type-check` to verify type safety

### Kubernetes Resource Conflicts
- Check existing resources before adding new ones
- Use `kubectl get` to verify resource existence
- Follow naming conventions to avoid conflicts

### Secrets in Git
- **Never commit plaintext secrets** (they're gitignored)
- Only commit SealedSecrets (in `infra/secrets/sealed/`)
- AWS Secrets Manager is the source of truth
- Use `./sync-secrets.sh` to regenerate sealed secrets

### Certificate Issues
- Wildcard certificate auto-generated by cert-manager's gateway-shim controller
- No manual certificate creation needed for `*.home.brandwhisper.cloud`
- Ensure `featureGates: "ExperimentalGatewayAPISupport=true"` in cert-manager config
- Check cert-manager logs if certificate not issued

### Pulumi Operator
- Pulumi code must detect in-cluster execution (check `KUBERNETES_SERVICE_HOST`)
- Stack CRD triggers automatic `pulumi up` on git push
- Secrets must be in `pulumi-operator-system` namespace
- Check operator logs if stack not running

## 🔍 Code Review Checklist

Before submitting changes:
- [ ] `moon run :lint` passes (no Biome errors)
- [ ] `moon run :type-check` passes (no TypeScript errors)
- [ ] Local Kubernetes deployment works (`bash run.sh`)
- [ ] Pulumi preview shows expected changes (`moon run pulumi:preview`)
- [ ] No plaintext secrets committed (only SealedSecrets in `infra/secrets/sealed/`)
- [ ] Documentation updated if needed (README, CLAUDE.md, infra/secrets/README.md)
- [ ] Follows existing code patterns and conventions
- [ ] Sync-wave annotations correct for ArgoCD deployment order
- [ ] HTTPRoutes use correct Gateway parent ref and hostname pattern

## 🏗️ Architecture Patterns

### GitOps Workflow
1. Commit changes to git (master branch)
2. ArgoCD watches git repository
3. ArgoCD syncs changes to cluster
4. Sealed-secrets controller decrypts SealedSecrets
5. Pulumi operator runs Pulumi stack if Stack CRD changed
6. Cert-manager gateway-shim creates certificates from Gateway resources

### Sync-Wave Ordering
- **-2**: Pulumi operator (needs to run first to create tokens)
- **-1**: Sealed-secrets bootstrap (provides secrets for other apps)
- **0**: Operators (cert-manager, argo-rollouts, etc.)
- **1**: Service mesh (Istio gateway)
- **2+**: Applications (depend on service mesh)

### Secret Hierarchy
1. **AWS Secrets Manager** (source of truth, KMS encrypted)
2. **Local unsealed secrets** (ephemeral, gitignored)
3. **SealedSecrets** (committed to git, cluster-specific encryption)
4. **K8s Secrets** (decrypted by sealed-secrets controller)
5. **Application consumption** (pods mount secrets as env vars or files)

### Certificate Management
- Gateway-shim controller watches Gateway resources
- Auto-creates Certificate resources from Gateway listeners
- Let's Encrypt DNS-01 challenge via Cloudflare
- Wildcard certificate covers all `*.home.brandwhisper.cloud` subdomains
- Auto-renewal handled by cert-manager

## 📚 Additional Resources

- **Moon Documentation**: https://moonrepo.dev/docs
- **Next.js Documentation**: https://nextjs.org/docs
- **Pulumi Documentation**: https://www.pulumi.com/docs/
- **ArgoCD Documentation**: https://argo-cd.readthedocs.io/
- **Kubernetes Documentation**: https://kubernetes.io/docs/
- **Gateway API Documentation**: https://gateway-api.sigs.k8s.io/
- **Cert-Manager Documentation**: https://cert-manager.io/docs/
- **Istio Documentation**: https://istio.io/latest/docs/
- **Argo Rollouts Documentation**: https://argo-rollouts.readthedocs.io/

---

**Key Files for Reference:**
- [README.md](README.md) - Comprehensive project documentation
- [CLAUDE.md](CLAUDE.md) - Instructions for Claude Code
- [infra/secrets/README.md](infra/secrets/README.md) - Secrets management workflow
- `.prototools` - Tool versions
- `.moon/workspace.yml` - Moon workspace configuration
