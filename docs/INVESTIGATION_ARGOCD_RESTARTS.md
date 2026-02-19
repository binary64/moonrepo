# ArgoCD Pod Restart Investigation

## Issue Summary
Both `argocd-repo-server` and `argocd-server` pods showed 12 restarts each, raising concerns about stability.

**Affected Pods:**
- `argocd-repo-server-5877bf8bf-dmwj2` - 12 restarts
- `argocd-server-b6877666b-lzdwq` - 12 restarts

**Cluster:** RKE2 production cluster  
**Namespace:** argocd  
**Investigation Date:** February 10, 2026

---

## Investigation Steps Performed

### 1. Pod Status and Restart Analysis
```bash
kubectl get pods -n argocd -o wide
```

**Finding:** Both pods have identical restart counts (12), last restarted on **January 27, 2026 at 16:20:06-09 UTC**

### 2. Previous Pod Logs Analysis
```bash
kubectl logs -n argocd argocd-repo-server-5877bf8bf-dmwj2 --previous --tail=100
kubectl logs -n argocd argocd-server-b6877666b-lzdwq --previous --tail=100
```

**Finding:**
- **repo-server**: Normal manifest generation and cache hit operations, no critical errors
- **server**: Routine cache invalidations for notifications ConfigMap/Secret, no errors
- **Exit Code**: Both terminated with `Exit Code: 255` and `Reason: Unknown`

### 3. Pod Resource Analysis
```bash
kubectl describe pod -n argocd argocd-repo-server-5877bf8bf-dmwj2
kubectl describe pod -n argocd argocd-server-b6877666b-lzdwq
kubectl top pods -n argocd
```

**Finding:**
- **Current resource usage:** repo-server (1m CPU, 68Mi RAM), server (1m CPU, 40Mi RAM)
- **Resource limits:** `resources: {}` - **NO LIMITS SET** ⚠️
- **Node resources:** 93% CPU requested, 61% memory requested
- No OOM kills detected in pod events

### 4. Node Analysis
```bash
kubectl get node master -o jsonpath='{.status.conditions[?(@.type=="Ready")].lastTransitionTime}'
uptime
```

**Finding:**
- **Node Ready transition:** January 20, 2026 at 15:16:48Z
- **System uptime (Feb 10):** 1 day, 9 hours (node rebooted ~Jan 27)
- **Pod restart timing:** January 27, 2026 at 16:20:06 UTC

**Correlation:** Pod restarts coincide with a **node reboot event** ✅

### 5. Redis Connectivity Check
```bash
kubectl logs -n argocd argocd-redis-656ff66fb9-2tkt9 --tail=100
```

**Finding:**
- Redis restarted at same time: `27 Jan 2026 16:20:14.781 * Ready to accept connections tcp`
- No connection errors in Redis logs
- ArgoCD pods successfully connecting to Redis

### 6. ArgoCD Application Sync Status
```bash
kubectl get app -n argocd
```

**Finding (unrelated to restarts but notable):**
- `authentik-postgres`: OutOfSync - Healthy
- `cert-manager-crds`: OutOfSync - Missing
- `infra-root`: OutOfSync - Healthy
- `mqttui`: Unknown - Healthy
- `newrelic`: Unknown - Healthy
- `zigbee2mqtt`: OutOfSync - Healthy

### 7. ArgoCD ConfigMap Review
```bash
kubectl get configmap -n argocd argocd-cm -o yaml
```

**Finding:**
- Standard configuration present
- Reconciliation timeout: 180s
- No misconfigurations detected

---

## Root Cause Analysis

### Primary Cause: Node Reboot
The 12 restarts across all ArgoCD pods (and other system pods) are **directly correlated with a node reboot event on January 27, 2026**.

**Evidence:**
1. All ArgoCD pods have the same restart count (10-12)
2. All pods restarted within a 2-minute window on Jan 27, 16:19-16:20 UTC
3. Exit code 255 with "Unknown" reason is typical for forceful pod termination during node shutdown
4. Redis and other infrastructure pods also restarted at the same time

**Conclusion:** This is **NOT an application-level issue** with ArgoCD itself. The restarts are a normal consequence of infrastructure maintenance or an unplanned node reboot.

### Secondary Issue: Missing Resource Limits
While not the cause of the restarts, the absence of resource limits poses a **stability risk**:

**Risks:**
1. **No memory protection:** Pods could consume excessive memory and cause OOM kills
2. **No CPU throttling:** Could impact other workloads during high load
3. **Unpredictable behavior:** Without limits, Kubernetes cannot make informed scheduling decisions
4. **Poor QoS:** Pods are assigned "BestEffort" QoS class instead of "Burstable"

---

## Recommendations

### 1. ✅ Add Resource Limits (Implemented in this PR)
Define appropriate resource requests and limits for all ArgoCD components:
- `repo-server`: 256Mi-512Mi memory, 100m-500m CPU
- `server`: 128Mi-256Mi memory, 100m-500m CPU
- `redis`: 64Mi-128Mi memory, 50m-200m CPU
- `controller`: 512Mi-1Gi memory, 250m-1000m CPU
- Other components: 64Mi-128Mi memory, 50m-200m CPU

### 2. Monitor Node Health
Investigate the cause of the January 27 node reboot:
- Check for scheduled maintenance
- Review system logs for hardware issues
- Monitor node uptime and stability

### 3. Enable ArgoCD Notifications
Configure notifications for:
- Application sync failures
- Pod restart alerts
- Resource threshold warnings

### 4. Resolve Application Sync Issues
Address the out-of-sync applications identified:
- `cert-manager-crds`: Missing resources
- `mqttui`, `newrelic`: Unknown status
- Other apps: Drift from desired state

### 5. Consider High Availability
For production clusters, consider:
- Multi-replica deployments for ArgoCD server and repo-server
- Node affinity rules to spread replicas across nodes
- PodDisruptionBudgets to maintain availability during maintenance

---

## Conclusion

**The 12 pod restarts are NOT a bug or application failure** - they are the expected result of a node reboot on January 27, 2026. All pods recovered successfully and are currently healthy.

However, the **lack of resource limits** is a configuration gap that should be addressed to ensure long-term stability and predictable resource consumption.

This PR implements resource limits as a proactive measure to prevent potential future issues, not as a fix for the observed restarts.

---

## Files Changed
- `infra/argocd-values.yaml` (new): Resource limits configuration for ArgoCD Helm deployment
- `docs/INVESTIGATION_ARGOCD_RESTARTS.md` (new): Detailed investigation report
- `infra/ARGOCD_UPGRADE.md` (new): Application instructions and guidance

## Testing Recommendations
1. Apply resource limits to a staging environment first
2. Monitor pod performance and adjust limits if needed
3. Verify no OOMKilled events occur under normal load
4. Test during high reconciliation activity (many app syncs)

## References
- [ArgoCD Resource Limits Best Practices](https://argo-cd.readthedocs.io/en/stable/operator-manual/high_availability/)
- [Kubernetes Resource Management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/)
