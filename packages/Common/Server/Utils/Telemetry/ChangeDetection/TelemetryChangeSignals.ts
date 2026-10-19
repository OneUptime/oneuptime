import crypto from "crypto";
import Dictionary from "../../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  ChangeEventAttribute,
  ChangeEventSource,
  ChangeEventType,
} from "../../../../Utils/Telemetry/ChangeEventFields";
import { readDeploymentEnvironment } from "../../../../Utils/Telemetry/DeploymentEnvironment";
import type { ParsedChangeEventEntry } from "../ChangeEventRow";

/*
 * The changes OneUptime can see in the telemetry it already receives, read
 * from one OTLP resource block's attributes. Pure on purpose: no cache, no
 * database, so every rule is pinned by tests without a server. The detector
 * (TelemetryChangeDetector) decides which of these are new.
 *
 * Two signals, both on every span, log and metric a resource sends:
 *
 *   - service.version: a service that starts reporting a version it has not
 *     reported before in that environment was deployed.
 *   - k8s.replicaset.name under k8s.deployment.name: a Kubernetes Deployment
 *     whose pods start reporting a ReplicaSet it has not run before was
 *     rolled out - a new image, a changed env var or config reference, or a
 *     `kubectl rollout restart` (each starts a new ReplicaSet). The
 *     Kubernetes agent's k8sattributes processor stamps both names.
 */

// The longest version and name the detector keeps.
export const MAX_TRACKED_VALUE_LENGTH: number = 200;

/*
 * Values that name no version at all. A service that reports one of these
 * cannot be told apart from one deploy to the next, so it is not tracked.
 */
export const UNTRACKABLE_VERSIONS: ReadonlyArray<string> = [
  "unknown",
  "undefined",
  "null",
  "none",
  "n/a",
  "latest",
  "dev",
  "development",
  "local",
  "snapshot",
  "0.0.0",
];

export interface ServiceVersionSignal {
  version: string;
  // "" when the resource reports none.
  environment: string;
  commitSha?: string | undefined;
  branch?: string | undefined;
  repositoryUrl?: string | undefined;
}

export interface KubernetesRolloutSignal {
  // "" when the resource reports none.
  clusterName: string;
  // "" when the resource reports none.
  namespace: string;
  deploymentName: string;
  replicaSetName: string;
}

/*
 * One string-valued attribute of an OTLP resource
 * ([{ key, value: { stringValue | intValue | doubleValue } }]), trimmed.
 * "" when the key is absent or holds no scalar.
 */
export function readResourceAttribute(
  attributes: JSONArray | null | undefined,
  key: string,
): string {
  if (!Array.isArray(attributes)) {
    return "";
  }

  for (const attribute of attributes) {
    if (
      !attribute ||
      typeof attribute !== "object" ||
      (attribute as JSONObject)["key"] !== key
    ) {
      continue;
    }

    const value: unknown = (attribute as JSONObject)["value"];

    if (!value || typeof value !== "object") {
      return "";
    }

    const valueObject: JSONObject = value as JSONObject;

    for (const field of ["stringValue", "intValue", "doubleValue"]) {
      const raw: unknown = valueObject[field];

      if (typeof raw === "string" && raw.trim() !== "") {
        return raw.trim();
      }

      if (typeof raw === "number" && Number.isFinite(raw)) {
        return String(raw);
      }
    }

    return "";
  }

  return "";
}

// The resource's attributes as one flat dictionary of strings.
export function flattenResourceAttributes(
  attributes: JSONArray | null | undefined,
): Dictionary<string> {
  const flat: Dictionary<string> = {};

  if (!Array.isArray(attributes)) {
    return flat;
  }

  for (const attribute of attributes) {
    const key: unknown = (attribute as JSONObject | null)?.["key"];

    if (typeof key !== "string" || key === "" || flat[key] !== undefined) {
      continue;
    }

    const value: string = readResourceAttribute([attribute], key);

    if (value) {
      flat[key] = value;
    }
  }

  return flat;
}

// Whether a version can tell one deploy from the next.
export function isTrackableVersion(version: string): boolean {
  const trimmed: string = version.trim();

  return (
    trimmed !== "" &&
    trimmed.length <= MAX_TRACKED_VALUE_LENGTH &&
    !UNTRACKABLE_VERSIONS.includes(trimmed.toLowerCase())
  );
}

function capped(value: string): string | undefined {
  return value ? value.slice(0, MAX_TRACKED_VALUE_LENGTH) : undefined;
}

// The service's version, environment and source revision, when it has a version.
export function extractServiceVersionSignal(
  attributes: JSONArray | null | undefined,
): ServiceVersionSignal | null {
  const version: string = readResourceAttribute(
    attributes,
    ChangeEventAttribute.ServiceVersion,
  );

  if (!isTrackableVersion(version)) {
    return null;
  }

  const flat: Dictionary<string> = flattenResourceAttributes(attributes);

  return {
    version,
    environment: (readDeploymentEnvironment(flat) || "").slice(
      0,
      MAX_TRACKED_VALUE_LENGTH,
    ),
    commitSha: capped(
      flat[ChangeEventAttribute.CommitSha] ||
        flat["vcs.repository.ref.revision"] ||
        "",
    ),
    branch: capped(
      flat[ChangeEventAttribute.Branch] ||
        flat["vcs.repository.ref.name"] ||
        "",
    ),
    repositoryUrl: capped(flat[ChangeEventAttribute.RepositoryUrl] || ""),
  };
}

// The Deployment and the ReplicaSet the resource's pod belongs to, when it names both.
export function extractKubernetesRolloutSignal(
  attributes: JSONArray | null | undefined,
): KubernetesRolloutSignal | null {
  const deploymentName: string = readResourceAttribute(
    attributes,
    ChangeEventAttribute.KubernetesDeployment,
  );
  const replicaSetName: string = readResourceAttribute(
    attributes,
    ChangeEventAttribute.KubernetesReplicaSet,
  );

  if (
    !deploymentName ||
    !replicaSetName ||
    deploymentName.length > MAX_TRACKED_VALUE_LENGTH ||
    replicaSetName.length > MAX_TRACKED_VALUE_LENGTH
  ) {
    return null;
  }

  return {
    clusterName: readResourceAttribute(
      attributes,
      ChangeEventAttribute.KubernetesClusterName,
    ).slice(0, MAX_TRACKED_VALUE_LENGTH),
    namespace: readResourceAttribute(
      attributes,
      ChangeEventAttribute.KubernetesNamespace,
    ).slice(0, MAX_TRACKED_VALUE_LENGTH),
    deploymentName,
    replicaSetName,
  };
}

/*
 * A fixed-length key for a value of any length. The parts come from
 * collector-controlled payloads, so a cache key built from them is hashed
 * rather than concatenated: bounded, and free of the separators it joins.
 */
export function hashKeyParts(parts: Array<string>): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 40);
}

// What a service's versions are tracked under: one service in one environment.
export function serviceVersionScopeKey(data: {
  projectId: ObjectID;
  serviceId: ObjectID;
  environment: string;
}): string {
  return hashKeyParts([
    "service-version",
    data.projectId.toString(),
    data.serviceId.toString(),
    data.environment.toLowerCase(),
  ]);
}

/*
 * What a Deployment's ReplicaSets are tracked under. The cluster is named
 * by OneUptime's id for it when the batch resolved one, by the collector's
 * cluster name otherwise.
 */
export function kubernetesRolloutScopeKey(data: {
  projectId: ObjectID;
  kubernetesClusterId?: ObjectID | null | undefined;
  signal: KubernetesRolloutSignal;
}): string {
  return hashKeyParts([
    "kubernetes-rollout",
    data.projectId.toString(),
    data.kubernetesClusterId
      ? data.kubernetesClusterId.toString()
      : `name:${data.signal.clusterName.toLowerCase()}`,
    data.signal.namespace,
    data.signal.deploymentName,
  ]);
}

// The value a scope is at, as a key next to the scope's own.
export function scopedValueKey(scopeKey: string, value: string): string {
  return `${scopeKey}:${hashKeyParts([value])}`;
}

// "Deployed checkout 2.3.1": a deploy a service's new version showed.
export function buildServiceVersionChangeEntry(data: {
  serviceName: string;
  signal: ServiceVersionSignal;
  previousVersion: string;
  time: Date;
}): ParsedChangeEventEntry {
  const { signal } = data;
  const serviceName: string = data.serviceName.trim() || "service";
  const environment: string = signal.environment
    ? ` in ${signal.environment}`
    : "";

  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]: ChangeEventSource.ServiceVersion,
    [ChangeEventAttribute.ServiceVersion]: signal.version,
    [ChangeEventAttribute.PreviousVersion]: data.previousVersion,
  };

  if (signal.environment) {
    attributes[ChangeEventAttribute.Environment] = signal.environment;
  }

  if (signal.commitSha) {
    attributes[ChangeEventAttribute.CommitSha] = signal.commitSha;
  }

  if (signal.branch) {
    attributes[ChangeEventAttribute.Branch] = signal.branch;
  }

  if (signal.repositoryUrl) {
    attributes[ChangeEventAttribute.RepositoryUrl] = signal.repositoryUrl;
  }

  return {
    time: data.time,
    eventType: ChangeEventType.Deployment,
    title: `Deployed ${serviceName} ${signal.version}`,
    description: `${serviceName} started reporting service.version ${signal.version}${environment}; it reported ${data.previousVersion} before. OneUptime recorded this from the service's telemetry.`,
    attributes,
  };
}

// "Rolled out web/api": a Deployment that started a new ReplicaSet.
export function buildKubernetesRolloutChangeEntry(data: {
  signal: KubernetesRolloutSignal;
  previousReplicaSetName: string;
  kubernetesClusterId?: ObjectID | null | undefined;
  serviceVersion?: string | undefined;
  time: Date;
}): ParsedChangeEventEntry {
  const { signal } = data;
  const workload: string = signal.namespace
    ? `${signal.namespace}/${signal.deploymentName}`
    : signal.deploymentName;
  const cluster: string = signal.clusterName
    ? ` in cluster ${signal.clusterName}`
    : "";

  const attributes: Dictionary<string> = {
    [ChangeEventAttribute.Source]: ChangeEventSource.Kubernetes,
    [ChangeEventAttribute.KubernetesDeployment]: signal.deploymentName,
    [ChangeEventAttribute.KubernetesReplicaSet]: signal.replicaSetName,
    [ChangeEventAttribute.PreviousReplicaSet]: data.previousReplicaSetName,
  };

  if (signal.namespace) {
    attributes[ChangeEventAttribute.KubernetesNamespace] = signal.namespace;
  }

  if (signal.clusterName) {
    attributes[ChangeEventAttribute.KubernetesClusterName] = signal.clusterName;
  }

  if (data.kubernetesClusterId) {
    attributes[ChangeEventAttribute.KubernetesClusterId] =
      data.kubernetesClusterId.toString();
  }

  if (data.serviceVersion && isTrackableVersion(data.serviceVersion)) {
    attributes[ChangeEventAttribute.ServiceVersion] = data.serviceVersion.slice(
      0,
      MAX_TRACKED_VALUE_LENGTH,
    );
  }

  return {
    time: data.time,
    eventType: ChangeEventType.Deployment,
    title: `Rolled out ${workload}`,
    description: `Kubernetes deployment ${workload}${cluster} started a new ReplicaSet, ${signal.replicaSetName}; its pods ran ${data.previousReplicaSetName} before. A new ReplicaSet means a new pod template: a new image, a changed environment variable or config reference, or a restart. OneUptime recorded this from the cluster's telemetry.`,
    attributes,
  };
}
