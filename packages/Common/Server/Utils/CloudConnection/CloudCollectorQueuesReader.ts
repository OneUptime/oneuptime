import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "../../../Types/Cloud/CloudConnectionTelemetry";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import MetricService from "../../Services/MetricService";
import {
  COLLECTOR_ENTITY_ATTRIBUTES,
  CollectorMessagingQueues,
  NO_COLLECTOR_QUEUES,
  getMessagingNamespaceSeriesKey,
  getMessagingQueueSeriesKey,
  isSplitMessagingType,
} from "./CloudCollectorQueues";

/*
 * WHICH QUEUES A COLLECTOR DELIVERED LATELY, FROM THE STORED METRICS.
 *
 * One grouped count over the metrics a read wrote split series of
 * (CloudCollectorQueues), in the window asked: grouped by the metric's
 * name, the resource type, the namespace (`name`) and the entity
 * (metadata_entityname, or the documented metadata_EntityName), of the
 * series that carry no cloud connection's id - what a collector sent, never
 * what a connection's read or stream did. A series of another resource
 * type sharing a name (azure_incomingmessages_total) is left out here. A
 * group with no entity is the namespace's own total of the metric, as a
 * receiver with its dimensions off sends it (namespaceTotals).
 */

// Groups one lookup lists at most; past it, whole namespaces are the collector's.
export const COLLECTOR_QUEUE_LOOKUP_LIMIT: number = 10000;

const STORED_CONNECTION_ID_KEY: string = `resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readCollectorQueuesFromRows(data: {
  rows: Array<AggregatedModel>;
  isComplete: boolean;
}): CollectorMessagingQueues {
  const series: Set<string> = new Set<string>();
  const wholeNamespaces: Set<string> = new Set<string>();
  const namespaceTotals: Set<string> = new Set<string>();

  for (const row of data.rows) {
    const attributes: JSONObject =
      row["attributes"] &&
      typeof row["attributes"] === "object" &&
      !Array.isArray(row["attributes"])
        ? (row["attributes"] as JSONObject)
        : {};
    const metricName: string = readText(row["name"]);
    const type: string = readText(attributes["type"]);
    const namespace: string = readText(attributes["name"]);
    let entity: string = "";

    for (const key of COLLECTOR_ENTITY_ATTRIBUTES) {
      entity = entity || readText(attributes[key]);
    }

    if (!metricName || !namespace || !isSplitMessagingType(type)) {
      continue;
    }

    // The namespace's own total, split by no queue: the collector's to count.
    if (!entity) {
      namespaceTotals.add(
        getMessagingNamespaceSeriesKey({ metricName, type, namespace }),
      );
      continue;
    }

    series.add(
      getMessagingQueueSeriesKey({ metricName, type, namespace, entity }),
    );

    if (!data.isComplete) {
      wholeNamespaces.add(
        getMessagingNamespaceSeriesKey({ metricName, type, namespace }),
      );
    }
  }

  return { series, wholeNamespaces, namespaceTotals };
}

export async function findCollectorMessagingQueues(data: {
  projectId: ObjectID;
  metricNames: Array<string>;
  since: Date;
  until: Date;
}): Promise<CollectorMessagingQueues> {
  if (data.metricNames.length === 0) {
    return NO_COLLECTOR_QUEUES;
  }

  const result: AggregatedResult = await MetricService.aggregateBy({
    query: {
      projectId: data.projectId,
      name:
        data.metricNames.length === 1
          ? data.metricNames[0]!
          : new Includes(data.metricNames),
      time: new InBetween<Date>(data.since, data.until),
      attributes: { [STORED_CONNECTION_ID_KEY]: new IsNull() },
    } as never,
    aggregationType: AggregationType.Count,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    aggregationInterval: AggregationInterval.Total,
    startTimestamp: data.since,
    endTimestamp: data.until,
    groupBy: { name: true },
    groupByAttributeKeys: ["type", "name", ...COLLECTOR_ENTITY_ATTRIBUTES],
    limit: COLLECTOR_QUEUE_LOOKUP_LIMIT,
    skip: 0,
    props: { isRoot: true },
  });

  return readCollectorQueuesFromRows({
    rows: (result.data || []) as Array<AggregatedModel>,
    isComplete: !result.truncated,
  });
}
