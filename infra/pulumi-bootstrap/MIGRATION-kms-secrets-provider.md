# Migration: passphrase → AWS KMS secrets provider

This migration moves Pulumi stack config encryption from the default
**passphrase** provider to **AWS KMS** (`awskms://`). After this, you no
longer need `PULUMI_CONFIG_PASSPHRASE` in env — IAM controls decryption.

## Why

- Removes the shared-passphrase footgun (losing it = losing all `secure:` values).
- Ties decryption to AWS IAM, so revoking an operator just means revoking their AWS access.
- One self-managed KMS key for all Pulumi config, everywhere.

## KMS layout (after this change)

| Resource | Encryption |
|----------|-----------|
| Pulumi `secure:` config values | **Customer-managed CMK** `moonrepo-pulumi-config-key` (1 × $1/mo) |
| Pulumi state S3 bucket | AWS-managed SSE-S3 (AES256, free) |
| AWS Secrets Manager entries | AWS-managed `aws/secretsmanager` key (free) |

## Prerequisites

- `pulumi` CLI (≥ 3.x) with AWS creds that have `kms:Encrypt`/`Decrypt` on the new alias.
- The current `PULUMI_CONFIG_PASSPHRASE` for each stack being migrated (needed once during the switch so Pulumi can decrypt existing values and re-encrypt them under KMS).

## One-time migration steps

### 1. Apply the bootstrap change

```bash
cd infra/pulumi-bootstrap
# Confirms the plan: CMK renamed from pulumi-state-key → pulumi-config-key,
# S3 SSE flipped from aws:kms → AES256, Secrets Manager kmsKeyId removed.
pulumi preview
pulumi up
```

Expected diff:

- `aws.kms.Key` replaced (name change is a resource replacement)
- `aws.kms.Alias` replaced
- `aws.s3.BucketServerSideEncryptionConfigurationV2` updated in-place
- `aws.secretsmanager.Secret` × 2 updated in-place (kmsKeyId removed → falls back to AWS-managed key)

> ⚠️ The old CMK enters its 30-day deletion window automatically. Don't cancel the deletion until step 2 is done on every stack.

### 2. Switch each downstream stack's secrets provider

For every `Pulumi.<stack>.yaml` in the repo (currently just `infra/pulumi/Pulumi.prod.yaml`):

```bash
cd infra/pulumi
export PULUMI_CONFIG_PASSPHRASE="<current passphrase for this stack>"

pulumi stack change-secrets-provider \
  "awskms://alias/moonrepo-pulumi-config-key?region=eu-west-2" \
  --stack prod
```

Pulumi will:

1. Decrypt every `secure:` value with the old passphrase.
2. Re-encrypt each under the new KMS key.
3. Remove `encryptionsalt:` from `Pulumi.<stack>.yaml`.
4. Write `secretsprovider: awskms://...` to the stack file.

Repeat for the bootstrap stack itself if it ever grows `secure:` values:

```bash
cd infra/pulumi-bootstrap
export PULUMI_CONFIG_PASSPHRASE="<bootstrap passphrase>"
pulumi stack change-secrets-provider \
  "awskms://alias/moonrepo-pulumi-config-key?region=eu-west-2"
```

### 3. Commit the updated stack files

```bash
git add infra/pulumi/Pulumi.prod.yaml infra/pulumi-bootstrap/Pulumi.yaml
git commit -m "chore(pulumi): migrate stacks to awskms secrets provider"
```

Expected diff per file: `encryptionsalt:` line removed, `secretsprovider:` line added, every `secure:` value's ciphertext changed.

### 4. Unset the passphrase env var

After confirming `pulumi preview` works without `PULUMI_CONFIG_PASSPHRASE`, unset it from any CI secrets, shell profiles, or operator configs. The CMK + IAM is now the only key to the kingdom.

## Rollback

If something goes wrong mid-migration:

1. Re-run `pulumi stack change-secrets-provider passphrase --stack <name>` with the original passphrase to go back.
2. Cancel the old CMK's scheduled deletion: `aws kms cancel-key-deletion --key-id <old-key-id>`.
3. Revert the bootstrap commit.

## Verification

```bash
# Confirm awskms provider is active
grep -r "secretsprovider\|encryptionsalt" infra/*/Pulumi.*.yaml

# Confirm the CMK exists and is enabled
aws kms describe-key --key-id alias/moonrepo-pulumi-config-key --query 'KeyMetadata.KeyState'

# Confirm you can preview without a passphrase
cd infra/pulumi && unset PULUMI_CONFIG_PASSPHRASE && pulumi preview --stack prod
```
