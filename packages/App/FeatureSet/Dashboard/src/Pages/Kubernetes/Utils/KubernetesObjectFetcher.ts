import Log from "Common/Models/AnalyticsModels/Log";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  getKvStringValue,
  getKvValue,
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
} from "Common/Types/Kubernetes/KubernetesObjectParser";
import { kindFromResourceType } from "Common/Types/Kubernetes/KubernetesInventoryExtractor";

/*
 * ------------------------------------------------------------------
 * KubernetesObjectFetcher
 *
 * Dashboard-side helpers for reading Kubernetes object snapshots.
 *
 * Post-migration:
 *   - fetchLatestK8sObject / fetchK8sObjectsBatch / fetchRawK8sObject
 *     read from the Postgres KubernetesResource table populated by
 *     the OTel logs ingest path. This replaces 24h scans of the
 *     ClickHouse Log table for object specs and is orders of
 *     magnitude faster.
 *   - fetchK8sEventsForResource / fetchClusterWarningEvents /
 *     fetchPodLogs continue to read from the Log table — they ARE
 *     genuinely log-shaped (k8s events, application logs).
 *
 * The public signatures are unchanged; callers pass the cluster
 * identifier string as before. We resolve it to the cluster UUID
 * once via ModelAPI and cache the mapping in-memory for 60 s so
 * back-to-back fetches on the same page share one lookup.
 * ------------------------------------------------------------------
 */

export type KubernetesObjectType =
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

export interface FetchK8sObjectOptions {
  clusterIdentifier: string;
  resourceType: string; // "pods", "nodes", "deployments", etc.
  resourceName: string;
  namespace?: string | undefined; // Not needed for cluster-scoped resources (nodes, namespaces)
}

// --- cluster-id cache ----------------------------------------------

interface CacheEntry {
  id: ObjectID | null; // null = lookup failed (e.g. cluster not provisioned)
  expiresAt: number;
}

const CLUSTER_ID_CACHE_TTL_MS: number = 60_000;
const clusterIdCache: Map<string, CacheEntry> = new Map();

async function resolveClusterId(
  clusterIdentifier: string,
): Promise<ObjectID | null> {
  const now: number = Date.now();
  const cached: CacheEntry | undefined = clusterIdCache.get(clusterIdentifier);
  if (cached && cached.expiresAt > now) {
    return cached.id;
  }

  try {
    const listResult: ModelListResult<KubernetesCluster> =
      await ModelAPI.getList<KubernetesCluster>({
        modelType: KubernetesCluster,
        query: {
          clusterIdentifier: clusterIdentifier,
        },
        select: {
          _id: true,
        },
        limit: 1,
        skip: 0,
        sort: {},
      });

    const id: ObjectID | null =
      listResult.data[0] && listResult.data[0]._id
        ? new ObjectID(listResult.data[0]._id.toString())
        : null;
    clusterIdCache.set(clusterIdentifier, {
      id,
      expiresAt: now + CLUSTER_ID_CACHE_TTL_MS,
    });
    return id;
  } catch {
    // Don't cache failures — retry on next call.
    return null;
  }
}

// --- spec/status reconstruction ------------------------------------

/**
 * Pull a KubernetesResource row and cast back into the typed
 * K8s object shape the detail pages expect. The rows store
 * spec/status/labels/annotations/ownerReferences as JSONB so we
 * simply reassemble them under a `metadata` envelope.
 */
function rowToTypedObject<T extends KubernetesObjectType>(
  row: KubernetesResource,
): T | null {
  if (!row.name) {
    return null;
  }

  // Re-raise the OwnerReferences array from its {items: [...]} wrapper.
  let ownerReferences: Array<{ kind: string; name: string }> = [];
  if (row.ownerReferences) {
    const ownerRefsAny: unknown = row.ownerReferences as unknown;
    const items: unknown = (ownerRefsAny as { items?: unknown } | null)?.items;
    if (Array.isArray(items)) {
      ownerReferences = items as Array<{ kind: string; name: string }>;
    } else if (Array.isArray(ownerRefsAny)) {
      ownerReferences = ownerRefsAny as Array<{ kind: string; name: string }>;
    }
  }

  const metadata: Record<string, unknown> = {
    name: row.name,
    namespace:
      row.namespaceKey && row.namespaceKey !== "" ? row.namespaceKey : "",
    uid: row.uid || "",
    creationTimestamp: row.resourceCreationTimestamp
      ? OneUptimeDate.toString(row.resourceCreationTimestamp)
      : "",
    labels: (row.labels as Record<string, string>) || {},
    annotations: (row.annotations as Record<string, string>) || {},
    ownerReferences,
  };

  const spec: Record<string, unknown> =
    (row.spec as Record<string, unknown>) || {};
  const status: Record<string, unknown> =
    (row.status as Record<string, unknown>) || {};

  /*
   * All parsed K8s object interfaces share this structural shape.
   * Casting to T is safe because each caller already knows which
   * KubernetesObjectType they asked for.
   */
  return {
    metadata,
    spec,
    status,
  } as unknown as T;
}

// --- public fetchers -----------------------------------------------

export async function fetchLatestK8sObject<T extends KubernetesObjectType>(
  options: FetchK8sObjectOptions,
): Promise<T | null> {
  const kind: string | null = kindFromResourceType(options.resourceType);
  if (!kind) {
    return null;
  }

  const clusterId: ObjectID | null = await resolveClusterId(
    options.clusterIdentifier,
  );
  if (!clusterId) {
    return null;
  }

  try {
    /*
     * Callers may not know the namespace (routes only encode the name),
     * so omit namespaceKey from the query when no namespace is given.
     * For cluster-scoped resources (Node, Namespace, PV) the DB value is
     * "" which still matches a broad query.
     */
    const query: Record<string, unknown> = {
      kubernetesClusterId: clusterId,
      kind: kind,
      name: options.resourceName,
    };
    if (options.namespace) {
      query["namespaceKey"] = options.namespace;
    }

    const listResult: ModelListResult<KubernetesResource> =
      await ModelAPI.getList<KubernetesResource>({
        modelType: KubernetesResource,
        query,
        select: {
          _id: true,
          name: true,
          namespaceKey: true,
          uid: true,
          labels: true,
          annotations: true,
          ownerReferences: true,
          spec: true,
          status: true,
          resourceCreationTimestamp: true,
        },
        limit: 1,
        skip: 0,
        sort: {},
      });

    const row: KubernetesResource | undefined = listResult.data[0];
    if (!row) {
      return null;
    }
    return rowToTypedObject<T>(row);
  } catch {
    return null;
  }
}

/**
 * Fetch the raw K8s manifest shape (flat JS object) for the YAML
 * viewer. Reconstructed from the stored columns rather than the
 * original OTLP kvlistValue blob.
 */
export async function fetchRawK8sObject(
  options: FetchK8sObjectOptions,
): Promise<Record<string, unknown> | null> {
  const kind: string | null = kindFromResourceType(options.resourceType);
  if (!kind) {
    return null;
  }

  const clusterId: ObjectID | null = await resolveClusterId(
    options.clusterIdentifier,
  );
  if (!clusterId) {
    return null;
  }

  try {
    /*
     * Match fetchLatestK8sObject: omit namespaceKey from the query when
     * the caller didn't pass one, so routes that only carry the name
     * (e.g. /pods/:name) can still resolve namespaced resources.
     */
    const query: Record<string, unknown> = {
      kubernetesClusterId: clusterId,
      kind: kind,
      name: options.resourceName,
    };
    if (options.namespace) {
      query["namespaceKey"] = options.namespace;
    }

    const listResult: ModelListResult<KubernetesResource> =
      await ModelAPI.getList<KubernetesResource>({
        modelType: KubernetesResource,
        query,
        select: {
          _id: true,
          name: true,
          namespaceKey: true,
          uid: true,
          labels: true,
          annotations: true,
          ownerReferences: true,
          spec: true,
          status: true,
          resourceCreationTimestamp: true,
        },
        limit: 1,
        skip: 0,
        sort: {},
      });

    const row: KubernetesResource | undefined = listResult.data[0];
    if (!row || !row.name) {
      return null;
    }

    /*
     * Rebuild a K8s-ish object (kind/apiVersion not stored; the
     * YAML viewer only cares about the full body for reference).
     */
    return {
      kind,
      metadata: {
        name: row.name,
        namespace:
          row.namespaceKey && row.namespaceKey !== ""
            ? row.namespaceKey
            : undefined,
        uid: row.uid || undefined,
        creationTimestamp: row.resourceCreationTimestamp
          ? OneUptimeDate.toString(row.resourceCreationTimestamp)
          : undefined,
        labels: row.labels || undefined,
        annotations: row.annotations || undefined,
        ownerReferences:
          (row.ownerReferences as { items?: unknown } | null)?.items ||
          row.ownerReferences ||
          undefined,
      },
      spec: row.spec || undefined,
      status: row.status || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Batch fetch all K8s objects of a given type for a cluster.
 * Returns a Map keyed by "namespace/name" for namespaced resources,
 * or "name" for cluster-scoped resources.
 */
export async function fetchK8sObjectsBatch(options: {
  clusterIdentifier: string;
  resourceType: string;
}): Promise<Map<string, KubernetesObjectType>> {
  const kind: string | null = kindFromResourceType(options.resourceType);
  if (!kind) {
    return new Map();
  }

  const clusterId: ObjectID | null = await resolveClusterId(
    options.clusterIdentifier,
  );
  if (!clusterId) {
    return new Map();
  }

  try {
    const listResult: ModelListResult<KubernetesResource> =
      await ModelAPI.getList<KubernetesResource>({
        modelType: KubernetesResource,
        query: {
          kubernetesClusterId: clusterId,
          kind: kind,
        },
        select: {
          _id: true,
          name: true,
          namespaceKey: true,
          uid: true,
          labels: true,
          annotations: true,
          ownerReferences: true,
          spec: true,
          status: true,
          resourceCreationTimestamp: true,
        },
        /*
         * LIMIT_PER_PROJECT-style cap. Inventory tables for a single
         * cluster of a single kind shouldn't realistically exceed this.
         */
        limit: 5000,
        skip: 0,
        sort: {},
      });

    const resultMap: Map<string, KubernetesObjectType> = new Map();
    for (const row of listResult.data) {
      if (!row.name) {
        continue;
      }
      const key: string =
        row.namespaceKey && row.namespaceKey !== ""
          ? `${row.namespaceKey}/${row.name}`
          : row.name;
      const typed: KubernetesObjectType | null =
        rowToTypedObject<KubernetesObjectType>(row);
      if (typed) {
        resultMap.set(key, typed);
      }
    }
    return resultMap;
  } catch {
    return new Map();
  }
}

// --- events + logs (still on ClickHouse) ---------------------------

/**
 * Fetch K8s events related to a specific resource. Events arrive
 * from the k8sobjects watch mode and remain log-shaped; we keep them
 * on ClickHouse.
 */
export interface KubernetesEvent {
  timestamp: string;
  type: string;
  reason: string;
  objectKind: string;
  objectName: string;
  namespace: string;
  message: string;
}

export async function fetchK8sEventsForResource(options: {
  clusterIdentifier: string;
  resourceKind: string;
  resourceName: string;
  namespace?: string | undefined;
}): Promise<Array<KubernetesEvent>> {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  if (!projectId) {
    return [];
  }

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -24);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventsQueryOptions: any = {
      modelType: Log,
      query: {
        projectId: projectId,
        time: new InBetween<Date>(startDate, endDate),
        attributes: {
          "event.domain": "k8s",
          "k8s.resource.name": "events",
        },
      },
      limit: 500,
      skip: 0,
      select: {
        time: true,
        body: true,
        attributes: true,
      },
      sort: {
        time: SortOrder.Descending,
      },
      requestOptions: {},
    };
    const listResult: ListResult<Log> =
      await AnalyticsModelAPI.getList<Log>(eventsQueryOptions);

    const events: Array<KubernetesEvent> = [];

    for (const log of listResult.data) {
      const attrs: JSONObject = log.attributes || {};

      if (
        attrs["resource.k8s.cluster.name"] !== options.clusterIdentifier &&
        attrs["k8s.cluster.name"] !== options.clusterIdentifier
      ) {
        continue;
      }

      if (typeof log.body !== "string") {
        continue;
      }

      let bodyObj: JSONObject | null = null;
      try {
        bodyObj = JSON.parse(log.body) as JSONObject;
      } catch {
        continue;
      }

      const topKvList: JSONObject | undefined = bodyObj["kvlistValue"] as
        | JSONObject
        | undefined;
      if (!topKvList) {
        continue;
      }

      const objectVal: string | JSONObject | null = getKvValue(
        topKvList,
        "object",
      );
      if (!objectVal || typeof objectVal === "string") {
        continue;
      }
      const objectKvList: JSONObject = objectVal;

      const eventType: string = getKvStringValue(objectKvList, "type") || "";
      const reason: string = getKvStringValue(objectKvList, "reason") || "";
      const note: string = getKvStringValue(objectKvList, "note") || "";

      const regardingKind: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as JSONObject | undefined,
          "kind",
        ) || "";
      const regardingName: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as JSONObject | undefined,
          "name",
        ) || "";
      const regardingNamespace: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as JSONObject | undefined,
          "namespace",
        ) || "";

      if (
        regardingKind.toLowerCase() !== options.resourceKind.toLowerCase() ||
        regardingName !== options.resourceName
      ) {
        continue;
      }

      if (
        options.namespace &&
        regardingNamespace &&
        regardingNamespace !== options.namespace
      ) {
        continue;
      }

      events.push({
        timestamp: log.time
          ? OneUptimeDate.getDateAsLocalFormattedString(log.time)
          : "",
        type: eventType || "Unknown",
        reason: reason || "Unknown",
        objectKind: regardingKind || "Unknown",
        objectName: regardingName || "Unknown",
        namespace: regardingNamespace || "default",
        message: note || "",
      });
    }

    return events;
  } catch {
    return [];
  }
}

export async function fetchClusterWarningEvents(options: {
  clusterIdentifier: string;
  limit?: number | undefined;
}): Promise<Array<KubernetesEvent>> {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  if (!projectId) {
    return [];
  }

  /*
   * 3h window keeps the scan small on the overview page. K8s events
   * have a ~1h TTL in the API server anyway, so anything older won't
   * be re-ingested — a wider window mostly scans empty partitions.
   */
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -3);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eventsQueryOptions: any = {
      modelType: Log,
      query: {
        projectId: projectId,
        time: new InBetween<Date>(startDate, endDate),
        attributes: {
          "event.domain": "k8s",
          "k8s.resource.name": "events",
        },
      },
      limit: 500,
      skip: 0,
      select: {
        time: true,
        body: true,
        attributes: true,
      },
      sort: {
        time: SortOrder.Descending,
      },
      requestOptions: {},
    };
    const listResult: ListResult<Log> =
      await AnalyticsModelAPI.getList<Log>(eventsQueryOptions);

    const events: Array<KubernetesEvent> = [];
    const maxEvents: number = options.limit || 10;

    for (const log of listResult.data) {
      if (events.length >= maxEvents) {
        break;
      }

      const attrs: JSONObject = log.attributes || {};

      if (
        attrs["resource.k8s.cluster.name"] !== options.clusterIdentifier &&
        attrs["k8s.cluster.name"] !== options.clusterIdentifier
      ) {
        continue;
      }

      if (typeof log.body !== "string") {
        continue;
      }

      let bodyObj: JSONObject | null = null;
      try {
        bodyObj = JSON.parse(log.body) as JSONObject;
      } catch {
        continue;
      }

      const topKvList: JSONObject | undefined = bodyObj["kvlistValue"] as
        | JSONObject
        | undefined;
      if (!topKvList) {
        continue;
      }

      const objectVal: string | JSONObject | null = getKvValue(
        topKvList,
        "object",
      );
      if (!objectVal || typeof objectVal === "string") {
        continue;
      }
      const objectKvList: JSONObject = objectVal;

      const eventType: string = getKvStringValue(objectKvList, "type") || "";

      if (eventType !== "Warning") {
        continue;
      }

      const reason: string = getKvStringValue(objectKvList, "reason") || "";
      const note: string = getKvStringValue(objectKvList, "note") || "";

      const regardingKind: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as JSONObject | undefined,
          "kind",
        ) || "";
      const regardingName: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as JSONObject | undefined,
          "name",
        ) || "";
      const regardingNamespace: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as JSONObject | undefined,
          "namespace",
        ) || "";

      events.push({
        timestamp: log.time
          ? OneUptimeDate.getDateAsLocalFormattedString(log.time)
          : "",
        type: eventType,
        reason: reason || "Unknown",
        objectKind: regardingKind || "Unknown",
        objectName: regardingName || "Unknown",
        namespace: regardingNamespace || "default",
        message: note || "",
      });
    }

    return events;
  } catch {
    return [];
  }
}

/**
 * Fetch application logs for a pod/container from the Log table.
 * These come from the filelog receiver (not k8sobjects).
 */
export interface KubernetesLogEntry {
  timestamp: string;
  body: string;
  severity: string;
  containerName: string;
}

export async function fetchPodLogs(options: {
  clusterIdentifier: string;
  podName: string;
  containerName?: string | undefined;
  namespace?: string | undefined;
  limit?: number | undefined;
}): Promise<Array<KubernetesLogEntry>> {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  if (!projectId) {
    return [];
  }

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -6);

  const attributeFilters: Record<string, string> = {
    "resource.k8s.cluster.name": options.clusterIdentifier,
    "resource.k8s.pod.name": options.podName,
  };

  if (options.containerName) {
    attributeFilters["resource.k8s.container.name"] = options.containerName;
  }

  if (options.namespace) {
    attributeFilters["resource.k8s.namespace.name"] = options.namespace;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logsQueryOptions: any = {
      modelType: Log,
      query: {
        projectId: projectId,
        time: new InBetween<Date>(startDate, endDate),
        attributes: attributeFilters,
      },
      limit: options.limit || 200,
      skip: 0,
      select: {
        time: true,
        body: true,
        severityText: true,
        attributes: true,
      },
      sort: {
        time: SortOrder.Descending,
      },
      requestOptions: {},
    };
    const listResult: ListResult<Log> =
      await AnalyticsModelAPI.getList<Log>(logsQueryOptions);

    return listResult.data
      .filter((log: Log) => {
        const attrs: JSONObject = log.attributes || {};
        return attrs["event.domain"] !== "k8s";
      })
      .map((log: Log) => {
        const attrs: JSONObject = log.attributes || {};
        return {
          timestamp: log.time
            ? OneUptimeDate.getDateAsLocalFormattedString(log.time)
            : "",
          body: typeof log.body === "string" ? log.body : "",
          severity: log.severityText || "INFO",
          containerName: (attrs["resource.k8s.container.name"] as string) || "",
        };
      });
  } catch {
    return [];
  }
}
