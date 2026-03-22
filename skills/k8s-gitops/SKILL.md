---
name: k8s-gitops
description: "Kubernetes + ArgoCD + Helm GitOps patterns for infra/. Use when modifying manifests, adding services, or changing cluster configuration."
---

# Kubernetes GitOps

Use when working in `infra/`.

## Golden Rule

**All changes through git PRs.** Never `kubectl apply`, `kubectl patch`, `kubectl set image`, or `helm install` directly. ArgoCD has `selfHeal: true` — it will revert your manual changes.

## Architecture

- **ArgoCD** watches `master` branch, auto-syncs to cluster
- **Helm charts** deployed via ArgoCD Application manifests in `infra/app-of-apps/`
- **Gateway API** (Istio) for routing — NOT Ingress resources
- **Moon** task runner for Pulumi commands

## Adding a New Service

1. Create ArgoCD Application manifest in `infra/app-of-apps/<name>/`
2. Add HTTPRoute for `<name>.brandwhisper.cloud` — wildcard cert covers it automatically
3. Set `sync-wave` annotation for deployment ordering
4. Include resource requests AND limits on all containers
5. Pin to a specific node with `nodeSelector` if the workload needs it
6. Commit, push, let ArgoCD deploy

### HTTPRoute Template

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
  - "myservice.brandwhisper.cloud"
  rules:
  - backendRefs:
    - name: myservice
      port: 8080
```

## Secrets

- **Source of truth:** AWS Secrets Manager (KMS encrypted)
- **Flow:** AWS → `sync-secrets.sh` → SealedSecrets → git → ArgoCD → cluster
- **Never commit plaintext secrets.** Only SealedSecrets YAML is safe to commit.
- Update a secret: `cd infra/secrets && ./set-secret.sh <name> "<value>" && ./sync-secrets.sh`

## Rules

- Always specify `namespace` in manifests — don't rely on defaults.
- Use `sync-wave` annotations to control deployment order (negative = earlier).
- external-dns auto-creates Cloudflare DNS from HTTPRoute hostnames — don't create DNS records manually.
- cert-manager gateway-shim auto-creates TLS certs from Gateway listeners — don't create Certificate resources manually.
- Use `moonrepo.dev/skip-local: "true"` annotation for production-only resources.
- Helm values: prefer upstream chart defaults, override only what's necessary.
- Container images: pin to specific tags or SHA digests, never `latest`.
