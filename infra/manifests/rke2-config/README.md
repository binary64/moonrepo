# RKE2 Config Management

This directory contains the GitOps-managed RKE2 configuration for the NUC
(home lab master node).

**The WAN IP is NOT stored in Git.** It is managed dynamically by the
`wan-ip-monitor` CronJob, which patches this ConfigMap whenever the home
public IP changes.

## Components

| File | Purpose |
|------|---------|
| `configmap.yaml` | ConfigMap holding the RKE2 `config.yaml` contents |
| `apply-rke2-config.sh` | Script to sync ConfigMap → NUC host filesystem & restart RKE2 |
| `bootstrap.sh` | One-time setup (ArgoCD Application + initial apply) |
| `README.md` | This file |

## How It Works

1. **Source of truth:** `configmap.yaml` contains the RKE2 config. The
   `advertise-address`, `node-external-ip`, and `tls-san` fields are set to
   `REPLACE_WITH_WAN_IP` — this placeholder is replaced by the WAN IP monitor.

2. **Auto-update:** The `wan-ip-monitor` CronJob (runs every 5 min on NUC)
   detects WAN IP changes and patches this ConfigMap automatically with the
   current public IP.

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
2. New Relic event is logged
3. Cloudflare DNS records updated (`headscale` + `*.home.brandwhisper.cloud`)
4. **This ConfigMap is patched** with the new IP
5. **Istio Gateway address is patched** (no manual edit needed)
6. **external-dns `home-network` secret is patched** (no manual edit needed)
7. **Manual step:** Run `apply-rke2-config.sh --restart` on the NUC
8. After RKE2 restarts, the cluster becomes reachable via the new IP

## Bootstrap (First-Time Setup)

After NUC is powered on and cluster is accessible:

```bash
# 1. Seal the cloudflare-token secret (token from passwords sheet)
cd infra/manifests/cloudflare-token
kubectl create secret generic cloudflare-token \
  --namespace=newrelic \
  --from-literal=apiToken='YOUR_TOKEN' \
  --dry-run=client -o yaml \
| kubeseal --controller-namespace sealed-secrets --format yaml \
  > secret-sealed.yaml
git add secret-sealed.yaml && git commit -m "seal cloudflare-token" && git push

# 2. Seal the home-network secret (current WAN IP)
cd infra/manifests/external-dns
kubectl create secret generic home-network \
  --namespace=external-dns \
  --from-literal=public-ip='CURRENT_WAN_IP' \
  --dry-run=client -o yaml \
| kubeseal --controller-namespace sealed-secrets --format yaml \
  > sealed-home-network.yaml
git add sealed-home-network.yaml && git commit -m "seal home-network secret" && git push

# 3. Deploy everything (ArgoCD will sync)
# Wait for pods to be ready, then:

# 4. Apply RKE2 config to NUC
./infra/manifests/rke2-config/apply-rke2-config.sh --restart

# 5. Verify
dig +short home.brandwhisper.cloud  # should return current WAN IP
kubectl get nodes
```

## Notes

- **No hardcoded IPs in Git** — all WAN-dependent resources are patched at
  runtime by the WAN IP monitor. The placeholder `REPLACE_WITH_WAN_IP` is
  replaced automatically.
- The NUC must be powered on and reachable on the LAN for `apply-rke2-config.sh`
  to work (SSH to 192.168.1.201).
- Router port forwards (9345 TCP, 6443 TCP) must point to the NUC's current LAN IP.
- If the NUC's LAN IP also changes (DHCP), update SSH target or use a static DHCP lease.
