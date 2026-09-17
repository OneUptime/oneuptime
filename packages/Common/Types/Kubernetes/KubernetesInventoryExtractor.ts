import { JSONObject } from "../JSON";
import {
  KubernetesPodObject,
  KubernetesNodeObject,
  KubernetesDeploymentObject,
  KubernetesStatefulSetObject,
  KubernetesDaemonSetObject,
  KubernetesJobObject,
  KubernetesCronJobObject,
  KubernetesNamespaceObject,
  KubernetesPVCObject,
  KubernetesPVObject,
  KubernetesHPAObject,
  KubernetesVPAObject,
  KubernetesObjectMetadata,
  KubernetesCondition,
  KubernetesContainerSpec,
  KubernetesContainerStatus,
  parsePodObject,
  parseNodeObject,
  parseDeploymentObject,
  parseStatefulSetObject,
  parseDaemonSetObject,
  parseJobObject,
  parseCronJobObject,
  parseNamespaceObject,
  parsePVCObject,
  parsePVObject,
  parseHPAObject,
  parseVPAObject,
  extractObjectFromLogBody,
} from "./KubernetesObjectParser";

/*
 * ------------------------------------------------------------------
 * KubernetesInventoryExtractor
 *
 * Shared helpers for converting an OTLP k8sobjects log body into a
 * row-shaped payload (ParsedKubernetesResource) that the inventory
 * ingest path upserts into Postgres.
 *
 * Kept in Common/Types so the server-side ingest and any future
 * client/worker code can both import it. The helpers are pure — no
 * IO, no db — so they're trivially testable.
 * ------------------------------------------------------------------
 */

/*
 * Union of all typed parser outputs. Each one has .metadata; most
 * also have .spec and .status.
 */
type AnyKubernetesObject =
  | KubernetesPodObject
  | KubernetesNodeObject
  | KubernetesDeploymentObject
  | KubernetesStatefulSetObject
  | KubernetesDaemonSetObject
  | KubernetesJobObject
  | KubernetesCronJobObject
  | KubernetesNamespaceObject
  | KubernetesPVCObject
  | KubernetesPVObject
  | KubernetesHPAObject
  | KubernetesVPAObject;

/**
 * Row-shaped payload for KubernetesContainer upserts. One row per
 * container inside a Pod's spec.
 */
export interface ParsedKubernetesContainerRow {
  podNamespaceKey: string;
  podName: string;
  name: string;
  image: string | null;
  state: string | null;
  reason: string | null;
  isReady: boolean | null;
  restartCount: number | null;
  memoryLimitBytes: number | null;
  lastSeenAt: Date;
}

/**
 * Row-shaped payload for KubernetesResource upserts. Mirrors the
 * columns of the KubernetesResource Postgres model.
 */
export interface ParsedKubernetesResource {
  kind: string;
  namespaceKey: string; // "" for cluster-scoped resources
  name: string;
  uid: string | null;
  phase: string | null;
  isReady: boolean | null;
  hasMemoryPressure: boolean | null;
  hasDiskPressure: boolean | null;
  hasPidPressure: boolean | null;
  labels: JSONObject | null;
  annotations: JSONObject | null;
  ownerReferences: JSONObject | null;
  spec: JSONObject | null;
  /*
   * For Pod kinds: length of spec.containers at parse time. Lets the
   * overview summary SUM() a plain int column instead of scanning
   * every pod's JSONB spec on every page load.
   */
  containerCount: number | null;
  status: JSONObject | null;
  lastSeenAt: Date;
  resourceCreationTimestamp: Date | null;
}

/**
 * k8s.resource.name (plural, lowercase from the k8sobjects receiver)
 * → Kubernetes Kind (singular, PascalCase, used throughout the UI).
 *
 * Returns null for unrecognized types — caller should skip those
 * records rather than store them under a bogus kind.
 */
export function kindFromResourceType(resourceType: string): string | null {
  const map: Record<string, string> = {
    pods: "Pod",
    nodes: "Node",
    namespaces: "Namespace",
    deployments: "Deployment",
    statefulsets: "StatefulSet",
    daemonsets: "DaemonSet",
    jobs: "Job",
    cronjobs: "CronJob",
    persistentvolumeclaims: "PersistentVolumeClaim",
    persistentvolumes: "PersistentVolume",
    horizontalpodautoscalers: "HorizontalPodAutoscaler",
    verticalpodautoscalers: "VerticalPodAutoscaler",
  };
  return map[resourceType.toLowerCase()] || null;
}

export const INVENTORIED_RESOURCE_TYPES: ReadonlyArray<string> = [
  "pods",
  "nodes",
  "namespaces",
  "deployments",
  "statefulsets",
  "daemonsets",
  "jobs",
  "cronjobs",
  "persistentvolumeclaims",
  "persistentvolumes",
  "horizontalpodautoscalers",
  "verticalpodautoscalers",
];

/*
 * Parse a Kubernetes memory string ("256Mi", "1Gi", "512M", "2G") to
 * bytes. Returns null when the input is empty or unparseable so
 * callers can leave memoryLimitBytes null rather than store a wrong
 * number.
 */
function parseMemoryStringToBytes(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match: RegExpMatchArray | null = value
    .trim()
    .match(/^([0-9]*\.?[0-9]+)\s*([A-Za-z]+)?$/);
  if (!match) {
    return null;
  }
  const num: number = parseFloat(match[1] || "");
  if (isNaN(num)) {
    return null;
  }
  const unit: string = (match[2] || "").trim();

  // Binary units (Kubernetes default for limits).
  if (unit === "Ki") {
    return Math.round(num * 1024);
  }
  if (unit === "Mi") {
    return Math.round(num * 1024 * 1024);
  }
  if (unit === "Gi") {
    return Math.round(num * 1024 * 1024 * 1024);
  }
  if (unit === "Ti") {
    return Math.round(num * 1024 * 1024 * 1024 * 1024);
  }

  // Decimal units.
  if (unit === "K" || unit === "k") {
    return Math.round(num * 1000);
  }
  if (unit === "M") {
    return Math.round(num * 1000 * 1000);
  }
  if (unit === "G") {
    return Math.round(num * 1000 * 1000 * 1000);
  }
  if (unit === "T") {
    return Math.round(num * 1000 * 1000 * 1000 * 1000);
  }

  // No unit -> raw bytes.
  if (unit === "") {
    return Math.round(num);
  }
  return null;
}

/**
 * Build per-container rows from a parsed Pod object. The state +
 * reason + ready + restartCount columns are taken from
 * status.containerStatuses (matched by container name). When status
 * hasn't been observed yet (newly scheduled pod) those fields stay
 * null.
 */
export function extractContainersFromPod(data: {
  parsedPod: KubernetesPodObject;
  lastSeenAt: Date;
}): Array<ParsedKubernetesContainerRow> {
  const meta: KubernetesObjectMetadata = data.parsedPod.metadata;
  if (!meta || !meta.name) {
    return [];
  }

  const podNamespaceKey: string = meta.namespace || "";
  const podName: string = meta.name;

  const specContainers: Array<KubernetesContainerSpec> = Array.isArray(
    data.parsedPod.spec?.containers,
  )
    ? data.parsedPod.spec.containers
    : [];
  const statusList: Array<KubernetesContainerStatus> = Array.isArray(
    data.parsedPod.status?.containerStatuses,
  )
    ? data.parsedPod.status.containerStatuses
    : [];

  const statusByName: Map<string, KubernetesContainerStatus> = new Map();
  for (const cs of statusList) {
    if (cs && typeof cs.name === "string" && cs.name) {
      statusByName.set(cs.name, cs);
    }
  }

  const rows: Array<ParsedKubernetesContainerRow> = [];
  for (const container of specContainers) {
    const containerName: string = container?.name || "";
    if (!containerName) {
      continue;
    }
    const cs: KubernetesContainerStatus | undefined =
      statusByName.get(containerName);

    const memLimitRaw: string | undefined =
      container.resources?.limits?.["memory"];
    const memoryLimitBytes: number | null =
      parseMemoryStringToBytes(memLimitRaw);

    rows.push({
      podNamespaceKey,
      podName,
      name: containerName,
      image: container.image || (cs ? cs.image || null : null) || null,
      state: cs && typeof cs.state === "string" ? cs.state : null,
      reason:
        cs && typeof cs.reason === "string" && cs.reason ? cs.reason : null,
      isReady: cs ? Boolean(cs.ready) : null,
      restartCount:
        cs && typeof cs.restartCount === "number" ? cs.restartCount : null,
      memoryLimitBytes,
      lastSeenAt: data.lastSeenAt,
    });
  }
  return rows;
}

function parseCreationTimestamp(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  try {
    const d: Date = new Date(value);
    if (isNaN(d.getTime())) {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

function deriveNodeConditionFlags(
  conditions: Array<KubernetesCondition> | undefined,
): {
  isReady: boolean | null;
  hasMemoryPressure: boolean | null;
  hasDiskPressure: boolean | null;
  hasPidPressure: boolean | null;
} {
  if (!conditions || conditions.length === 0) {
    return {
      isReady: null,
      hasMemoryPressure: null,
      hasDiskPressure: null,
      hasPidPressure: null,
    };
  }

  let isReady: boolean | null = null;
  let memPressure: boolean | null = null;
  let diskPressure: boolean | null = null;
  let pidPressure: boolean | null = null;

  for (const c of conditions) {
    const isTrue: boolean = c.status === "True";
    if (c.type === "Ready") {
      isReady = isTrue;
    } else if (c.type === "MemoryPressure") {
      memPressure = isTrue;
    } else if (c.type === "DiskPressure") {
      diskPressure = isTrue;
    } else if (c.type === "PIDPressure") {
      pidPressure = isTrue;
    }
  }

  /*
   * For pressure flags we only treat a Node as having a signal when the
   * condition was actually reported. If the agent didn't include it,
   * leave as null rather than false — avoids false-negative alerting.
   */
  return {
    isReady,
    hasMemoryPressure: memPressure === null ? false : memPressure,
    hasDiskPressure: diskPressure === null ? false : diskPressure,
    hasPidPressure: pidPressure === null ? false : pidPressure,
  };
}

function parseByResourceType(
  resourceType: string,
  kvList: JSONObject,
): AnyKubernetesObject | null {
  switch (resourceType.toLowerCase()) {
    case "pods":
      return parsePodObject(kvList);
    case "nodes":
      return parseNodeObject(kvList);
    case "namespaces":
      return parseNamespaceObject(kvList);
    case "deployments":
      return parseDeploymentObject(kvList);
    case "statefulsets":
      return parseStatefulSetObject(kvList);
    case "daemonsets":
      return parseDaemonSetObject(kvList);
    case "jobs":
      return parseJobObject(kvList);
    case "cronjobs":
      return parseCronJobObject(kvList);
    case "persistentvolumeclaims":
      return parsePVCObject(kvList);
    case "persistentvolumes":
      return parsePVObject(kvList);
    case "horizontalpodautoscalers":
      return parseHPAObject(kvList);
    case "verticalpodautoscalers":
      return parseVPAObject(kvList);
    default:
      return null;
  }
}

/**
 * Combined result of parsing one k8sobjects log record. The
 * `resource` is the parent KubernetesResource row. `containers` is
 * non-empty only when the record was a Pod, in which case it holds
 * one row per spec.containers entry to upsert into KubernetesContainer.
 */
export interface ExtractedInventoryRecord {
  resource: ParsedKubernetesResource;
  containers: Array<ParsedKubernetesContainerRow>;
}

/**
 * Parse a single OTLP log body string + its k8s.resource.name into a
 * ParsedKubernetesResource (and, for Pod records, child container
 * rows) ready for upsert. Returns null when the record is malformed,
 * unsupported, or missing required identity fields.
 */
export function extractInventoryResource(data: {
  resourceType: string;
  logBody: string;
  lastSeenAt: Date;
}): ExtractedInventoryRecord | null {
  const kind: string | null = kindFromResourceType(data.resourceType);
  if (!kind) {
    return null;
  }

  const kvList: JSONObject | null = extractObjectFromLogBody(data.logBody);
  if (!kvList) {
    return null;
  }

  const parsed: AnyKubernetesObject | null = parseByResourceType(
    data.resourceType,
    kvList,
  );
  if (!parsed) {
    return null;
  }

  const metadata: KubernetesObjectMetadata = parsed.metadata;
  if (!metadata || !metadata.name) {
    return null;
  }

  // Pod-specific hot columns
  let phase: string | null = null;
  let containerCount: number | null = null;
  if (kind === "Pod") {
    const podStatus: KubernetesPodObject["status"] = (
      parsed as KubernetesPodObject
    ).status;
    phase = podStatus?.phase || null;
    const podSpec: KubernetesPodObject["spec"] | undefined = (
      parsed as KubernetesPodObject
    ).spec;
    containerCount = Array.isArray(podSpec?.containers)
      ? podSpec.containers.length
      : 0;
  }

  // Node-specific hot columns
  let nodeFlags: ReturnType<typeof deriveNodeConditionFlags> = {
    isReady: null,
    hasMemoryPressure: null,
    hasDiskPressure: null,
    hasPidPressure: null,
  };
  if (kind === "Node") {
    const nodeStatus: KubernetesNodeObject["status"] = (
      parsed as KubernetesNodeObject
    ).status;
    nodeFlags = deriveNodeConditionFlags(nodeStatus?.conditions);
  }

  /*
   * Collect spec/status blocks when the typed parser exposed them.
   * Some kinds (Namespace) don't carry spec/status, so these are
   * nullable.
   * Cast to a minimal structural shape so TS permits optional access
   * across the heterogeneous union.
   */
  const anyParsed: {
    spec?: unknown;
    status?: unknown;
  } = parsed as {
    spec?: unknown;
    status?: unknown;
  };

  const resource: ParsedKubernetesResource = {
    kind,
    namespaceKey: metadata.namespace || "",
    name: metadata.name,
    uid: metadata.uid || null,
    phase,
    isReady: nodeFlags.isReady,
    hasMemoryPressure: nodeFlags.hasMemoryPressure,
    hasDiskPressure: nodeFlags.hasDiskPressure,
    hasPidPressure: nodeFlags.hasPidPressure,
    labels:
      metadata.labels && Object.keys(metadata.labels).length > 0
        ? (metadata.labels as JSONObject)
        : null,
    annotations:
      metadata.annotations && Object.keys(metadata.annotations).length > 0
        ? (metadata.annotations as JSONObject)
        : null,
    ownerReferences:
      metadata.ownerReferences && metadata.ownerReferences.length > 0
        ? ({
            items: metadata.ownerReferences,
          } as unknown as JSONObject)
        : null,
    spec: (anyParsed.spec as JSONObject | undefined) || null,
    containerCount,
    status: (anyParsed.status as JSONObject | undefined) || null,
    lastSeenAt: data.lastSeenAt,
    resourceCreationTimestamp: parseCreationTimestamp(
      metadata.creationTimestamp,
    ),
  };

  let containers: Array<ParsedKubernetesContainerRow> = [];
  if (kind === "Pod") {
    containers = extractContainersFromPod({
      parsedPod: parsed as KubernetesPodObject,
      lastSeenAt: data.lastSeenAt,
    });
  }

  return { resource, containers };
}
