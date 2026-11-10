import {
  AZURE_DIMENSION_ATTRIBUTE_PREFIX,
  AZURE_ENTITY_NAME_ATTRIBUTE,
  getAzureKeyMetrics,
} from "../../../Types/Cloud/CloudKeyMetrics";
import { AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE } from "../../../Types/Cloud/CloudMonitoredResource";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

/*
 * A QUEUE A COLLECTOR READS IS THE COLLECTOR'S.
 *
 * An Azure cloud connection reads every Service Bus and Event Hubs
 * namespace of its subscriptions split by EntityName: a series per queue,
 * topic and event hub, filed on the queue when it is ingested, exactly as
 * the collector's azure_monitor receiver writes them. A project can run
 * both: a collector that read its namespaces before the connection did, or
 * one set up for metrics the connection does not read. Two copies of one
 * queue's series would count its messages twice - on its page, which adds
 * up the series it is sent, in a monitor of it, and in the namespace's own
 * totals.
 *
 * So the collector wins, per queue and per metric: before a read writes,
 * it asks which of the metrics it read a collector delivered for which
 * queues in the last COLLECTOR_QUEUE_LOOKBACK_MS (CloudCollectorQueuesReader
 * reads the stored metrics: series without a cloud connection's id), and
 * leaves those out of what it writes. Every other queue of the namespace -
 * one past the receiver's maximum_number_of_records_per_resource, or a
 * metric missing from its `metrics` list - the connection still writes. A
 * collector that stops is replaced within that lookback.
 *
 * A collector can also send a namespace's own total of a metric, split by
 * nothing: an azure_monitor receiver with its dimensions turned off, or
 * whose dimensions leave EntityName out. Its series carries the
 * namespace's resource id, as each queue's series of the read does, and
 * the namespace's totals add up every series on that id
 * (CloudResourceMetricAggregation) - its Metrics rows, a monitor of it and
 * OneUptime AI's reads of it alike - so each message would be counted
 * twice: once in the collector's total and once in its queue's series. So
 * for each metric of each namespace a collector sent a total of
 * (namespaceTotals), the read still writes each queue's series, which
 * files it on its queue, but without the namespace's resource id: the
 * namespace's totals are then the collector's alone.
 *
 * The read still judges the namespace's health from everything it read
 * (CloudResourceReadings reads its own payloads), so a namespace reads the
 * same with a collector or without one.
 */

// How long a collector's last series of a queue keeps the queue its own.
export const COLLECTOR_QUEUE_LOOKBACK_MS: number = 30 * 60 * 1000;

const AZURE_RESOURCE_TYPE_ATTRIBUTE: string = "type";
const AZURE_NAMESPACE_ATTRIBUTE: string = "name";
/*
 * The receiver's spelling of a queue's or topic's attribute: Azure answers
 * dimension names lowercased, but the documented PascalCase is read too.
 */
export const COLLECTOR_ENTITY_ATTRIBUTES: ReadonlyArray<string> = [
  AZURE_ENTITY_NAME_ATTRIBUTE,
  `${AZURE_DIMENSION_ATTRIBUTE_PREFIX}EntityName`,
];

// One metric of one queue, topic or event hub of one namespace.
export interface MessagingQueueSeriesKey {
  metricName: string;
  // The ARM type: Microsoft.ServiceBus/namespaces, Microsoft.EventHub/namespaces.
  type: string;
  namespace: string;
  entity: string;
}

/*
 * What a collector delivered lately, of the metrics and namespaces asked
 * about.
 */
export interface CollectorMessagingQueues {
  // getMessagingQueueSeriesKey of each queue's metric a collector delivered.
  series: ReadonlySet<string>;
  /*
   * When the stored series could not all be listed (the lookup's limit):
   * each metric of each namespace (getMessagingNamespaceSeriesKey) a
   * collector delivered any queue of, all of whose queues are then the
   * collector's - never a queue counted twice.
   */
  wholeNamespaces: ReadonlySet<string>;
  /*
   * Each metric of each namespace (getMessagingNamespaceSeriesKey) a
   * collector delivered the namespace's own total of, split by no queue:
   * the read's queues' series of it stay off the namespace's totals.
   */
  namespaceTotals: ReadonlySet<string>;
}

export const NO_COLLECTOR_QUEUES: CollectorMessagingQueues = {
  series: new Set<string>(),
  wholeNamespaces: new Set<string>(),
  namespaceTotals: new Set<string>(),
};

// Looks up what a collector delivered: CloudCollectorQueuesReader, or a test's fake.
export type CollectorMessagingQueuesFinder = (data: {
  projectId: ObjectID;
  // The stored metric names the read wrote split series of.
  metricNames: Array<string>;
  since: Date;
  until: Date;
}) => Promise<CollectorMessagingQueues>;

export function getMessagingNamespaceSeriesKey(
  key: Omit<MessagingQueueSeriesKey, "entity">,
): string {
  return [key.metricName, key.type, key.namespace]
    .map((part: string): string => {
      return (part || "").trim().toLowerCase();
    })
    .join("\n");
}

export function getMessagingQueueSeriesKey(
  key: MessagingQueueSeriesKey,
): string {
  return `${getMessagingNamespaceSeriesKey(key)}\n${(key.entity || "")
    .trim()
    .toLowerCase()}`;
}

// Whether the read splits this ARM type's metrics per queue and topic.
export function isSplitMessagingType(type: string): boolean {
  return Boolean(getAzureKeyMetrics(type || "")?.splitByDimension);
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): JSONArray {
  return Array.isArray(value) ? (value as JSONArray) : [];
}

function readStringAttribute(attributes: JSONArray, key: string): string {
  for (const raw of attributes) {
    const attribute: JSONObject = readObject(raw);

    if (attribute["key"] === key) {
      const value: unknown = readObject(attribute["value"])["stringValue"];
      return typeof value === "string" ? value : "";
    }
  }

  return "";
}

/*
 * The queue's metric a datapoint of a split Service Bus or Event Hubs read
 * is, or null for any other datapoint.
 */
export function readMessagingQueueSeriesKey(
  metricName: string,
  pointAttributes: JSONArray,
): MessagingQueueSeriesKey | null {
  const type: string = readStringAttribute(
    pointAttributes,
    AZURE_RESOURCE_TYPE_ATTRIBUTE,
  );

  if (!metricName || !isSplitMessagingType(type)) {
    return null;
  }

  let entity: string = "";

  for (const key of COLLECTOR_ENTITY_ATTRIBUTES) {
    entity = entity || readStringAttribute(pointAttributes, key);
  }

  const namespace: string = readStringAttribute(
    pointAttributes,
    AZURE_NAMESPACE_ATTRIBUTE,
  );

  if (!entity || !namespace) {
    return null;
  }

  return { metricName, type, namespace, entity };
}

function metricShapeOf(metric: JSONObject): "gauge" | "sum" | null {
  if (metric["gauge"]) {
    return "gauge";
  }

  return metric["sum"] ? "sum" : null;
}

/*
 * The stored names of the metrics a read wrote split queue and topic
 * series of: what the collector's are looked up by. Empty when it wrote
 * none, and nothing is looked up.
 */
export function getSplitMessagingMetricNames(
  payloads: Array<JSONObject>,
): Array<string> {
  const names: Set<string> = new Set<string>();

  for (const payload of payloads) {
    for (const rawResource of readArray(payload["resourceMetrics"])) {
      for (const rawScope of readArray(
        readObject(rawResource)["scopeMetrics"],
      )) {
        for (const rawMetric of readArray(readObject(rawScope)["metrics"])) {
          const metric: JSONObject = readObject(rawMetric);
          const name: string =
            typeof metric["name"] === "string" ? metric["name"] : "";
          const shape: "gauge" | "sum" | null = metricShapeOf(metric);

          if (!name || !shape || names.has(name)) {
            continue;
          }

          const points: JSONArray = readArray(
            readObject(metric[shape])["dataPoints"],
          );
          const isSplit: boolean = points.some((point: unknown): boolean => {
            return (
              readMessagingQueueSeriesKey(
                name,
                readArray(readObject(point)["attributes"]),
              ) !== null
            );
          });

          if (isSplit) {
            names.add(name);
          }
        }
      }
    }
  }

  return Array.from(names).sort();
}

// A datapoint without the attribute that files it on its Azure resource.
function withoutResourceId(point: JSONObject): JSONObject {
  return {
    ...point,
    attributes: readArray(point["attributes"]).filter(
      (raw: unknown): boolean => {
        return readObject(raw)["key"] !== AZURE_MONITOR_RESOURCE_ID_ATTRIBUTE;
      },
    ),
  };
}

/*
 * One read payload without the queues' metrics a collector delivered
 * lately, and how many datapoints it left out; each queue's series of a
 * metric a collector sent the namespace's total of is kept off the
 * namespace (offNamespace counts them). Null when nothing is left to
 * write. The payload given is not changed.
 */
export function withoutCollectorQueues(data: {
  payload: JSONObject;
  collector: CollectorMessagingQueues;
}): { payload: JSONObject | null; leftOut: number; offNamespace: number } {
  if (
    data.collector.series.size === 0 &&
    data.collector.wholeNamespaces.size === 0 &&
    data.collector.namespaceTotals.size === 0
  ) {
    return { payload: data.payload, leftOut: 0, offNamespace: 0 };
  }

  let leftOut: number = 0;
  let offNamespace: number = 0;
  const keptResources: Array<JSONObject> = [];

  // What becomes of one datapoint: written, left to a collector, or written off the namespace.
  const placeOf: (
    metricName: string,
    point: unknown,
  ) => "write" | "collector" | "offNamespace" = (
    metricName: string,
    point: unknown,
  ): "write" | "collector" | "offNamespace" => {
    const key: MessagingQueueSeriesKey | null = readMessagingQueueSeriesKey(
      metricName,
      readArray(readObject(point)["attributes"]),
    );

    if (key === null) {
      return "write";
    }

    const namespaceKey: string = getMessagingNamespaceSeriesKey(key);

    if (
      data.collector.series.has(getMessagingQueueSeriesKey(key)) ||
      data.collector.wholeNamespaces.has(namespaceKey)
    ) {
      return "collector";
    }

    return data.collector.namespaceTotals.has(namespaceKey)
      ? "offNamespace"
      : "write";
  };

  for (const rawResource of readArray(data.payload["resourceMetrics"])) {
    const resourceMetrics: JSONObject = readObject(rawResource);
    const keptScopes: Array<JSONObject> = [];

    for (const rawScope of readArray(resourceMetrics["scopeMetrics"])) {
      const scope: JSONObject = readObject(rawScope);
      const keptMetrics: Array<JSONObject> = [];

      for (const rawMetric of readArray(scope["metrics"])) {
        const metric: JSONObject = readObject(rawMetric);
        const name: string =
          typeof metric["name"] === "string" ? metric["name"] : "";
        const shape: "gauge" | "sum" | null = metricShapeOf(metric);

        if (!shape) {
          keptMetrics.push(metric);
          continue;
        }

        const series: JSONObject = readObject(metric[shape]);
        const points: JSONArray = readArray(series["dataPoints"]);
        const keptPoints: JSONArray = [];

        for (const point of points) {
          const place: "write" | "collector" | "offNamespace" = placeOf(
            name,
            point,
          );

          if (place === "write") {
            keptPoints.push(point);
          } else if (place === "offNamespace") {
            keptPoints.push(withoutResourceId(readObject(point)));
            offNamespace++;
          }
        }

        leftOut += points.length - keptPoints.length;

        if (keptPoints.length > 0) {
          keptMetrics.push({
            ...metric,
            [shape]: { ...series, dataPoints: keptPoints },
          });
        }
      }

      if (keptMetrics.length > 0) {
        keptScopes.push({
          ...scope,
          metrics: keptMetrics as unknown as JSONArray,
        });
      }
    }

    if (keptScopes.length > 0) {
      keptResources.push({
        ...resourceMetrics,
        scopeMetrics: keptScopes as unknown as JSONArray,
      });
    }
  }

  return {
    payload:
      keptResources.length > 0
        ? {
            ...data.payload,
            resourceMetrics: keptResources as unknown as JSONArray,
          }
        : null,
    leftOut,
    offNamespace,
  };
}
