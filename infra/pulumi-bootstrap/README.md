# Pulumi Bootstrap - AWS Backend Setup

This Pulumi stack sets up the AWS infrastructure required to use S3 as the Pulumi state backend instead of Pulumi Cloud. This is a one-time bootstrap stack that creates the foundation for all other infrastructure.

## Purpose

This stack eliminates the dependency on Pulumi Cloud by:
1. Creating an S3 bucket for Pulumi state storage
2. Setting up KMS encryption for state and secrets
3. Creating an IAM user for Pulumi operator authentication
4. Setting up AWS Secrets Manager for sensitive values

## What It Creates

### Storage & Encryption

- **KMS Key** (`moonrepo-pulumi-state-key`)
  - Used for encrypting both S3 state and Secrets Manager secrets
  - Automatic key rotation enabled
  - 30-day deletion window for safety

- **S3 Bucket** (`moonrepo-pulumi-state-{account-id}`)
  - Stores Pulumi state files (replaces Pulumi Cloud)
  - Encrypted with KMS key
  - Versioning enabled for state history
  - Public access blocked
  - Lifecycle policy: Delete old versions after 90 days

### IAM User & Permissions

- **IAM User** (`pulumi-deployer`)
  - Service account for Pulumi operator
  - Access key stored in AWS Secrets Manager
  - Used by Pulumi operator to read/write state from S3

- **IAM Policy** (`pulumi-deployer-policy`)
  - S3 bucket access (read/write state files)
  - KMS key access (encrypt/decrypt state)

- **IAM Policy** (`moonrepo-secrets-access-policy`)
  - Secrets Manager access (read secrets for sealing)
  - KMS key access (decrypt secrets)

### AWS Secrets Manager

- **cloudflare-api-token-pulumi** (`moonrepo/cloudflare-api-token-pulumi`)
  - Cloudflare master token for creating restricted tokens
  - KMS encrypted
  - Created empty (must be populated manually)
  - 30-day recovery window

- **pulumi-aws-credentials** (`moonrepo/pulumi-aws-credentials`)
  - AWS access keys for Pulumi operator
  - Auto-populated with IAM user credentials
  - KMS encrypted
  - Used by Pulumi operator to access S3 backend

## State Backend

**This stack uses LOCAL state** because it's the bootstrap stack:

```
Backend: Local filesystem (Pulumi.prod.yaml)
Purpose: Create the S3 backend for other stacks
```

After running this stack, all other stacks (including `infra/pulumi`) use the S3 backend.

## Architecture

```
pulumi-bootstrap (local state)
    ↓ Creates
AWS Resources:
  ├─ KMS Key (encryption)
  ├─ S3 Bucket (state storage)
  ├─ IAM User (authentication)
  │   └─ Access Keys → AWS Secrets Manager
  └─ Secrets Manager
      ├─ cloudflare-api-token-pulumi (empty, set manually)
      └─ pulumi-aws-credentials (auto-populated)
```

## Initial Setup

### 1. Deploy the Bootstrap Stack

```bash
cd infra/pulumi-bootstrap

# Preview changes
moon run pulumi-bootstrap:preview

# Deploy
moon run pulumi-bootstrap:up
```

This creates all AWS resources and outputs important values.

### 2. Note the Outputs

```bash
pulumi stack output
```

Key outputs:
- `pulumiLoginCommand`: Command to migrate main stack to S3
- `stateBucketName`: S3 bucket name for state storage
- `kmsKeyArn`: KMS key ARN for encryption
- `pulumiAccessKeyId`: IAM user access key (also in Secrets Manager)

### 3. Set Cloudflare Token

The Cloudflare secret is created empty. Populate it:

```bash
cd ../secrets
./set-secret.sh cloudflare-api-token-pulumi "your-cloudflare-token"
```

Get a token from: https://dash.cloudflare.com/profile/api-tokens

Required permissions:
- **Account.Account Settings:Read**
- **Zone.Zone:Read**
- **User.API Tokens:Edit**

### 4. Migrate Main Stack to S3

```bash
cd ../pulumi

# Login to S3 backend (use the command from stack output)
pulumi login s3://moonrepo-pulumi-state-{account-id}?region=eu-west-2

# Verify stack is accessible
pulumi stack ls
```

### 5. Sync Secrets to Kubernetes

```bash
cd ../secrets

# Fetch secrets from AWS and generate SealedSecrets
./sync-secrets.sh

# Commit sealed secrets to git
git add sealed/
git commit -m "add sealed secrets"
git push
```

## Files

```
infra/pulumi-bootstrap/
├── index.ts              # Main Pulumi program
├── Pulumi.yaml          # Project configuration
├── Pulumi.prod.yaml     # Stack configuration (local state)
├── package.json         # Node.js dependencies
├── moon.yml             # Moon task configuration
└── tsconfig.json        # TypeScript configuration
```

### Key Files

- **index.ts**: Creates all AWS resources (S3, KMS, IAM, Secrets Manager)
- **Pulumi.yaml**: Defines project name and runtime
- **Pulumi.prod.yaml**: Stack config (uses local state, not S3)

## Configuration

Minimal configuration required:

```yaml
# Pulumi.prod.yaml
config:
  aws:region: eu-west-2  # AWS region for resources
```

All other values are hardcoded or derived:
- Prefix: `moonrepo`
- Bucket name: `moonrepo-pulumi-state-{account-id}` (auto-generated)
- User name: `pulumi-deployer`

## Outputs

The stack exports these values:

```typescript
export const kmsKeyArn = kmsKey.arn;
export const kmsKeyAliasName = kmsKeyAlias.name;
export const stateBucketName = stateBucket.bucket;
export const stateBucketArn = stateBucket.arn;
export const pulumiUserArn = pulumiUser.arn;
export const pulumiAccessKeyId = pulumiAccessKey.id;
export const pulumiSecretAccessKey = pulumi.secret(pulumiAccessKey.secret);
export const awsCredentialsSecretArn = awsCredentialsSecret.arn;
export const cloudflareApiTokenSecretArn = cloudflareApiTokenSecret.arn;
export const pulumiLoginCommand = pulumi.interpolate`pulumi login s3://${stateBucket.bucket}?region=eu-west-2`;
```

View outputs:
```bash
pulumi stack output
```

The `pulumiSecretAccessKey` is marked as secret and won't be displayed. Access it from AWS Secrets Manager instead.

## Resource Details

### S3 Bucket Configuration

```typescript
{
  versioning: "Enabled",           // State history
  publicAccess: "Blocked",         // No public access
  encryption: "aws:kms",           // KMS encryption
  lifecycleRules: [
    {
      noncurrentVersionExpiration: "90 days"  // Cleanup old versions
    }
  ]
}
```

### KMS Key Configuration

```typescript
{
  description: "KMS key for Pulumi state bucket encryption",
  deletionWindowInDays: 30,       // Safety window before deletion
  enableKeyRotation: true          // Automatic key rotation
}
```

### IAM User Permissions

The `pulumi-deployer` user has two policies attached:

1. **pulumi-deployer-policy**: S3 and KMS access
   - `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`
   - `s3:ListBucket`, `s3:GetBucketLocation`
   - `kms:Encrypt`, `kms:Decrypt`, `kms:GenerateDataKey`

2. **moonrepo-secrets-access-policy**: Secrets Manager access
   - `secretsmanager:GetSecretValue`, `secretsmanager:DescribeSecret`
   - `kms:Decrypt`, `kms:DescribeKey`

## Security Considerations

### Encryption

- All secrets encrypted with KMS key
- S3 state encrypted at rest with KMS
- Bucket key enabled for cost efficiency
- Automatic key rotation for compliance

### Access Control

- IAM user has minimal required permissions
- No public access to S3 bucket
- Secrets have 30-day recovery window
- Access keys stored in Secrets Manager (not displayed)

### State Management

- Versioning prevents accidental state loss
- Old versions cleaned up after 90 days
- Local state for bootstrap stack (no circular dependency)
- Force destroy disabled (protects against accidental deletion)

## Updating the Stack

To update AWS resources:

```bash
cd infra/pulumi-bootstrap

# Preview changes
moon run pulumi-bootstrap:preview

# Apply changes
moon run pulumi-bootstrap:up
```

**Warning**: Changes to this stack can affect all other infrastructure. Test carefully.

## Destroying Resources

**Do NOT destroy this stack unless you're completely removing the infrastructure.**

If you destroy this stack:
- S3 bucket with state will be deleted
- All other stacks will lose their state
- Secrets will be scheduled for deletion (30-day recovery window)
- KMS key will be scheduled for deletion (30-day deletion window)

To destroy (use with extreme caution):

```bash
moon run pulumi-bootstrap:destroy
```

To recover from accidental deletion:
1. Secrets and KMS key can be recovered within 30 days
2. S3 bucket versioning may allow state recovery
3. IAM resources can be recreated

## Common Tasks

### Viewing Secrets

```bash
# List all secrets
aws secretsmanager list-secrets

# Get Cloudflare token
aws secretsmanager get-secret-value --secret-id moonrepo/cloudflare-api-token-pulumi

# Get AWS credentials (for Pulumi operator)
aws secretsmanager get-secret-value --secret-id moonrepo/pulumi-aws-credentials
```

### Rotating Access Keys

```bash
cd infra/pulumi-bootstrap

# Recreate the access key
pulumi up --target aws:iam/accessKey:AccessKey::pulumi-deployer-access-key

# The new key is automatically stored in Secrets Manager
# Sync to Kubernetes
cd ../secrets
./sync-secrets.sh
git add sealed/ && git commit -m "rotate aws access key" && git push
```

### Checking S3 State

```bash
# List state files
aws s3 ls s3://moonrepo-pulumi-state-{account-id}/

# View state file versions
aws s3api list-object-versions --bucket moonrepo-pulumi-state-{account-id}
```

## Troubleshooting

### "Bucket already exists" error

If the bucket was previously created:
```bash
# Import existing bucket
pulumi import aws:s3/bucketV2:BucketV2 moonrepo-pulumi-state moonrepo-pulumi-state-{account-id}
```

### "Secret already exists" error

If secrets were manually created:
```bash
# Import existing secrets
pulumi import aws:secretsmanager/secret:Secret cloudflare-api-token-pulumi moonrepo/cloudflare-api-token-pulumi
pulumi import aws:secretsmanager/secret:Secret pulumi-aws-credentials moonrepo/pulumi-aws-credentials
```

### Access denied to S3 bucket

Verify IAM user has correct policy:
```bash
aws iam list-attached-user-policies --user-name pulumi-deployer
```

### KMS key access denied

Check KMS key policy allows the IAM user:
```bash
aws kms describe-key --key-id alias/moonrepo-pulumi-state-key
```

## Related Documentation

- [Pulumi Stack](../pulumi/README.md) - Main Pulumi stack using S3 backend
- [Secrets Management](../secrets/README.md) - How to manage secrets
- [Infrastructure Overview](../README.md) - Overall architecture
- [Main README](../../README.md) - Project overview
