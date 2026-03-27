# RKE2 Upgrade Runbook

## Cluster Topology

| Node | Hostname | Role | Location |
|------|----------|------|----------|
| NUC | `master` | control-plane + etcd | Home LAN (Bournemouth) |
| Jupiter | `vmi3137202` | worker agent | Contabo VPS (Portsmouth) |

## Current State (as of 2026-03-26)

| Node | Current Version | Target Version | Steps Required |
|------|----------------|----------------|----------------|
| NUC (master) | v1.33.6+rke2r1 | v1.35.1+rke2r1 | **2 steps:** v1.33→v1.34→v1.35 |
| Jupiter (agent) | v1.34.4+rke2r1 | v1.35.1+rke2r1 | 1 step |

> ⚠️ **Version mismatch:** master is one minor version behind Jupiter. Always upgrade the
> control-plane first, then agents — never upgrade an agent to a version newer than the
> control-plane server.
>
> ⚠️ **Multi-step upgrade for NUC:** Kubernetes only supports upgrading one minor version at
> a time. NUC must step through v1.34 before reaching v1.35 — run the master upgrade
> procedure twice (once targeting v1.34.4+rke2r1, then again targeting v1.35.1+rke2r1).

---

## Upgrade Procedure

### 1. Upgrade the master (NUC) — Step 1 of 2: v1.33 → v1.34

> Kubernetes enforces a one-minor-version skew policy. NUC is on v1.33, so it must be
> upgraded to v1.34 first before proceeding to v1.35.

```bash
# SSH into the NUC
ssh user@<NUC_IP>

# Download and install the intermediate RKE2 server version (v1.34)
curl -sfL https://get.rke2.io | sudo INSTALL_RKE2_VERSION=v1.34.4+rke2r1 sh -

# Restart the RKE2 server to apply the new version
sudo systemctl restart rke2-server

# Wait for the server to come back up (check status)
sudo systemctl status rke2-server

# Verify the node version
sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig /etc/rancher/rke2/rke2.yaml get nodes
```

Expected: `master` should now show `v1.34.4+rke2r1`.

### 2. Upgrade the master (NUC) — Step 2 of 2: v1.34 → v1.35

```bash
# SSH into the NUC (if not already connected)
ssh user@<NUC_IP>

# Download and install the target RKE2 server version (v1.35)
curl -sfL https://get.rke2.io | sudo INSTALL_RKE2_VERSION=v1.35.1+rke2r1 sh -

# Restart the RKE2 server to apply the new version
sudo systemctl restart rke2-server

# Wait for the server to come back up (check status)
sudo systemctl status rke2-server

# Verify the node version
sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig /etc/rancher/rke2/rke2.yaml get nodes
```

Expected: `master` should now show `v1.35.1+rke2r1`.

### 3. Verify cluster health after master upgrade

Before touching the agent, confirm the control-plane is healthy:

```bash
# All nodes should show Ready (run from NUC using RKE2 kubeconfig)
sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig /etc/rancher/rke2/rke2.yaml get nodes

# Core system pods should all be Running
sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig /etc/rancher/rke2/rke2.yaml get pods -n kube-system

# Check ArgoCD apps are synced (may take a few minutes after restart)
sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig /etc/rancher/rke2/rke2.yaml get applications -n argocd
```

### 4. Upgrade the agent (Jupiter)

```bash
# SSH into Jupiter
ssh user@<JUPITER_PUBLIC_IP>

# Download and install the new RKE2 agent version
curl -sfL https://get.rke2.io | sudo INSTALL_RKE2_VERSION=v1.35.1+rke2r1 INSTALL_RKE2_TYPE=agent sh -

# Restart the RKE2 agent to apply the new version
sudo systemctl restart rke2-agent

# Wait for the agent to reconnect (check status)
sudo systemctl status rke2-agent
```

### 5. Verify full cluster health

```bash
# From NUC using RKE2 kubeconfig:
sudo /var/lib/rancher/rke2/bin/kubectl --kubeconfig /etc/rancher/rke2/rke2.yaml get nodes

# Expected output (both nodes Ready, both on v1.35.1+rke2r1):
# NAME          STATUS   ROLES                       AGE   VERSION
# master        Ready    control-plane,etcd,master   ...   v1.35.1+rke2r1
# vmi3137202    Ready    <none>                      ...   v1.35.1+rke2r1
```

---

## Notes

- **Drain before upgrade (optional):** For zero-downtime, drain the node before restarting.
  `kubectl drain <node> --ignore-daemonsets --delete-emptydir-data` then
  `kubectl uncordon <node>` after the restart. Not strictly required for a single-node
  control-plane cluster, but good practice for the Jupiter agent (it runs all workloads).

- **ETCD backup:** Before upgrading the master, consider an etcd snapshot:
  `sudo rke2 etcd-snapshot save --name pre-upgrade-$(date +%Y%m%d)`

- **Version skew policy:** Kubernetes only supports a one-minor-version skew between
  control-plane and kubelet. RKE2 follows the same convention. Never skip minor versions —
  always upgrade one minor version at a time. NUC (v1.33→v1.35) requires two sequential
  upgrades: first to v1.34, then to v1.35 (see steps 1 and 2 above).

- **install.sh is pinned:** `install.sh` pins the RKE2 version via
  `INSTALL_RKE2_VERSION=v1.35.1+rke2r1`. Update this pin when targeting a new version for
  fresh installs. When upgrading an existing cluster, update both this file and follow this
  runbook.

- **Checking latest stable:** Visit https://github.com/rancher/rke2/releases or run:
  `curl -s https://api.github.com/repos/rancher/rke2/releases/latest | jq -r '.tag_name'`
