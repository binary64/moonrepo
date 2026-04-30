import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const prefix = "moonrepo";

// Get current AWS account ID for unique bucket naming
const callerIdentity = aws.getCallerIdentity({});
const accountId = callerIdentity.then((id) => id.accountId);

// KMS key used as Pulumi's secrets provider (awskms://) for encrypting
// `secure:` config values in Pulumi.<stack>.yaml files across all stacks.
// S3 bucket and Secrets Manager use AWS-managed encryption (free, no CMK).
const kmsKey = new aws.kms.Key(`${prefix}-pulumi-config-key`, {
  description: "KMS key for Pulumi stack config encryption (secrets provider)",
  deletionWindowInDays: 30,
  enableKeyRotation: true,
});

const kmsKeyAlias = new aws.kms.Alias(`${prefix}-pulumi-config-key-alias`, {
  name: `alias/${prefix}-pulumi-config-key`,
  targetKeyId: kmsKey.keyId,
});

// S3 bucket for Pulumi state
const stateBucket = new aws.s3.BucketV2(`${prefix}-pulumi-state`, {
  bucket: pulumi.interpolate`${prefix}-pulumi-state-${accountId}`,
  forceDestroy: false,
});

// Block all public access
const _stateBucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock(
  `${prefix}-pulumi-state-public-access-block`,
  {
    bucket: stateBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  },
);

// Enable versioning for state history
const _stateBucketVersioning = new aws.s3.BucketVersioningV2(
  `${prefix}-pulumi-state-versioning`,
  {
    bucket: stateBucket.id,
    versioningConfiguration: {
      status: "Enabled",
    },
  },
);

// Server-side encryption: AWS-managed SSE-S3 (AES256, free, no CMK).
// The secret material in Pulumi state is already encrypted client-side by
// the awskms:// secrets provider, so SSE-S3 is sufficient as defence-in-depth.
const _stateBucketEncryption =
  new aws.s3.BucketServerSideEncryptionConfigurationV2(
    `${prefix}-pulumi-state-encryption`,
    {
      bucket: stateBucket.id,
      rules: [
        {
          applyServerSideEncryptionByDefault: {
            sseAlgorithm: "AES256",
          },
        },
      ],
    },
  );

// Lifecycle rule to delete old versions after 90 days
const _stateBucketLifecycle = new aws.s3.BucketLifecycleConfigurationV2(
  `${prefix}-pulumi-state-lifecycle`,
  {
    bucket: stateBucket.id,
    rules: [
      {
        id: "delete-old-versions",
        status: "Enabled",
        noncurrentVersionExpiration: {
          noncurrentDays: 90,
        },
      },
    ],
  },
);

// IAM user for Pulumi deployments
const pulumiUser = new aws.iam.User("pulumi-deployer", {
  name: "pulumi-deployer",
});

// IAM policy for Pulumi deployer
const pulumiPolicy = new aws.iam.Policy("pulumi-deployer-policy", {
  name: "pulumi-deployer-policy",
  description: "Policy for Pulumi deployer to manage state and resources",
  policy: pulumi
    .all([stateBucket.arn, kmsKey.arn])
    .apply(([bucketArn, kmsArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "PulumiStateBucketAccess",
            Effect: "Allow",
            Action: [
              "s3:GetObject",
              "s3:PutObject",
              "s3:DeleteObject",
              "s3:ListBucket",
              "s3:GetBucketLocation",
            ],
            Resource: [bucketArn, `${bucketArn}/*`],
          },
          {
            Sid: "PulumiConfigKMSAccess",
            Effect: "Allow",
            Action: [
              "kms:Encrypt",
              "kms:Decrypt",
              "kms:GenerateDataKey",
              "kms:DescribeKey",
            ],
            Resource: [kmsArn],
          },
        ],
      }),
    ),
});

// Attach policy to user
const _pulumiUserPolicyAttachment = new aws.iam.UserPolicyAttachment(
  "pulumi-deployer-policy-attachment",
  {
    user: pulumiUser.name,
    policyArn: pulumiPolicy.arn,
  },
);

// Create access key for the IAM user
const pulumiAccessKey = new aws.iam.AccessKey("pulumi-deployer-access-key", {
  user: pulumiUser.name,
});

// Secrets Manager for storing sensitive values.
// Encrypted with the AWS-managed default key (`aws/secretsmanager`, free),
// NOT the customer-managed CMK above — that CMK is reserved exclusively for
// the pulumi awskms:// secrets provider. One self-managed KMS, one purpose.

const cloudflareApiTokenSecret = new aws.secretsmanager.Secret(
  "cloudflare-api-token-pulumi",
  {
    name: `${prefix}/cloudflare-api-token-pulumi`,
    description: "Cloudflare API token for Pulumi to create restricted tokens",
    recoveryWindowInDays: 30,
  },
);

// AWS credentials secret for Pulumi operator to access S3 backend
const awsCredentialsSecret = new aws.secretsmanager.Secret(
  "pulumi-aws-credentials",
  {
    name: `${prefix}/pulumi-aws-credentials`,
    description:
      "AWS credentials for Pulumi operator to access S3 state backend",
    recoveryWindowInDays: 30,
  },
);

// Store the pulumi-deployer access keys in Secrets Manager
const _awsCredentialsSecretVersion = new aws.secretsmanager.SecretVersion(
  "pulumi-aws-credentials-version",
  {
    secretId: awsCredentialsSecret.id,
    secretString: pulumi.jsonStringify({
      "access-key-id": pulumiAccessKey.id,
      "secret-access-key": pulumiAccessKey.secret,
    }),
  },
);

// Note: Cloudflare token must be set manually using set-secret.sh script
// aws secretsmanager put-secret-value --secret-id moonrepo/cloudflare-api-token-pulumi --secret-string "xxx"

// IAM policy for secrets access (can be used by CI/CD or operators).
// No kms:Decrypt needed — Secrets Manager uses the AWS-managed key and grants
// implicit decrypt permission to callers with secretsmanager:GetSecretValue.
const secretsAccessPolicy = new aws.iam.Policy("secrets-access-policy", {
  name: "moonrepo-secrets-access-policy",
  description: "Policy for accessing moonrepo secrets in Secrets Manager",
  policy: pulumi
    .all([cloudflareApiTokenSecret.arn, awsCredentialsSecret.arn])
    .apply(([cloudflareSecretArn, awsCredsSecretArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "ReadSecrets",
            Effect: "Allow",
            Action: [
              "secretsmanager:GetSecretValue",
              "secretsmanager:DescribeSecret",
            ],
            Resource: [cloudflareSecretArn, awsCredsSecretArn],
          },
        ],
      }),
    ),
});

// Attach secrets policy to pulumi user (so they can read secrets for sealing)
const _pulumiUserSecretsAttachment = new aws.iam.UserPolicyAttachment(
  "pulumi-deployer-secrets-attachment",
  {
    user: pulumiUser.name,
    policyArn: secretsAccessPolicy.arn,
  },
);

// Outputs
export const kmsKeyArn = kmsKey.arn;
export const kmsKeyAliasName = kmsKeyAlias.name;
export const stateBucketName = stateBucket.bucket;
export const stateBucketArn = stateBucket.arn;
export const pulumiUserArn = pulumiUser.arn;
export const pulumiAccessKeyId = pulumiAccessKey.id;
export const pulumiSecretAccessKey = pulumi.secret(pulumiAccessKey.secret);
export const awsCredentialsSecretArn = awsCredentialsSecret.arn;
export const cloudflareApiTokenSecretArn = cloudflareApiTokenSecret.arn;

// Convenience output for pulumi login command
export const pulumiLoginCommand = pulumi.interpolate`pulumi login s3://${stateBucket.bucket}?region=eu-west-2`;
