import * as pulumi from "@pulumi/pulumi";
import * as cloudflare from "@pulumi/cloudflare";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();
const domain = "brandwhisper.cloud";

// Look up the Cloudflare zone
const zone = cloudflare.getZoneOutput({ name: domain });

// Create an API token scoped for DNS editing (for cert-manager DNS-01 challenge)
const certManagerToken = new cloudflare.ApiToken("cert-manager-dns-token", {
  name: "cert-manager-dns-token",
  policies: [
    {
      // DNS Edit permission for the zone
      permissionGroups: [
        "4755a26eedb94da69e1066d98aa820be", // Zone DNS Write
      ],
      resources: {
        // Scope to specific zone
        [`com.cloudflare.api.account.zone.${zone.zoneId}`]: "*",
      },
    },
    {
      // Zone Read permission (required for DNS-01)
      permissionGroups: [
        "c8fed203ed3043cba015a93ad1616f1f", // Zone Read
      ],
      resources: {
        [`com.cloudflare.api.account.zone.${zone.zoneId}`]: "*",
      },
    },
  ],
});

// Create K8s provider for the prod cluster
const k8sProvider = new k8s.Provider("prod", {
  context: "prod",
});

// Create the secret in cert-manager namespace for DNS-01 solver
const certManagerSecret = new k8s.core.v1.Secret(
  "cloudflare-api-token-cert-manager",
  {
    metadata: {
      name: "cloudflare-api-token",
      namespace: "cert-manager",
    },
    type: "Opaque",
    stringData: {
      "api-token": certManagerToken.value,
    },
  },
  { provider: k8sProvider }
);

// Create the secret in external-dns namespace (for DNS record management)
const externalDnsSecret = new k8s.core.v1.Secret(
  "cloudflare-api-token-external-dns",
  {
    metadata: {
      name: "cloudflare-api-token",
      namespace: "external-dns",
    },
    type: "Opaque",
    stringData: {
      "api-token": certManagerToken.value,
    },
  },
  { provider: k8sProvider }
);

// Exports
export const zoneId = zone.zoneId;
export const tokenId = certManagerToken.id;
