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
 * Parse a single OTLP log body string + its k8s.resource.name into a
 * ParsedKubernetesResource ready for upsert. Returns null when the
 * record is malformed, unsupported, or missing required identity
 * fields.
 */
export function extractInventoryResource(data: {
  resourceType: string;
  logBody: string;
  lastSeenAt: Date;
}): ParsedKubernetesResource | null {
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

  // Pod-specific hot column
  let phase: string | null = null;
  if (kind === "Pod") {
    const podStatus: KubernetesPodObject["status"] = (
      parsed as KubernetesPodObject
    ).status;
    phase = podStatus?.phase || null;
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

  return {
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
    status: (anyParsed.status as JSONObject | undefined) || null,
    lastSeenAt: data.lastSeenAt,
    resourceCreationTimestamp: parseCreationTimestamp(
      metadata.creationTimestamp,
    ),
  };
}
