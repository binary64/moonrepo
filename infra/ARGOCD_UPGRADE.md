# ArgoCD Resource Limits Upgrade

This document describes how to apply resource limits to the ArgoCD deployment.

## Context

The ArgoCD installation currently has no resource limits defined, which can lead to:
- Unpredictable resource consumption
- Potential OOM (Out of Memory) kills
- Poor Quality of Service (QoS) classification
- Resource contention with other workloads

## Changes

The `argocd-values.yaml` file defines resource requests and limits for all ArgoCD components:
- **repo-server**: Primary component that generates manifests
- **server**: API server and UI
- **controller**: Application reconciliation controller  
- **redis**: Caching layer
- **applicationSet**: ApplicationSet controller
- **dex**: SSO/OIDC provider
- **notifications**: Notification controller

## How to Apply

### Option 1: Helm Upgrade (Recommended)

If ArgoCD was installed via Helm:

```bash
# Get current ArgoCD Helm release
helm list -n argocd

# Upgrade with new values
helm upgrade argocd argo/argo-cd \
  -n argocd \
  -f infra/argocd-values.yaml \
  --version <current-version>
```

### Option 2: ArgoCD Application (GitOps)

If ArgoCD manages itself (app-of-apps pattern):

1. Create an ArgoCD Application manifest:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: argocd
  namespace: argocd
spec:
  project: default
  source:
    chart: argo-cd
    repoURL: https://argoproj.github.io/argo-cd
    targetRevision: 6.7.12  # Match your current version
    helm:
      valueFiles:
        - ../../infra/argocd-values.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: argocd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

2. Apply and sync the application

### Option 3: Manual kubectl Patch

For targeted updates without Helm:

```bash
# Patch repo-server deployment
kubectl patch deployment argocd-repo-server -n argocd --patch '
spec:
  template:
    spec:
      containers:
      - name: repo-server
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
'

# Patch server deployment
kubectl patch deployment argocd-server -n argocd --patch '
spec:
  template:
    spec:
      containers:
      - name: server
        resources:
          requests:
            cpu: 100m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 256Mi
'

# Repeat for other components...
```

## Verification

After applying the changes:

```bash
# Check resource limits are applied
kubectl describe deployment argocd-repo-server -n argocd | grep -A 6 "Limits:"
kubectl describe deployment argocd-server -n argocd | grep -A 6 "Limits:"

# Monitor resource usage
kubectl top pods -n argocd

# Check pod QoS class (should be "Burstable")
kubectl get pods -n argocd -o custom-columns=NAME:.metadata.name,QOS:.status.qosClass

# Watch for OOMKilled events
kubectl get events -n argocd --watch
```

## Rollback

If issues arise, revert to previous state:

```bash
# Helm rollback
helm rollback argocd -n argocd

# Or manually remove resource limits
kubectl patch deployment argocd-repo-server -n argocd --type json -p '[{"op": "remove", "path": "/spec/template/spec/containers/0/resources"}]'
```

## Tuning Guidance

The provided values are **conservative starting points**. Adjust based on:

- **Cluster size**: More applications = higher memory/CPU needs
- **Repo complexity**: Large monorepos need more repo-server resources
- **Sync frequency**: Higher reconciliation frequency = more controller resources

### Monitoring Recommendations

1. Set up alerts for:
   - Pods approaching memory limits (>80%)
   - CPU throttling metrics
   - OOMKilled events

2. Review resource usage after 1 week:
   ```bash
   kubectl top pods -n argocd --sort-by=memory
   kubectl top pods -n argocd --sort-by=cpu
   ```

3. Adjust limits if needed:
   - Memory at 90%+ of limit: Increase limit
   - CPU consistently throttled: Increase CPU limit
   - Resources underutilized (<20%): Consider reducing requests

## Additional Recommendations

1. **Enable Horizontal Pod Autoscaling (HPA)** for repo-server and server if load varies
2. **Use PodDisruptionBudgets** to ensure availability during node maintenance
3. **Set up resource quotas** at the namespace level for additional safety
4. **Monitor cache hit ratios** - poor ratios indicate resource constraints

## References

- [ArgoCD High Availability Guide](https://argo-cd.readthedocs.io/en/stable/operator-manual/high_availability/)
- [Kubernetes Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
- [Quality of Service for Pods](https://kubernetes.io/docs/tasks/configure-pod-container/quality-service-pod/)
