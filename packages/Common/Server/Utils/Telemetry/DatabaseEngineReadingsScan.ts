import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import {
  DatabaseEngineReadingQuery,
  getDatabaseEngineReadingMetricNames,
  getDatabaseEngineReadingQueries,
  getDatabaseEngineReadingsInstanceName,
} from "../../../Types/DatabaseServer/DatabaseEngineReadings";
import { JSONArray, JSONObject, JSONValue } from "../../../Types/JSON";
import { readAttribute } from "./HostReadingsScan";

/*
 * ------------------------------------------------------------------
 * WHAT A DATABASE'S ENGINE REPORTED, READ FROM ONE METRICS BATCH
 * ------------------------------------------------------------------
 *
 * A database receiver (the Database Agent's, or a collector's own) sends a
 * scrape as one export: a resource per database for PostgreSQL's
 * per-database metrics, one for the server's own, one per Elasticsearch
 * node. The metrics ingest hands every resource it attributed to a
 * DatabaseServer here, and this works out each alert template query
 * (DatabaseEngineReadings.getDatabaseEngineReadingQueries) from the
 * resource's datapoints: the ones of the query's metric whose datapoint
 * attributes match the ones it pins, folded the way the query's
 * aggregation folds a bucket. A batch's resources of one database and one
 * reporting instance add up (accumulate), and finish() turns them into the
 * values stored on the database's record (DatabaseServerService
 * .recordEngineReadings).
 *
 * Only the template queries' metrics are read: a PostgreSQL server with
 * thousands of tables sends thousands of table-size datapoints no rule
 * looks at.
 *
 * Pure: no database, no network, no clock. The values come from the
 * database's collector, so every number is checked to be finite.
 */

// What one query's matching datapoints add up to, before it is folded.
export interface DatabaseEngineReadingAccumulator {
  sum: number;
  count: number;
  min: number;
  max: number;
}

export type DatabaseEngineReadingAccumulators = Map<
  string,
  DatabaseEngineReadingAccumulator
>;

function finiteNumber(value: JSONValue | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function datapointValue(datapoint: JSONObject): number | null {
  const asInt: number | null = finiteNumber(datapoint["asInt"]);
  if (asInt !== null) {
    return asInt;
  }
  return finiteNumber(datapoint["asDouble"]);
}

function datapoints(metric: JSONObject): Array<JSONObject> {
  const wrapper: JSONObject | undefined =
    (metric["gauge"] as JSONObject | undefined) ||
    (metric["sum"] as JSONObject | undefined);
  const points: JSONValue | undefined = wrapper?.["dataPoints"];
  if (!Array.isArray(points)) {
    return [];
  }
  return points.filter((point: JSONValue): boolean => {
    return Boolean(point) && typeof point === "object" && !Array.isArray(point);
  }) as Array<JSONObject>;
}

function matchesPinnedAttributes(
  datapoint: JSONObject,
  attributes: Readonly<Record<string, string>>,
): boolean {
  for (const key of Object.keys(attributes)) {
    if (readAttribute(datapoint["attributes"], key) !== attributes[key]) {
      return false;
    }
  }
  return true;
}

function addValue(
  accumulators: DatabaseEngineReadingAccumulators,
  key: string,
  value: number,
): void {
  const existing: DatabaseEngineReadingAccumulator | undefined =
    accumulators.get(key);
  if (!existing) {
    accumulators.set(key, { sum: value, count: 1, min: value, max: value });
    return;
  }
  existing.sum += value;
  existing.count += 1;
  existing.min = Math.min(existing.min, value);
  existing.max = Math.max(existing.max, value);
}

/*
 * Adds one resource's datapoints to `accumulators`, by reading key. Returns
 * how many datapoints a template query read.
 */
export function accumulateDatabaseEngineReadings(data: {
  accumulators: DatabaseEngineReadingAccumulators;
  scopeMetrics: JSONArray;
}): number {
  const metricNames: ReadonlySet<string> =
    getDatabaseEngineReadingMetricNames();
  const queries: ReadonlyArray<DatabaseEngineReadingQuery> =
    getDatabaseEngineReadingQueries();
  let read: number = 0;

  for (const scopeMetric of data.scopeMetrics || []) {
    if (!scopeMetric || typeof scopeMetric !== "object") {
      continue;
    }
    const metrics: JSONValue | undefined = (scopeMetric as JSONObject)[
      "metrics"
    ];
    if (!Array.isArray(metrics)) {
      continue;
    }
    for (const metric of metrics) {
      if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
        continue;
      }
      const name: string = String((metric as JSONObject)["name"] || "");
      if (!metricNames.has(name)) {
        continue;
      }
      const points: Array<JSONObject> = datapoints(metric as JSONObject);
      for (const query of queries) {
        if (query.metricName !== name) {
          continue;
        }
        for (const point of points) {
          if (!matchesPinnedAttributes(point, query.attributes)) {
            continue;
          }
          const value: number | null = datapointValue(point);
          if (value === null) {
            continue;
          }
          addValue(data.accumulators, query.key, value);
          read++;
        }
      }
    }
  }

  return read;
}

// Readings stored to six decimals: a share or a ratio keeps its precision.
function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/*
 * The values a batch's accumulated datapoints come to, each folded by its
 * query's aggregation - what the database's record stores for the
 * instance that sent them.
 */
export function finishDatabaseEngineReadings(
  accumulators: DatabaseEngineReadingAccumulators,
): Record<string, number> {
  const aggregations: Map<string, AggregationType> = new Map<
    string,
    AggregationType
  >();
  for (const query of getDatabaseEngineReadingQueries()) {
    aggregations.set(query.key, query.aggregationType);
  }

  const values: Record<string, number> = {};
  for (const [key, accumulator] of accumulators) {
    let value: number | null = null;
    switch (aggregations.get(key)) {
      case AggregationType.Sum:
        value = accumulator.sum;
        break;
      case AggregationType.Count:
        value = accumulator.count;
        break;
      case AggregationType.Max:
        value = accumulator.max;
        break;
      case AggregationType.Min:
        value = accumulator.min;
        break;
      case AggregationType.Avg:
        value = accumulator.count > 0 ? accumulator.sum / accumulator.count : 0;
        break;
      default:
        value = null;
    }
    if (value !== null && Number.isFinite(value)) {
      values[key] = round6(value);
    }
  }
  return values;
}

// The reporting instance a resource names: its server.address and port.
export function getDatabaseEngineReadingsInstanceFromAttributes(
  resourceAttributes: JSONArray,
): string {
  return getDatabaseEngineReadingsInstanceName({
    serverAddress: readAttribute(resourceAttributes, "server.address"),
    serverPort: readAttribute(resourceAttributes, "server.port"),
  });
}
