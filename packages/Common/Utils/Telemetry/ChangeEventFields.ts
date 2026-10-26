import Dictionary from "../../Types/Dictionary";

/*
 * What a change event says, in one vocabulary.
 *
 * Change events (Models/AnalyticsModels/ChangeEvent) come from several
 * places: CI/CD pipelines and the CLI post them to the ingest API, and
 * OneUptime records others itself - a service that starts reporting a new
 * service.version, a Kubernetes Deployment that starts a new ReplicaSet, a
 * fix command OneUptime AI ran, a runbook that ran, a change a cloud
 * account's activity log recorded, a health event its provider published.
 * They all keep what
 * they know in the row's attributes map, under OpenTelemetry's semantic
 * convention names where one exists (service.version,
 * deployment.environment.name, vcs.*, k8s.*) and under oneuptime.* where
 * none does. Everything that reads a change event - the AI tools, the
 * investigation context, the chart markers - reads it through
 * readChangeEventFields below, so a field is named in one place.
 */

// The kinds of change OneUptime writes and understands (ChangeEvent.eventType).
export enum ChangeEventType {
  Deployment = "deployment",
  ConfigChange = "config-change",
  Scaling = "scaling",
  Rollback = "rollback",
  FeatureFlag = "feature-flag",
  // A fix command OneUptime AI ran on a cluster or a host.
  Remediation = "remediation",
  // A runbook OneUptime ran.
  Runbook = "runbook",
  /*
   * The cloud provider's own event about the account: an AWS Health event,
   * an Azure Service Health or Resource Health event, a Google Cloud
   * Service Health event - an outage, degradation or scheduled change on
   * the provider's side.
   */
  ProviderEvent = "provider-event",
  Custom = "custom",
}

// Where a change event came from: its oneuptime.change.source attribute.
export enum ChangeEventSource {
  // Posted to the change-events ingest API: a CI/CD pipeline or the CLI.
  Api = "api",
  // A service started reporting a service.version it had not reported before.
  ServiceVersion = "service-version",
  // A Kubernetes Deployment started a new ReplicaSet.
  Kubernetes = "kubernetes",
  // A fix command OneUptime AI ran.
  OneUptimeAi = "oneuptime-ai",
  // A runbook OneUptime ran.
  Runbook = "runbook",
  /*
   * A change a cloud account's activity log recorded: AWS CloudTrail, the
   * Azure Activity Log, Google Cloud's Admin Activity audit log.
   */
  Cloud = "cloud",
  // A health event the cloud provider published about the account.
  CloudHealth = "cloud-health",
}

// The attribute keys OneUptime writes on the change events it records.
export const ChangeEventAttribute: {
  readonly Source: string;
  readonly Status: string;
  readonly PreviousVersion: string;
  readonly PreviousReplicaSet: string;
  readonly ServiceVersion: string;
  readonly Environment: string;
  readonly CommitSha: string;
  readonly Branch: string;
  readonly RepositoryUrl: string;
  readonly PullRequest: string;
  readonly KubernetesClusterName: string;
  readonly KubernetesNamespace: string;
  readonly KubernetesDeployment: string;
  readonly KubernetesReplicaSet: string;
  readonly KubernetesClusterId: string;
  readonly ResourceType: string;
  readonly ResourceId: string;
  readonly Command: string;
  readonly AiRunId: string;
  readonly IncidentId: string;
  readonly AlertId: string;
  readonly RunbookId: string;
  readonly RunbookExecutionId: string;
  readonly CloudProvider: string;
  readonly CloudAccountId: string;
  readonly CloudRegion: string;
  readonly CloudResourceId: string;
  readonly CloudOperation: string;
  readonly CloudActor: string;
  readonly CloudEventId: string;
  readonly CloudAccountRecordId: string;
} = {
  Source: "oneuptime.change.source",
  Status: "oneuptime.change.status",
  PreviousVersion: "oneuptime.change.previous_version",
  PreviousReplicaSet: "oneuptime.change.previous_replicaset",
  ServiceVersion: "service.version",
  Environment: "deployment.environment.name",
  CommitSha: "vcs.ref.head.revision",
  Branch: "vcs.ref.head.name",
  RepositoryUrl: "vcs.repository.url.full",
  PullRequest: "vcs.change.id",
  KubernetesClusterName: "k8s.cluster.name",
  KubernetesNamespace: "k8s.namespace.name",
  KubernetesDeployment: "k8s.deployment.name",
  KubernetesReplicaSet: "k8s.replicaset.name",
  KubernetesClusterId: "oneuptime.kubernetes.cluster.id",
  ResourceType: "oneuptime.resource.type",
  ResourceId: "oneuptime.resource.id",
  Command: "oneuptime.command",
  AiRunId: "oneuptime.ai_run.id",
  IncidentId: "oneuptime.incident.id",
  AlertId: "oneuptime.alert.id",
  RunbookId: "oneuptime.runbook.id",
  RunbookExecutionId: "oneuptime.runbook_execution.id",
  // OpenTelemetry's cloud.* names, for the account and the resource.
  CloudProvider: "cloud.provider",
  CloudAccountId: "cloud.account.id",
  CloudRegion: "cloud.region",
  CloudResourceId: "cloud.resource_id",
  // What the activity log recorded, and who did it.
  CloudOperation: "oneuptime.cloud.operation",
  CloudActor: "oneuptime.cloud.actor",
  CloudEventId: "oneuptime.cloud.event_id",
  // The CloudAccount row the change belongs to.
  CloudAccountRecordId: "oneuptime.cloud_account.id",
};

/*
 * Attribute keys under this prefix are OneUptime's own. The ingest API
 * drops them from what a pipeline posts, so a posted event cannot claim to
 * be a fix OneUptime AI ran, or to belong to an incident it has nothing to
 * do with: investigations match changes to incidents by these keys.
 */
export const RESERVED_CHANGE_ATTRIBUTE_PREFIX: string = "oneuptime.";

// Whether a change event's outcome was a success (oneuptime.change.status).
export enum ChangeEventStatus {
  Succeeded = "succeeded",
  Failed = "failed",
  Cancelled = "cancelled",
}

/*
 * Where each field may be found, best first. The first key is the one
 * OneUptime writes; the rest are the names pipelines already send (the
 * docs' own first example posted "version" and "sha") and the names
 * OpenTelemetry used before it renamed them, so an event reads the same
 * however it was written.
 */
export const CHANGE_EVENT_FIELD_KEYS: {
  readonly version: ReadonlyArray<string>;
  readonly previousVersion: ReadonlyArray<string>;
  readonly environment: ReadonlyArray<string>;
  readonly commitSha: ReadonlyArray<string>;
  readonly branch: ReadonlyArray<string>;
  readonly repositoryUrl: ReadonlyArray<string>;
  readonly pullRequest: ReadonlyArray<string>;
} = {
  version: ["service.version", "version", "release", "app.version"],
  previousVersion: [
    "oneuptime.change.previous_version",
    "previous_version",
    "previousVersion",
  ],
  environment: [
    "deployment.environment.name",
    "deployment.environment",
    "environment",
    "env",
  ],
  commitSha: [
    "vcs.ref.head.revision",
    "vcs.repository.ref.revision",
    "git.commit.sha",
    "git.sha",
    "commit.sha",
    "commit_sha",
    "commitSha",
    "commit",
    "sha",
  ],
  branch: ["vcs.ref.head.name", "vcs.repository.ref.name", "branch"],
  repositoryUrl: [
    "vcs.repository.url.full",
    "repository.url",
    "repository_url",
    "repositoryUrl",
    "repository",
    "repo",
  ],
  pullRequest: [
    "vcs.change.id",
    "vcs.repository.change.id",
    "pull_request",
    "pullRequest",
    "pr",
  ],
};

export interface ChangeEventFields {
  source?: string | undefined;
  status?: string | undefined;
  version?: string | undefined;
  previousVersion?: string | undefined;
  environment?: string | undefined;
  commitSha?: string | undefined;
  branch?: string | undefined;
  repositoryUrl?: string | undefined;
  pullRequest?: string | undefined;
  kubernetesClusterName?: string | undefined;
  kubernetesClusterId?: string | undefined;
  kubernetesNamespace?: string | undefined;
  kubernetesDeployment?: string | undefined;
  kubernetesReplicaSet?: string | undefined;
  previousReplicaSet?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  command?: string | undefined;
  aiRunId?: string | undefined;
  incidentId?: string | undefined;
  alertId?: string | undefined;
  runbookId?: string | undefined;
  runbookExecutionId?: string | undefined;
  cloudProvider?: string | undefined;
  cloudAccountId?: string | undefined;
  cloudRegion?: string | undefined;
  cloudResourceId?: string | undefined;
  cloudOperation?: string | undefined;
  cloudActor?: string | undefined;
  cloudAccountRecordId?: string | undefined;
}

function firstValue(
  attributes: Dictionary<unknown>,
  keys: ReadonlyArray<string>,
): string | undefined {
  for (const key of keys) {
    const value: unknown = attributes[key];

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return undefined;
}

/*
 * Every field a change event's attributes hold, each from the first key in
 * CHANGE_EVENT_FIELD_KEYS that has a value. Absent fields are left out.
 */
export function readChangeEventFields(
  attributes: Dictionary<unknown> | null | undefined,
): ChangeEventFields {
  if (!attributes || typeof attributes !== "object") {
    return {};
  }

  const read: (keys: ReadonlyArray<string> | string) => string | undefined = (
    keys: ReadonlyArray<string> | string,
  ): string | undefined => {
    return firstValue(attributes, typeof keys === "string" ? [keys] : keys);
  };

  const fields: ChangeEventFields = {
    source: read(ChangeEventAttribute.Source),
    status: read(ChangeEventAttribute.Status),
    version: read(CHANGE_EVENT_FIELD_KEYS.version),
    previousVersion: read(CHANGE_EVENT_FIELD_KEYS.previousVersion),
    environment: read(CHANGE_EVENT_FIELD_KEYS.environment),
    commitSha: read(CHANGE_EVENT_FIELD_KEYS.commitSha),
    branch: read(CHANGE_EVENT_FIELD_KEYS.branch),
    repositoryUrl: read(CHANGE_EVENT_FIELD_KEYS.repositoryUrl),
    pullRequest: read(CHANGE_EVENT_FIELD_KEYS.pullRequest),
    kubernetesClusterName: read(ChangeEventAttribute.KubernetesClusterName),
    kubernetesClusterId: read(ChangeEventAttribute.KubernetesClusterId),
    kubernetesNamespace: read(ChangeEventAttribute.KubernetesNamespace),
    kubernetesDeployment: read(ChangeEventAttribute.KubernetesDeployment),
    kubernetesReplicaSet: read(ChangeEventAttribute.KubernetesReplicaSet),
    previousReplicaSet: read(ChangeEventAttribute.PreviousReplicaSet),
    resourceType: read(ChangeEventAttribute.ResourceType),
    resourceId: read(ChangeEventAttribute.ResourceId),
    command: read(ChangeEventAttribute.Command),
    aiRunId: read(ChangeEventAttribute.AiRunId),
    incidentId: read(ChangeEventAttribute.IncidentId),
    alertId: read(ChangeEventAttribute.AlertId),
    runbookId: read(ChangeEventAttribute.RunbookId),
    runbookExecutionId: read(ChangeEventAttribute.RunbookExecutionId),
    cloudProvider: read(ChangeEventAttribute.CloudProvider),
    cloudAccountId: read(ChangeEventAttribute.CloudAccountId),
    cloudRegion: read(ChangeEventAttribute.CloudRegion),
    cloudResourceId: read(ChangeEventAttribute.CloudResourceId),
    cloudOperation: read(ChangeEventAttribute.CloudOperation),
    cloudActor: read(ChangeEventAttribute.CloudActor),
    cloudAccountRecordId: read(ChangeEventAttribute.CloudAccountRecordId),
  };

  for (const key of Object.keys(fields) as Array<keyof ChangeEventFields>) {
    if (fields[key] === undefined) {
      delete fields[key];
    }
  }

  return fields;
}

/*
 * A commit SHA as people read it: the first seven characters of a full
 * hexadecimal SHA, anything else as it was written.
 */
const FULL_COMMIT_SHA: RegExp = /^[0-9a-f]{12,64}$/i;

export function shortCommitSha(sha: string): string {
  const trimmed: string = sha.trim();

  return FULL_COMMIT_SHA.test(trimmed) ? trimmed.slice(0, 7) : trimmed;
}

/*
 * The facts of a change in one line, for a reader or a prompt:
 * "2.3.0 → 2.3.1, commit 1a2b3c4, production, recorded from service.version".
 * Values are written as they were sent; the caller quotes or escapes the
 * line for wherever it goes.
 */
export function describeChangeEventFields(fields: ChangeEventFields): string {
  const parts: Array<string> = [];

  if (fields.version && fields.previousVersion) {
    parts.push(`${fields.previousVersion} → ${fields.version}`);
  } else if (fields.version) {
    parts.push(`version ${fields.version}`);
  }

  if (fields.kubernetesDeployment) {
    const namespace: string = fields.kubernetesNamespace
      ? `${fields.kubernetesNamespace}/`
      : "";
    parts.push(`deployment ${namespace}${fields.kubernetesDeployment}`);
  }

  if (fields.kubernetesReplicaSet && fields.previousReplicaSet) {
    parts.push(
      `ReplicaSet ${fields.previousReplicaSet} → ${fields.kubernetesReplicaSet}`,
    );
  } else if (fields.kubernetesReplicaSet) {
    parts.push(`ReplicaSet ${fields.kubernetesReplicaSet}`);
  }

  if (fields.commitSha) {
    parts.push(`commit ${shortCommitSha(fields.commitSha)}`);
  }

  if (fields.pullRequest) {
    parts.push(`PR ${fields.pullRequest}`);
  }

  if (fields.branch) {
    parts.push(`branch ${fields.branch}`);
  }

  if (fields.environment) {
    parts.push(fields.environment);
  }

  if (fields.command) {
    parts.push(`command: ${fields.command}`);
  }

  if (fields.cloudOperation) {
    parts.push(
      fields.cloudActor
        ? `${fields.cloudOperation} by ${fields.cloudActor}`
        : fields.cloudOperation,
    );
  }

  if (fields.cloudResourceId) {
    parts.push(`on ${fields.cloudResourceId}`);
  }

  if (fields.cloudAccountId) {
    parts.push(
      fields.cloudRegion
        ? `account ${fields.cloudAccountId}, ${fields.cloudRegion}`
        : `account ${fields.cloudAccountId}`,
    );
  }

  if (fields.status) {
    parts.push(fields.status);
  }

  if (fields.source) {
    parts.push(`recorded from ${describeChangeEventSource(fields.source)}`);
  }

  return parts.join(", ");
}

// How a change event's source is named to a reader.
export function describeChangeEventSource(source: string): string {
  switch (source) {
    case ChangeEventSource.Api:
      return "the change-events API";
    case ChangeEventSource.ServiceVersion:
      return "a new service.version in telemetry";
    case ChangeEventSource.Kubernetes:
      return "a new Kubernetes ReplicaSet";
    case ChangeEventSource.OneUptimeAi:
      return "a fix OneUptime AI ran";
    case ChangeEventSource.Runbook:
      return "a runbook OneUptime ran";
    case ChangeEventSource.Cloud:
      return "the cloud account's activity log";
    case ChangeEventSource.CloudHealth:
      return "the cloud provider's health events";
    default:
      return source;
  }
}
