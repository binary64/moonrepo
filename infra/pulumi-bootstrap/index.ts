import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const prefix = "moonrepo";

// Get current AWS account ID for unique bucket naming
const callerIdentity = aws.getCallerIdentity({});
const accountId = callerIdentity.then((id) => id.accountId);

// KMS key for S3 bucket encryption
const kmsKey = new aws.kms.Key(`${prefix}-pulumi-state-key`, {
  description: "KMS key for Pulumi state bucket encryption",
  deletionWindowInDays: 30,
  enableKeyRotation: true,
});

const kmsKeyAlias = new aws.kms.Alias(`${prefix}-pulumi-state-key-alias`, {
  name: `alias/${prefix}-pulumi-state-key`,
  targetKeyId: kmsKey.keyId,
});

// S3 bucket for Pulumi state
const stateBucket = new aws.s3.BucketV2(`${prefix}-pulumi-state`, {
  bucket: pulumi.interpolate`${prefix}-pulumi-state-${accountId}`,
  forceDestroy: false,
});

// Block all public access
const stateBucketPublicAccessBlock = new aws.s3.BucketPublicAccessBlock(
  `${prefix}-pulumi-state-public-access-block`,
  {
    bucket: stateBucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
  }
);

// Enable versioning for state history
const stateBucketVersioning = new aws.s3.BucketVersioningV2(
  `${prefix}-pulumi-state-versioning`,
  {
    bucket: stateBucket.id,
    versioningConfiguration: {
      status: "Enabled",
    },
  }
);

// Server-side encryption with KMS
const stateBucketEncryption = new aws.s3.BucketServerSideEncryptionConfigurationV2(
  `${prefix}-pulumi-state-encryption`,
  {
    bucket: stateBucket.id,
    rules: [
      {
        applyServerSideEncryptionByDefault: {
          sseAlgorithm: "aws:kms",
          kmsMasterKeyId: kmsKey.arn,
        },
        bucketKeyEnabled: true,
      },
    ],
  }
);

// Lifecycle rule to delete old versions after 90 days
const stateBucketLifecycle = new aws.s3.BucketLifecycleConfigurationV2(
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
  }
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
            Sid: "PulumiStateKMSAccess",
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
      })
    ),
});

// Attach policy to user
const pulumiUserPolicyAttachment = new aws.iam.UserPolicyAttachment(
  "pulumi-deployer-policy-attachment",
  {
    user: pulumiUser.name,
    policyArn: pulumiPolicy.arn,
  }
);

// Create access key for the IAM user
const pulumiAccessKey = new aws.iam.AccessKey("pulumi-deployer-access-key", {
  user: pulumiUser.name,
});

// Outputs
export const kmsKeyArn = kmsKey.arn;
export const kmsKeyAliasName = kmsKeyAlias.name;
export const stateBucketName = stateBucket.bucket;
export const stateBucketArn = stateBucket.arn;
export const pulumiUserArn = pulumiUser.arn;
export const pulumiAccessKeyId = pulumiAccessKey.id;
export const pulumiSecretAccessKey = pulumi.secret(pulumiAccessKey.secret);

// Convenience output for pulumi login command
export const pulumiLoginCommand = pulumi.interpolate`pulumi login s3://${stateBucket.bucket}?region=eu-west-2`;
