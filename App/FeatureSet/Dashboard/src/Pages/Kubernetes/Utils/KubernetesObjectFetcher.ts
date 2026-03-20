import Log from "Common/Models/AnalyticsModels/Log";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import {
  extractObjectFromLogBody,
  getKvStringValue,
  getKvValue,
  kvListToPlainObject,
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
} from "./KubernetesObjectParser";

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
  | KubernetesPVObject;

export interface FetchK8sObjectOptions {
  clusterIdentifier: string;
  resourceType: string; // "pods", "nodes", "deployments", etc.
  resourceName: string;
  namespace?: string | undefined; // Not needed for cluster-scoped resources (nodes, namespaces)
}

type ParserFunction = (kvList: JSONObject) => KubernetesObjectType | null;

function getParser(resourceType: string): ParserFunction | null {
  const parsers: Record<string, ParserFunction> = {
    pods: parsePodObject,
    nodes: parseNodeObject,
    deployments: parseDeploymentObject,
    statefulsets: parseStatefulSetObject,
    daemonsets: parseDaemonSetObject,
    jobs: parseJobObject,
    cronjobs: parseCronJobObject,
    namespaces: parseNamespaceObject,
    persistentvolumeclaims: parsePVCObject,
    persistentvolumes: parsePVObject,
  };
  return parsers[resourceType] || null;
}

/**
 * Fetch the latest K8s resource object from the Log table.
 * The k8sobjects pull mode stores full K8s API objects as log entries.
 */
export async function fetchLatestK8sObject<T extends KubernetesObjectType>(
  options: FetchK8sObjectOptions,
): Promise<T | null> {
  const parser: ParserFunction | null = getParser(options.resourceType);
  if (!parser) {
    return null;
  }

  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  if (!projectId) {
    return null;
  }

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -24);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryOptions: any = {
      modelType: Log,
      query: {
        projectId: projectId,
        time: new InBetween<Date>(startDate, endDate),
        attributes: {
          "logAttributes.k8s.resource.name": options.resourceType,
        },
      },
      limit: 500, // Get enough logs to find the resource
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
      await AnalyticsModelAPI.getList<Log>(queryOptions);

    // Parse each log body and find the matching resource
    for (const log of listResult.data) {
      const attrs: JSONObject = log.attributes || {};

      // Filter to this cluster
      if (
        attrs["resource.k8s.cluster.name"] !== options.clusterIdentifier &&
        attrs["k8s.cluster.name"] !== options.clusterIdentifier
      ) {
        continue;
      }

      if (typeof log.body !== "string") {
        continue;
      }

      const objectKvList: JSONObject | null = extractObjectFromLogBody(
        log.body,
      );
      if (!objectKvList) {
        continue;
      }

      // Check if this is the resource we're looking for
      const metadataKv: string | JSONObject | null = getKvValue(
        objectKvList,
        "metadata",
      );
      if (!metadataKv || typeof metadataKv === "string") {
        continue;
      }

      const name: string = getKvStringValue(metadataKv, "name");
      const namespace: string = getKvStringValue(metadataKv, "namespace");

      if (name !== options.resourceName) {
        continue;
      }

      // For namespaced resources, also match namespace
      if (options.namespace && namespace && namespace !== options.namespace) {
        continue;
      }

      const parsed: KubernetesObjectType | null = parser(objectKvList);
      if (parsed) {
        return parsed as T;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch the raw K8s resource object (as a plain JS object, not parsed into typed interfaces).
 * This preserves the complete original K8s manifest for YAML display.
 */
export async function fetchRawK8sObject(
  options: FetchK8sObjectOptions,
): Promise<Record<string, unknown> | null> {
  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  if (!projectId) {
    return null;
  }

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -24);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryOptions: any = {
      modelType: Log,
      query: {
        projectId: projectId,
        time: new InBetween<Date>(startDate, endDate),
        attributes: {
          "logAttributes.k8s.resource.name": options.resourceType,
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
      await AnalyticsModelAPI.getList<Log>(queryOptions);

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

      const objectKvList: JSONObject | null = extractObjectFromLogBody(
        log.body,
      );
      if (!objectKvList) {
        continue;
      }

      const metadataKv: string | JSONObject | null = getKvValue(
        objectKvList,
        "metadata",
      );
      if (!metadataKv || typeof metadataKv === "string") {
        continue;
      }

      const name: string = getKvStringValue(metadataKv, "name");
      const namespace: string = getKvStringValue(metadataKv, "namespace");

      if (name !== options.resourceName) {
        continue;
      }

      if (options.namespace && namespace && namespace !== options.namespace) {
        continue;
      }

      // Convert the raw OTLP kvList to a plain JS object
      return kvListToPlainObject(objectKvList);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Batch fetch all K8s objects of a given type for a cluster.
 * Returns a Map keyed by "namespace/name" (or just "name" for cluster-scoped resources).
 */
export async function fetchK8sObjectsBatch(options: {
  clusterIdentifier: string;
  resourceType: string;
}): Promise<Map<string, KubernetesObjectType>> {
  const parser: ParserFunction | null = getParser(options.resourceType);
  if (!parser) {
    return new Map();
  }

  const projectId: string | undefined =
    ProjectUtil.getCurrentProjectId()?.toString();
  if (!projectId) {
    return new Map();
  }

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -24);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queryOptions: any = {
      modelType: Log,
      query: {
        projectId: projectId,
        time: new InBetween<Date>(startDate, endDate),
        attributes: {
          "logAttributes.k8s.resource.name": options.resourceType,
        },
      },
      limit: 2000,
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
      await AnalyticsModelAPI.getList<Log>(queryOptions);

    const resultMap: Map<string, KubernetesObjectType> = new Map();

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

      const objectKvList: JSONObject | null = extractObjectFromLogBody(
        log.body,
      );
      if (!objectKvList) {
        continue;
      }

      const metadataKv: string | JSONObject | null = getKvValue(
        objectKvList,
        "metadata",
      );
      if (!metadataKv || typeof metadataKv === "string") {
        continue;
      }

      const name: string = getKvStringValue(metadataKv, "name");
      const namespace: string = getKvStringValue(metadataKv, "namespace");
      const key: string = namespace ? `${namespace}/${name}` : name;

      // Only keep the latest (first encountered since sorted desc)
      if (resultMap.has(key)) {
        continue;
      }

      const parsed: KubernetesObjectType | null = parser(objectKvList);
      if (parsed) {
        resultMap.set(key, parsed);
      }
    }

    return resultMap;
  } catch {
    return new Map();
  }
}

/**
 * Fetch K8s events related to a specific resource.
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
  resourceKind: string; // "Pod", "Node", "Deployment", etc.
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
          "logAttributes.event.domain": "k8s",
          "logAttributes.k8s.resource.name": "events",
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

      // Filter to this cluster
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

      // Get the "object" which is the actual k8s Event
      const objectVal: string | JSONObject | null = getKvValue(
        topKvList,
        "object",
      );
      if (!objectVal || typeof objectVal === "string") {
        continue;
      }
      const objectKvList: JSONObject = objectVal;

      // Get event details
      const eventType: string = getKvStringValue(objectKvList, "type") || "";
      const reason: string = getKvStringValue(objectKvList, "reason") || "";
      const note: string = getKvStringValue(objectKvList, "note") || "";

      // Get regarding object
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

      // Filter to events for this specific resource
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

/**
 * Fetch recent warning events for an entire cluster.
 */
export async function fetchClusterWarningEvents(options: {
  clusterIdentifier: string;
  limit?: number | undefined;
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
          "logAttributes.event.domain": "k8s",
          "logAttributes.k8s.resource.name": "events",
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

      const eventType: string =
        getKvStringValue(objectKvList, "type") || "";

      // Only include Warning events
      if (eventType !== "Warning") {
        continue;
      }

      const reason: string =
        getKvStringValue(objectKvList, "reason") || "";
      const note: string =
        getKvStringValue(objectKvList, "note") || "";

      const regardingKind: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as
            | JSONObject
            | undefined,
          "kind",
        ) || "";
      const regardingName: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as
            | JSONObject
            | undefined,
          "name",
        ) || "";
      const regardingNamespace: string =
        getKvStringValue(
          getKvValue(objectKvList, "regarding") as
            | JSONObject
            | undefined,
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

  // Build attribute filters for filelog data
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
        // Exclude k8s event logs — only application logs
        const attrs: JSONObject = log.attributes || {};
        return attrs["logAttributes.event.domain"] !== "k8s";
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
