import {
  CloudAddedMetric,
  CloudAddedMetricScope,
  getCloudAddedMetricKey,
} from "../../Types/Cloud/CloudAddedMetrics";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  resolveCloudMonitoredResource,
} from "../../Types/Cloud/CloudMonitoredResource";
import { CloudProvider } from "../../Types/Cloud/CloudPlatform";
import {
  PUBSUB_PUBLISH_OPERATIONS_METRIC,
  RetiredCloudMetric,
  RetiredCloudMetricQuery,
} from "./RetiredCloudMetricMoves";

/*
 * A DEPRECATED METRIC STAYS READ FOR WHAT STILL READS IT (#9739's gap).
 *
 * The cloud connections read neither Cosmos DB's ServerSideLatency nor
 * Pub/Sub's send_message_operation_count since #9954 moved the monitors
 * built on them to what replaces each. A monitor it could not move kept
 * its query - a Cosmos DB account that reported neither latency when the
 * migration ran, a Pub/Sub monitor of one response code - and then read
 * nothing new. So a connection keeps reading a deprecated metric, but only
 * of the resources something still reads it of (a monitor, a dashboard's
 * chart), until that is moved (MoveOffRetiredCloudMetrics, every hour):
 *
 *   - Cosmos DB: ServerSideLatency, as the read wrote it before
 *     (azure_serversidelatency_average: its primary aggregation, a minute
 *     at a time), in the account's own metrics call, at no cost. A query of
 *     another aggregation read what a collector wrote, never the
 *     connection, so nothing is read for it.
 *   - Pub/Sub: send_message_operation_count as a rate a second, as before,
 *     a series per response code, in a call narrowed to the topic's own
 *     series: one series a topic, where the read of every topic of a
 *     project cost a series per topic.
 *
 * Each is handed to the connector as an added metric (CloudAddedMetrics) -
 * of the one resource a query's filter names, else of every resource of
 * its type (a query of every account, or a filter that names none) - never
 * stored on the connection, so it neither shows as a person's addition nor
 * counts against theirs. A metric its cloud has stopped publishing is left
 * out by the read itself: Azure's metric definitions no longer list it.
 *
 * Pure: the queries are found by the caller (CloudRetiredMetricReads).
 */

export const COSMOS_DB_ACCOUNT_TYPE: string =
  "Microsoft.DocumentDB/databaseAccounts";
export const PUBSUB_TOPIC_TYPE: string = "pubsub_topic";

// Azure Monitor's name for the latency Microsoft retires, and how the read asked for it.
export const COSMOS_SERVER_SIDE_LATENCY_NAME: string = "ServerSideLatency";
export const COSMOS_SERVER_SIDE_LATENCY_AGGREGATION: string = "Average";
export const COSMOS_SERVER_SIDE_LATENCY_GRAIN: string = "PT1M";
export const COSMOS_SERVER_SIDE_LATENCY_UNIT: string = "MilliSeconds";
// What the read stored it under: the only name a query of it got the connection's points by.
export const COSMOS_SERVER_SIDE_LATENCY_READ_NAME: string =
  "azure_serversidelatency_average";

// How the read asked for Pub/Sub's publish operations: a rate a second.
export const PUBSUB_PUBLISH_OPERATIONS_ALIGNER: string = "ALIGN_RATE";
export const PUBSUB_PUBLISH_OPERATIONS_UNIT: string = "1/s";

// When the reads were made: a fixed date, so an unchanged set reads the same.
const RETIRED_READ_ADDED_AT: string = "2026-11-19T00:00:00.000Z";

/*
 * A query's filter as the store matches it, every value text; null for one
 * with any other value (an operator, a list), which names no one resource.
 */
function readTextAttributes(
  attributes: unknown,
): Record<string, string> | null {
  if (attributes === undefined || attributes === null) {
    return {};
  }

  if (typeof attributes !== "object" || Array.isArray(attributes)) {
    return null;
  }

  const text: Record<string, string> = {};

  for (const [key, value] of Object.entries(
    attributes as Record<string, unknown>,
  )) {
    if (typeof value !== "string") {
      return null;
    }

    text[key] = value;
  }

  return text;
}

// The one resource of `type` a query's filter names, or null when it names none.
function findNamedResource(
  query: RetiredCloudMetricQuery,
  type: string,
): CloudMonitoredResource | null {
  const attributes: Record<string, string> | null = readTextAttributes(
    query.attributes,
  );

  if (!attributes || Object.keys(attributes).length === 0) {
    return null;
  }

  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    { metricName: query.metricName, attributes },
  );

  return resource && resource.resourceType.toLowerCase() === type.toLowerCase()
    ? resource
    : null;
}

function withKey(metric: Omit<CloudAddedMetric, "key">): CloudAddedMetric {
  return { ...metric, key: getCloudAddedMetricKey(metric) };
}

function getCosmosRead(
  query: RetiredCloudMetricQuery,
): CloudAddedMetric | null {
  if (
    query.metricName.trim().toLowerCase() !==
    COSMOS_SERVER_SIDE_LATENCY_READ_NAME
  ) {
    return null;
  }

  const resource: CloudMonitoredResource | null = findNamedResource(
    query,
    COSMOS_DB_ACCOUNT_TYPE,
  );
  const read: Omit<CloudAddedMetric, "key"> = {
    provider: CloudProvider.Azure,
    scope: resource
      ? CloudAddedMetricScope.Resource
      : CloudAddedMetricScope.Type,
    resourceType: COSMOS_DB_ACCOUNT_TYPE,
    name: COSMOS_SERVER_SIDE_LATENCY_NAME,
    aggregation: COSMOS_SERVER_SIDE_LATENCY_AGGREGATION,
    grain: COSMOS_SERVER_SIDE_LATENCY_GRAIN,
    unit: COSMOS_SERVER_SIDE_LATENCY_UNIT,
    addedAt: RETIRED_READ_ADDED_AT,
  };

  if (resource) {
    read.cloudResourceId = buildCloudMonitoredResourceIdentifier(resource);
    read.azureResourceId = resource.providerResourceId;
  }

  return withKey(read);
}

function getPubSubRead(query: RetiredCloudMetricQuery): CloudAddedMetric {
  const resource: CloudMonitoredResource | null = findNamedResource(
    query,
    PUBSUB_TOPIC_TYPE,
  );
  const read: Omit<CloudAddedMetric, "key"> = {
    provider: CloudProvider.GCP,
    scope: resource
      ? CloudAddedMetricScope.Resource
      : CloudAddedMetricScope.Type,
    resourceType: PUBSUB_TOPIC_TYPE,
    name: PUBSUB_PUBLISH_OPERATIONS_METRIC,
    aggregation: PUBSUB_PUBLISH_OPERATIONS_ALIGNER,
    unit: PUBSUB_PUBLISH_OPERATIONS_UNIT,
    addedAt: RETIRED_READ_ADDED_AT,
  };

  if (resource) {
    const labels: Record<string, string> = {};

    // The topic's identifying labels, as its own series carry them: project_id and topic_id.
    for (const [key, value] of Object.entries(resource.telemetryAttributes)) {
      if (key.startsWith("resource.") && !key.slice(9).includes(".")) {
        labels[key.slice(9)] = value;
      }
    }

    read.cloudResourceId = buildCloudMonitoredResourceIdentifier(resource);
    read.accountId = resource.accountId;
    read.resourceLabels = labels;
  }

  return withKey(read);
}

/*
 * What keeps one query of a deprecated metric read: its metric, of the
 * resource its filter names or of every resource of its type. Null for a
 * query the connection never wrote the points of.
 */
export function getRetiredCloudMetricRead(
  query: RetiredCloudMetricQuery,
): CloudAddedMetric | null {
  switch (query.metric) {
    case RetiredCloudMetric.CosmosServerSideLatency:
      return getCosmosRead(query);
    case RetiredCloudMetric.PubSubPublishOperations:
      return getPubSubRead(query);
  }

  return null;
}

/*
 * What keeps every one of the queries read, each once: a resource's read
 * is left out where its type's is there too, which reads it already.
 */
export function getRetiredCloudMetricReads(
  queries: ReadonlyArray<RetiredCloudMetricQuery>,
): Array<CloudAddedMetric> {
  const byKey: Map<string, CloudAddedMetric> = new Map();

  for (const query of queries) {
    const read: CloudAddedMetric | null = getRetiredCloudMetricRead(query);

    if (read && !byKey.has(read.key)) {
      byKey.set(read.key, read);
    }
  }

  const typeWide: Set<string> = new Set<string>();

  for (const read of byKey.values()) {
    if (read.scope === CloudAddedMetricScope.Type) {
      typeWide.add(`${read.provider}|${read.resourceType}|${read.name}`);
    }
  }

  return Array.from(byKey.values()).filter(
    (read: CloudAddedMetric): boolean => {
      return (
        read.scope === CloudAddedMetricScope.Type ||
        !typeWide.has(`${read.provider}|${read.resourceType}|${read.name}`)
      );
    },
  );
}
