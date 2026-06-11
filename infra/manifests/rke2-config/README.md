# RKE2 Config Management

This directory contains the GitOps-managed RKE2 configuration for the NUC
(home lab master node).

## Components

| File | Purpose |
|------|---------|
| `configmap.yaml` | ConfigMap holding the RKE2 `config.yaml` contents |
| `apply-rke2-config.sh` | Script to sync ConfigMap → NUC host filesystem & restart RKE2 |

## How It Works

1. **Source of truth:** `configmap.yaml` contains the RKE2 config, including the
   current WAN IP in `advertise-address`, `node-external-ip`, and `tls-san`.

2. **Auto-update:** The WAN IP monitor (CronJob in `wan-ip-monitor/`) watches
   the home public IP. When it changes, it updates this ConfigMap automatically
   via `kubectl create configmap ... -o yaml --dry-run=client | kubectl apply -f -`.

3. **Apply to NUC:** The NUC's RKE2 reads `/etc/rancher/rke2/config.yaml` at
   startup. After the ConfigMap updates, run `apply-rke2-config.sh` on the NUC
   to copy the new config and restart RKE2:

   ```bash
   # From any machine with kubectl + SSH access to NUC:
   ./apply-rke2-config.sh --restart
   ```

   Or manually on the NUC:
   ```bash
   sudo systemctl restart rke2-server
   ```

## WAN IP Change Flow

When Vodafone assigns a new public IP:

1. WAN IP monitor detects change (runs every 5 min on NUC)
2. New Relic event is sent (for alerting/history)
3. Cloudflare DNS records are updated:
   - `headscale.brandwhisper.cloud` → new IP
   - `*.home.brandwhisper.cloud` → new IP
4. RKE2 ConfigMap is updated with new `advertise-address` / `node-external-ip`
5. **Manual step:** Run `apply-rke2-config.sh --restart` on the NUC
6. After RKE2 restarts, the cluster becomes reachable again via the new IP

## Notes

- The NUC must be powered on and reachable on the LAN for `apply-rke2-config.sh`
  to work (SSH to 192.168.1.201).
- Router port forwards (9345 TCP, 6443 TCP) must point to the NUC's current LAN IP.
- If the NUC's LAN IP also changes (DHCP), update the SSH command or add a
  mDNS/static lease.

## Control-Plane Resource Protection (etcd starvation fix)

**Context:** The NUC is a 4-core / 12GB box co-hosting ~79 pods including several
databases (Percona XtraDB for Nextcloud, Postgres for authentik + hasura) whose
disk fsyncs share the same local-path disk as etcd's WAL. Under load, etcd WAL
commits queue behind those database writes, producing `apply request took too
long` (1.5–2s) warnings; lease renewals then time out and the scheduler /
controller-manager / cloud-controller-manager lose leader election and enter
CrashLoopBackOff. Full diagnosis: `projects/radio/control-plane-incidents.md`.

**Durable fix (this commit):** `kube-reserved` / `system-reserved` +
`eviction-hard` in the RKE2 config carve guaranteed CPU/memory headroom for the
OS, kubelet, and control plane, and set a hard memory eviction floor so the
kubelet sheds Burstable pods *before* the kernel OOM-killer can reach etcd.
Reservations are deliberately modest — the node is already ~88% CPU-requested /
~86% mem-used, so over-reserving would drop allocatable below current pod
requests and wedge rescheduling. **Requires an RKE2 restart to take effect:**

```bash
./apply-rke2-config.sh --restart   # syncs ConfigMap → NUC, restarts rke2-server
```

⚠️ The restart briefly bounces the control plane — run it when nobody's
mid-listen on the radio and no deploy is in flight.

**Immediate relief (no restart, run on the NUC tonight):** give etcd's WAL fsync
I/O priority over the co-located databases. This is the disk-contention-specific
stopgap until the reservation change is applied; it resets when the etcd static
pod respawns, so it's a bridge, not the fix:

```bash
# On the NUC (192.168.1.201):
sudo ionice -c2 -n0 -p "$(pgrep -x etcd)"   # best-effort I/O, highest priority
sudo renice -n -10 -p "$(pgrep -x etcd)"    # modest CPU priority bump
```

**Verify after either step** — slow-apply warnings should drop toward <200ms:

```bash
kubectl logs -n kube-system etcd-master --since=60s | grep -c "took too long"
kubectl get pods -n kube-system | grep -E "scheduler|controller-manager"  # restart counts should freeze
```
