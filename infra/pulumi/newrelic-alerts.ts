/**
 * New Relic alert resources managed via Pulumi.
 *
 * Setup (one-time, before `pulumi up`):
 *   pulumi config set newrelic-account-id <account-id>
 *   pulumi config set --secret newrelic-api-key <user-api-key>
 *   pulumi config set --secret newrelic-notify-email <email>
 *
 * The New Relic infrastructure agent (nri-bundle) is deployed as a DaemonSet on
 * the cluster.  It emits `SystemSample` events for every node, including the NUC
 * (hostname: "master").  When those events stop arriving for ≥10 minutes we open
 * an incident and send an email.
 */

import * as newrelic from "@pulumi/newrelic";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();

const nrAccountId = config.require("newrelic-account-id");
// config.requireSecret is the primary source; fall back to the NEW_RELIC_API_KEY
// env var injected by the Pulumi Operator (via stack.yaml envRefs) so both
// local `pulumi up` (with `pulumi config set --secret`) and the in-cluster
// operator work without extra glue.
const nrApiKey = process.env.NEW_RELIC_API_KEY
  ? pulumi.secret(process.env.NEW_RELIC_API_KEY)
  : config.requireSecret("newrelic-api-key");
const nrNotifyEmail = config.requireSecret("newrelic-notify-email");

// ─── Provider ────────────────────────────────────────────────────────────────

const nrProvider = new newrelic.Provider("newrelic", {
  apiKey: nrApiKey,
  accountId: nrAccountId,
  region: "US",
});

// ─── Alert Policy ─────────────────────────────────────────────────────────────

const nucOfflinePolicy = new newrelic.AlertPolicy(
  "moonrepo-nuc-offline-policy",
  {
    name: "NUC Offline",
    // Open one incident per policy (aggregate multiple conditions if added later)
    incidentPreference: "PER_CONDITION_AND_TARGET",
  },
  { provider: nrProvider, protect: true },
);

// ─── NRQL Alert Condition (lost-signal / expiration) ─────────────────────────
//
// The NR infra agent emits SystemSample every ~30 s per node.
// If the "master" node stops reporting for 600 s (10 min) we open an incident.
// A dummy threshold (above 0) is required by the API even though the incident
// is driven entirely by the lost-signal expiration setting.

const nucOfflineCondition = new newrelic.NrqlAlertCondition(
  "moonrepo-nuc-offline-condition",
  {
    accountId: nrAccountId,
    policyId: nucOfflinePolicy.id,
    name: "NUC host not reporting (master)",
    description:
      "Opens when the NUC (hostname: master) stops sending SystemSample events for ≥10 minutes.",
    type: "static",
    enabled: true,

    nrql: {
      // SystemSample is emitted by the nri-infrastructure DaemonSet
      query: "SELECT count(*) FROM SystemSample WHERE hostname = 'master'",
    },

    // ── Lost-signal (expiration) settings ──
    // After 600 s of silence, treat the signal as lost and open an incident.
    expirationDuration: 600,
    openViolationOnExpiration: true,
    closeViolationsOnExpiration: false,

    // ── Threshold ──
    // Required by the API; won't fire independently because data rate is always >0
    // while the host is alive.
    critical: {
      operator: "above",
      threshold: 1000000, // intentionally unreachable value
      thresholdDuration: 300,
      thresholdOccurrences: "all",
    },

    // Aggregation window matches the infra agent reporting interval (~30 s)
    aggregationWindow: 60,
    fillOption: "none",
  },
  { provider: nrProvider },
);

// ─── Notification Destination (email) ────────────────────────────────────────

const emailDestination = new newrelic.NotificationDestination(
  "moonrepo-nuc-offline-email-dest",
  {
    name: "Cluster Alerts Email",
    type: "EMAIL",
    properties: [
      {
        key: "email",
        value: nrNotifyEmail,
      },
    ],
  },
  { provider: nrProvider },
);

// ─── Notification Channel ─────────────────────────────────────────────────────

const emailChannel = new newrelic.NotificationChannel(
  "moonrepo-nuc-offline-email-channel",
  {
    name: "Cluster Alerts Email",
    type: "EMAIL",
    destinationId: emailDestination.id,
    product: "IINT", // Issues, Incidents & Intelligence (standard alerting)
    properties: [
      {
        key: "subject",
        value: "🚨 [NR] NUC offline alert: {{ issueTitle }}",
      },
    ],
  },
  { provider: nrProvider },
);

// ─── Workflow ─────────────────────────────────────────────────────────────────
//
// Workflows control how NR routes issues to notification channels.
// This one routes any issue from the NUC Offline policy to email.

const nucOfflineWorkflow = new newrelic.Workflow(
  "moonrepo-nuc-offline-workflow",
  {
    name: "NUC Offline Workflow",
    mutingRulesHandling: "DONT_NOTIFY_FULLY_MUTED_ISSUES",
    issuesFilter: {
      name: "NUC offline policy filter",
      type: "FILTER",
      predicates: [
        {
          attribute: "labels.policyIds",
          operator: "EXACTLY_MATCHES",
          values: [nucOfflinePolicy.id],
        },
      ],
    },
    destinations: [
      {
        channelId: emailChannel.id,
      },
    ],
  },
  { provider: nrProvider },
);

// ─── Exports ──────────────────────────────────────────────────────────────────

export const nucOfflinePolicyId = nucOfflinePolicy.id;
export const nucOfflineConditionId = nucOfflineCondition.id;
export const nucOfflineWorkflowId = nucOfflineWorkflow.id;
