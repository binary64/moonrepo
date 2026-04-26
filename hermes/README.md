# Hermes Agent Integration

This directory holds everything needed for the **Hermes agent** (running on
the **jupiter** host — a Contabo VPS joined to the cluster as a
storage-tainted RKE2 worker in zone `contabo-portsmouth`) to integrate with
moonrepo infra. Hermes runs as the `hermes` user on jupiter; because jupiter
is a cluster member, it can reach any ClusterIP/pod directly via flannel — no
VPN needed.

## Host topology

| Name | Role | Notes |
|------|------|-------|
| `jupiter` | Contabo VPS, RKE2 worker (storage) | This host. Runs hermes. `hostname -f` / DNS TBD. |
| `master` | NUC at home, RKE2 control plane | Server URL stored in operator runbook (private). |
| `pluto`  | Contabo VPS, OpenClaw for a family member | Has an encrypted disk pending migration to jupiter. |

## What lives here

| Path | Purpose |
|------|---------|
| `skills/` | Hermes skills committed to IaC (source of truth). Synced into `~/.hermes/skills/` by `bootstrap-env.sh`. |
| `bootstrap-env.sh` | Host-side bootstrap: pulls secrets from AWS Secrets Manager, writes a 0600 env file, and symlinks skills. Idempotent. |
| `env.template` | Reference list of env vars hermes consumes. |

## Secret flow (current: host-side)

```
AWS Secrets Manager (moonrepo/hermes-*)
    ↓ (bootstrap-env.sh via aws CLI)
/home/hermes/.hermes/.env  (0600, gitignored, never leaves host)
    ↓
hermes agent picks up env on next reload
```

No secret material is ever committed to git. The script fails loudly if AWS
creds are missing.

## Secret flow (future: in-cluster)

Once hermes is migrated to a Deployment in the `hermes-system` namespace, the
same secrets will be surfaced as a SealedSecret via
`infra/secrets/sync-secrets.sh` (already extended — see `hermes-secrets.yaml`
under `infra/secrets/sealed/` once generated).

## Adding a new secret

1. Store the value in AWS Secrets Manager (creates if absent, updates if present):
   ```bash
   cd infra/secrets
   ./set-secret.sh hermes-<name> "<value>"
   ```
   The secret lands at `moonrepo/hermes-<name>`. See
   `infra/secrets/README.md` for the full secret catalogue.
2. Register the key in the `HERMES_SECRETS` associative array in
   `hermes/bootstrap-env.sh`:
   ```bash
   declare -A HERMES_SECRETS=(
     [HASS_TOKEN]="hermes-ha-token"
     [NEW_VAR]="hermes-<name>"   # ← add this line
   )
   ```
3. (Future, once hermes is in-cluster) add a matching `stringData` entry to the
   hermes block in `infra/secrets/sync-secrets.sh` so the SealedSecret is
   regenerated. Not required while hermes runs host-side.
4. Commit, push, merge, then on jupiter:
   ```bash
   cd ~/moonrepo && git pull && ./hermes/bootstrap-env.sh
   ```

## Connectivity reference

From jupiter as `hermes`:

- Cluster DNS: `10.43.0.10:53`
- Home Assistant: `http://home-assistant.home-assistant.svc.cluster.local:8123`
- Headscale: `http://headscale.headscale.svc.cluster.local:8080`
- Any `*.home.brandwhisper.cloud` also resolves publicly via Cloudflare.

## PII policy

The owner of this repo wants **zero PII** committed here. Commits from hermes
MUST use the noreply identity (`binary64 <binary64@users.noreply.github.com>`).
Do not add real names, personal emails, DOB, or physical addresses to any file
in this tree.
