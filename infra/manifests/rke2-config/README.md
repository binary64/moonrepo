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
