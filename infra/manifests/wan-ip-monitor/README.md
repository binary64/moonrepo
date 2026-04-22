# WAN IP Monitor

CronJob that monitors the home public IP and automatically updates all
WAN-dependent infrastructure when it changes.

## What It Does

When the WAN IP changes (Vodafone reassigns it), this monitor:

1. Logs an event to New Relic (for alerting/history)
2. Updates Cloudflare DNS records:
   - `headscale.brandwhisper.cloud` → new IP
   - `*.home.brandwhisper.cloud` → new IP
3. Patches the `rke2-config` ConfigMap (for RKE2 server config)
4. Patches the Istio Gateway address (`istio-system/gateway`)
5. Patches the external-dns `home-network` secret

## Manual Trigger After NUC Boot

After powering the NUC on, run this to immediately patch all resources
(instead of waiting 5 minutes for the next scheduled run):

```bash
# Create a one-off job from the CronJob
kubectl create job --from=cronjob/wan-ip-monitor wan-ip-manual-$(date +%s) -n newrelic

# Wait for it to finish
kubectl wait --for=condition=complete job/wan-ip-manual-XXXXX -n newrelic --timeout=60s
```

Or use the helper script:
```bash
./infra/manifests/wan-ip-monitor/bootstrap.sh
```

## Secrets Required

| Secret | Namespace | Key | Purpose |
|--------|-----------|-----|---------|
| `newrelic-secret` | newrelic | `licenseKey` | New Relic API key |
| `cloudflare-token` | newrelic | `apiToken` | Cloudflare DNS edits |
| (sealed) | | | |

## RBAC

The `wan-ip-monitor` ServiceAccount has permission to:
- Update `rke2-config` ConfigMap in `default` namespace
- Patch `gateway` Gateway in `istio-system` namespace
- Patch `home-network` Secret in `external-dns` namespace

## After IP Change

Once the monitor runs (automatically or manually):

1. ✅ DNS records updated in Cloudflare
2. ✅ RKE2 ConfigMap patched
3. ✅ Istio Gateway address patched
4. ✅ external-dns secret patched

**Final step (required):** Restart RKE2 on the NUC to pick up the new config:
```bash
./infra/manifests/rke2-config/apply-rke2-config.sh --restart
```

## Configuration

- **Schedule:** Every 5 minutes (`*/5 * * * *`)
- **NR Account ID:** `6794449` (from `wan-ip-monitor-config` ConfigMap)
- **Cloudflare Zone:** `ecb09a98b97ba002587403424405610f` (brandwhisper.cloud)

## Files

- `configmap.yaml` — shell script (check-wan-ip.sh)
- `cronjob.yaml` — CronJob definition
- `rbac.yaml` — ServiceAccount + Role + RoleBinding
- `config.yaml` — NR account ID ConfigMap
- `bootstrap.sh` — manual trigger helper
