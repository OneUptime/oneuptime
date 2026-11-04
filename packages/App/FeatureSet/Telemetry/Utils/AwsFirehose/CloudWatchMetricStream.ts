import { storedAttributesOf } from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import EventLoop from "Common/Server/Utils/EventLoop";
import {
  AWS_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AwsStatistic,
  getAwsStoredMetricName,
} from "Common/Types/Cloud/CloudKeyMetrics";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import OldestKeyMap from "Common/Utils/OldestKeyMap";
import OtelPayloadDecoder from "../OtelPayloadDecoder";

/*
 * A CLOUDWATCH METRIC STREAM'S FIREHOSE RECORDS, AS OTLP METRICS.
 *
 * A metric stream writes each Firehose record in one of two formats
 * (Amazon CloudWatch User Guide, "Metric streams output formats"):
 *
 *   - OpenTelemetry 1.0: ExportMetricsServiceRequest messages one after
 *     another, each led by its size as a varint. Each resource is an
 *     account and Region (cloud.provider, cloud.account.id, cloud.region,
 *     aws.exporter.arn - the stream's ARN); each metric is
 *     amazonaws.com/<namespace>/<metric>, a summary of the minute (count,
 *     sum, quantile 0 the minimum, quantile 1 the maximum, and any
 *     percentile the stream adds), its datapoints carrying Namespace,
 *     MetricName and Dimensions (a key-value list).
 *   - JSON: one JSON object a line - metric_stream_name, account_id,
 *     region, namespace, metric_name, dimensions, timestamp (ms), value
 *     { max, min, sum, count, p99, ... } and unit.
 *
 * Both are turned into that OpenTelemetry 1.0 shape, with the Namespace and
 * Dimensions a connection's own reads write on each datapoint
 * (CloudMetricPayload), so the ingest finds the resource each datapoint is
 * about with its own resolver (CloudMonitoredResource). Every resource then
 * carries the connection's telemetry service and id, as a read's do. The
 * key metrics are then written in the read's own shape
 * (shapeStreamedKeyMetrics, below), so a streamed key metric and a read
 * one are one series.
 *
 * No regular expression reads a record.
 */

export const FIREHOSE_SCOPE_NAME: string = "oneuptime-aws-firehose";

export interface OtlpAttribute {
  key: string;
  value: JSONObject;
}

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key, value: { stringValue: value } };
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readArray(value: unknown): JSONArray {
  return Array.isArray(value) ? (value as JSONArray) : [];
}

export function readStringAttribute(
  attributes: JSONArray,
  key: string,
): string {
  for (const raw of attributes) {
    const attribute: JSONObject = readObject(raw);

    if (attribute["key"] === key) {
      const value: JSONValue | undefined = readObject(attribute["value"])[
        "stringValue"
      ];
      return typeof value === "string" ? value.trim() : "";
    }
  }

  return "";
}

/*
 * An OpenTelemetry 1.0 record's resources ({ resource, scopeMetrics }),
 * as decoded. Throws on bytes that are not one.
 */
export function decodeOpenTelemetryMetricRecord(
  data: Buffer,
): Array<JSONObject> {
  const resources: Array<JSONObject> = [];

  for (const message of OtelPayloadDecoder.decodeDelimitedMetrics(data)) {
    for (const resource of readArray(message["resourceMetrics"])) {
      resources.push(readObject(resource));
    }
  }

  return resources;
}

// "p99" and "p99.9" as quantiles; any other statistic is not a quantile.
function readPercentile(key: string): number | null {
  if (key.length < 2 || key[0] !== "p") {
    return null;
  }

  const value: number = Number(key.slice(1));

  // 99.9 / 100 is 0.9990000000000001 in binary: written as the decimal it is.
  return Number.isFinite(value) && value > 0 && value < 100
    ? Number((value / 100).toFixed(10))
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * One JSON-format metric update as an OTLP summary metric, and the
 * account and Region it is from - or null when the line is not one.
 */
export function readJsonMetricUpdate(
  update: JSONObject,
): { accountId: string; region: string; metric: JSONObject } | null {
  const namespace: string = readText(update["namespace"]);
  const metricName: string = readText(update["metric_name"]);
  const accountId: string = readText(update["account_id"]);
  const timestamp: number | null = readNumber(update["timestamp"]);
  const value: JSONObject = readObject(update["value"]);

  if (!namespace || !metricName || !accountId || timestamp === null) {
    return null;
  }

  const quantiles: Array<JSONObject> = [];
  const min: number | null = readNumber(value["min"]);
  const max: number | null = readNumber(value["max"]);

  if (min !== null) {
    quantiles.push({ quantile: 0, value: min });
  }

  for (const key of Object.keys(value)) {
    const quantile: number | null = readPercentile(key);
    const quantileValue: number | null = readNumber(value[key]);

    if (quantile !== null && quantileValue !== null) {
      quantiles.push({ quantile, value: quantileValue });
    }
  }

  if (max !== null) {
    quantiles.push({ quantile: 1, value: max });
  }

  const dimensions: Array<OtlpAttribute> = [];
  const rawDimensions: JSONObject = readObject(update["dimensions"]);

  for (const key of Object.keys(rawDimensions)) {
    const dimension: string = readText(rawDimensions[key]);

    if (dimension) {
      dimensions.push(stringAttribute(key, dimension));
    }
  }

  return {
    accountId,
    region: readText(update["region"]),
    metric: {
      name: getAwsStoredMetricName(namespace, metricName),
      unit: readText(update["unit"]),
      summary: {
        dataPoints: [
          {
            timeUnixNano: `${Math.trunc(timestamp)}000000`,
            count: readNumber(value["count"]) ?? 0,
            sum: readNumber(value["sum"]) ?? 0,
            quantileValues: quantiles as unknown as JSONArray,
            attributes: [
              stringAttribute("Namespace", namespace),
              stringAttribute("MetricName", metricName),
              {
                key: "Dimensions",
                value: {
                  kvlistValue: {
                    values: dimensions as unknown as JSONArray,
                  },
                },
              },
            ] as unknown as JSONArray,
          },
        ] as unknown as JSONArray,
      },
    },
  };
}

/*
 * A JSON-format record's resources, one per account and Region. A line
 * that is not a metric update is skipped.
 */
export function decodeJsonMetricRecord(text: string): Array<JSONObject> {
  const byPlace: Map<
    string,
    { accountId: string; region: string; metrics: Array<JSONObject> }
  > = new Map();
  let lineStart: number = 0;

  while (lineStart < text.length) {
    let lineEnd: number = text.indexOf("\n", lineStart);

    if (lineEnd === -1) {
      lineEnd = text.length;
    }

    const line: string = text.substring(lineStart, lineEnd).trim();
    lineStart = lineEnd + 1;

    if (!line) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    const update: {
      accountId: string;
      region: string;
      metric: JSONObject;
    } | null = readJsonMetricUpdate(readObject(parsed));

    if (!update) {
      continue;
    }

    const key: string = `${update.accountId}|${update.region}`;
    let place:
      | { accountId: string; region: string; metrics: Array<JSONObject> }
      | undefined = byPlace.get(key);

    if (!place) {
      place = {
        accountId: update.accountId,
        region: update.region,
        metrics: [],
      };
      byPlace.set(key, place);
    }

    place.metrics.push(update.metric);
  }

  return Array.from(byPlace.values()).map(
    (place: {
      accountId: string;
      region: string;
      metrics: Array<JSONObject>;
    }): JSONObject => {
      return {
        resource: {
          attributes: [
            stringAttribute("cloud.provider", "aws"),
            stringAttribute("cloud.account.id", place.accountId),
            ...(place.region
              ? [stringAttribute("cloud.region", place.region)]
              : []),
          ] as unknown as JSONArray,
        },
        scopeMetrics: [
          {
            scope: { name: FIREHOSE_SCOPE_NAME },
            metrics: place.metrics as unknown as JSONArray,
          },
        ] as unknown as JSONArray,
      };
    },
  );
}

/*
 * A resource with the connection's telemetry service and id on it, in
 * place of any service.name the stream wrote, and cloud.provider aws.
 */
export function stampConnection(data: {
  resourceMetrics: JSONObject;
  serviceName: string;
  connectionId: string;
}): JSONObject {
  const resource: JSONObject = readObject(data.resourceMetrics["resource"]);
  const attributes: Array<JSONObject> = readArray(resource["attributes"])
    .map(readObject)
    .filter((attribute: JSONObject): boolean => {
      const key: unknown = attribute["key"];
      return (
        key !== "service.name" &&
        key !== "oneuptime.cloud.connection.id" &&
        key !== "cloud.provider"
      );
    });

  return {
    ...data.resourceMetrics,
    resource: {
      ...resource,
      attributes: [
        stringAttribute("service.name", data.serviceName),
        stringAttribute("cloud.provider", "aws"),
        stringAttribute("oneuptime.cloud.connection.id", data.connectionId),
        ...attributes,
      ] as unknown as JSONArray,
    },
  };
}

export interface MetricResourceFacts {
  accountId: string;
  region: string;
  // The CloudWatch namespaces its datapoints carry.
  namespaces: Set<string>;
  datapoints: number;
}

// What one resource holds: where it is from, its namespaces, how many datapoints.
export function readMetricResourceFacts(
  resourceMetrics: JSONObject,
): MetricResourceFacts {
  const attributes: JSONArray = readArray(
    readObject(resourceMetrics["resource"])["attributes"],
  );
  const facts: MetricResourceFacts = {
    accountId: readStringAttribute(attributes, "cloud.account.id"),
    region: readStringAttribute(attributes, "cloud.region"),
    namespaces: new Set<string>(),
    datapoints: 0,
  };

  for (const rawScope of readArray(resourceMetrics["scopeMetrics"])) {
    for (const rawMetric of readArray(readObject(rawScope)["metrics"])) {
      const metric: JSONObject = readObject(rawMetric);
      const series: JSONObject = readObject(
        metric["summary"] ||
          metric["gauge"] ||
          metric["sum"] ||
          metric["histogram"],
      );

      for (const rawPoint of readArray(series["dataPoints"])) {
        facts.datapoints++;

        const namespace: string = readStringAttribute(
          readArray(readObject(rawPoint)["attributes"]),
          "Namespace",
        );

        if (namespace && facts.namespaces.size < 200) {
          facts.namespaces.add(namespace);
        }
      }
    }
  }

  return facts;
}

/*
 * THE STREAM'S KEY METRICS, IN THE SHAPE A CONNECTION'S READ WRITES THEM.
 *
 * A metric stream sends a summary of each minute - count, sum, minimum and
 * maximum - for every dimension set CloudWatch has: a function's
 * Invocations for the function, and again for each of its versions and
 * aliases; a load balancer's RequestCount for it, and again for each of
 * its zones. A connection's read writes each key metric (CloudKeyMetrics)
 * as a gauge of the one statistic it reads, for each resource's own
 * aggregate alone - the series with the fewest dimensions, never its
 * per-zone or per-version splits. While a stream delivers a namespace the
 * read no longer writes it (CloudStreamedMetrics), so the stream writes the
 * key metrics as the read would:
 *
 *   - a gauge of the read's statistic: Average is the sum over the count,
 *     Sum the sum, Maximum the quantile-1 value and Minimum the quantile-0
 *     one, at the start of the minute (CloudWatch's own time for a
 *     datapoint, as the read and the JSON format write it), in the read's
 *     unit. A minute without an observation writes nothing;
 *   - per resource and metric, only the series with the fewest dimensions
 *     (several when they tie: an ElastiCache cluster's nodes), among the
 *     delivery's and those the connection's deliveries brought in the last
 *     hour, since one minute's series can come in two deliveries; a series
 *     of no resource - a namespace's or an account's own total, with no
 *     dimension that names one - is left out, as the read leaves it.
 *
 * So a key metric is one series of one point type whichever way it came,
 * and a resource's charts, its monitors and its pages read it as before: a
 * summary's value is its sum, which a gauge of an Average is not, and a
 * resource's own aggregate counted again with its splits would double it.
 * Every other metric (Every metric, under More fields) stays the stream's
 * summary, every series of it: no read writes it.
 */

export interface StreamedKeyMetric {
  statistic: AwsStatistic;
  // The unit the read writes the metric in.
  unit: string;
}

// Each key metric by its stored name, lower case: the statistic the read reads.
export const STREAMED_KEY_METRICS: ReadonlyMap<string, StreamedKeyMetric> =
  ((): Map<string, StreamedKeyMetric> => {
    const keyMetrics: Map<string, StreamedKeyMetric> = new Map<
      string,
      StreamedKeyMetric
    >();

    for (const namespace of AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>) {
      for (const metric of namespace.metrics as ReadonlyArray<AwsKeyMetric>) {
        const name: string = getAwsStoredMetricName(
          namespace.namespace,
          metric.metricName,
        ).toLowerCase();

        if (!keyMetrics.has(name)) {
          keyMetrics.set(name, {
            statistic: metric.statistic,
            unit: metric.unit,
          });
        }
      }
    }

    return keyMetrics;
  })();

// A number as OTLP/JSON writes it: a fixed64 count or a time is a string of digits.
function readNumberLike(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/*
 * A summary datapoint's quantile, or null when it has none. Protobuf leaves
 * out a field that is 0, so an entry without its quantile is quantile 0,
 * and one without its value is 0.
 */
function readQuantileValue(point: JSONObject, quantile: number): number | null {
  for (const raw of readArray(point["quantileValues"])) {
    const entry: JSONObject = readObject(raw);
    const at: number = readNumberLike(entry["quantile"]) ?? 0;

    if (at === quantile) {
      return readNumberLike(entry["value"]) ?? 0;
    }
  }

  return null;
}

/*
 * The value of a minute's summary for the statistic the read reads, or
 * null when the minute holds no observation or does not say it.
 */
export function readStatisticValue(
  point: JSONObject,
  statistic: AwsStatistic,
): number | null {
  const count: number = readNumberLike(point["count"]) ?? 0;
  const sum: number = readNumberLike(point["sum"]) ?? 0;

  if (count <= 0) {
    return null;
  }

  // One observation is its own minimum and maximum.
  const single: number | null = count === 1 ? sum : null;

  switch (statistic) {
    case "Average":
      return sum / count;
    case "Sum":
      return sum;
    case "Maximum":
      return readQuantileValue(point, 1) ?? single;
    case "Minimum":
      return readQuantileValue(point, 0) ?? single;
  }

  return null;
}

// How many dimensions a datapoint carries: the entries of its Dimensions kvlist.
export function countDimensions(attributes: JSONArray): number {
  for (const raw of attributes) {
    const attribute: JSONObject = readObject(raw);

    if (attribute["key"] !== "Dimensions") {
      continue;
    }

    const values: JSONArray = readArray(
      readObject(readObject(attribute["value"])["kvlistValue"])["values"],
    );

    return values.filter((value: unknown): boolean => {
      const stringValue: unknown = readObject(readObject(value)["value"])[
        "stringValue"
      ];
      return typeof stringValue === "string" && stringValue.trim() !== "";
    }).length;
  }

  return 0;
}

// How long the fewest dimensions of a resource's series are remembered, and for how many.
export const STREAMED_SERIES_MEMORY_MS: number = 60 * 60 * 1000;
export const MAX_REMEMBERED_STREAMED_SERIES: number = 20_000;

/*
 * The fewest dimensions each connection's resources' key metrics came with
 * lately, in this process: a split that comes in a delivery of its own
 * after its resource's own aggregate is still left out.
 */
export class StreamedSeriesMemory {
  private entries: OldestKeyMap<string, { dimensions: number; at: number }> =
    new OldestKeyMap<string, { dimensions: number; at: number }>();

  public get(key: string, now: Date): number | undefined {
    const entry: { dimensions: number; at: number } | undefined =
      this.entries.get(key);

    if (!entry || now.getTime() - entry.at > STREAMED_SERIES_MEMORY_MS) {
      return undefined;
    }

    return entry.dimensions;
  }

  /*
   * What one delivery saw. Fewer dimensions than remembered replace them;
   * more leave them, and their time, as they are - so a resource's own
   * aggregate is forgotten an hour after it last came, never kept alive by
   * its splits.
   */
  public note(key: string, dimensions: number, now: Date): void {
    const remembered: number | undefined = this.get(key, now);

    if (remembered !== undefined && remembered < dimensions) {
      return;
    }

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    while (this.entries.size >= MAX_REMEMBERED_STREAMED_SERIES) {
      const oldest: string | undefined = this.entries.oldestKey();

      if (oldest === undefined) {
        break;
      }

      this.entries.delete(oldest);
    }

    this.entries.set(key, { dimensions, at: now.getTime() });
  }

  public get size(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }
}

export const STREAMED_SERIES_MEMORY: StreamedSeriesMemory =
  new StreamedSeriesMemory();

// Datapoints read between two yields to the event loop.
const POINTS_PER_YIELD: number = 2000;

interface KeyPointPlace {
  // The connection, the resource and the metric: null for a resource no rule knows.
  seriesKey: string | null;
  dimensions: number;
}

/*
 * One delivery's resources ({ resource, scopeMetrics }, the connection
 * stamped on them) with their key metrics in the read's shape. Nothing
 * given is changed: a resource that changes is a new object.
 */
export async function shapeStreamedKeyMetrics(data: {
  resources: Array<JSONObject>;
  connectionId: string;
  now: Date;
  memory?: StreamedSeriesMemory | undefined;
}): Promise<Array<JSONObject>> {
  const memory: StreamedSeriesMemory = data.memory || STREAMED_SERIES_MEMORY;
  const places: Map<JSONObject, KeyPointPlace> = new Map<
    JSONObject,
    KeyPointPlace
  >();
  // The fewest dimensions of each resource's key metric in this delivery.
  const deliveryFewest: Map<string, number> = new Map<string, number>();
  let read: number = 0;

  // First: which resource each key metric's datapoint is about.
  for (const resourceMetrics of data.resources) {
    const resourceAttributes: Array<OtlpAttribute> = readArray(
      readObject(resourceMetrics["resource"])["attributes"],
    ) as unknown as Array<OtlpAttribute>;
    const storedResourceAttributes: JSONObject = storedAttributesOf(
      resourceAttributes,
      [],
    ) as unknown as JSONObject;

    for (const rawScope of readArray(resourceMetrics["scopeMetrics"])) {
      for (const rawMetric of readArray(readObject(rawScope)["metrics"])) {
        const metric: JSONObject = readObject(rawMetric);
        const name: string = readText(metric["name"]);

        if (
          !metric["summary"] ||
          !STREAMED_KEY_METRICS.has(name.toLowerCase())
        ) {
          continue;
        }

        for (const rawPoint of readArray(
          readObject(metric["summary"])["dataPoints"],
        )) {
          read++;

          if (read % POINTS_PER_YIELD === 0) {
            await EventLoop.yieldToEventLoop();
          }

          const point: JSONObject = readObject(rawPoint);
          const pointAttributes: JSONArray = readArray(point["attributes"]);
          const resource: CloudMonitoredResource | null =
            resolveCloudMonitoredResource({
              metricName: name,
              attributes: {
                ...storedResourceAttributes,
                ...(storedAttributesOf(
                  [],
                  pointAttributes as unknown as Array<OtlpAttribute>,
                ) as unknown as JSONObject),
              },
            });
          const dimensions: number = countDimensions(pointAttributes);
          const seriesKey: string | null = resource
            ? `${data.connectionId}|${resource.identityKey}|${name.toLowerCase()}`
            : null;

          places.set(point, { seriesKey, dimensions });

          if (seriesKey) {
            deliveryFewest.set(
              seriesKey,
              Math.min(
                deliveryFewest.get(seriesKey) ?? Number.MAX_SAFE_INTEGER,
                dimensions,
              ),
            );
          }
        }
      }
    }
  }

  if (places.size === 0) {
    return data.resources;
  }

  // The fewest of this delivery's and those remembered from the last hour's.
  const fewest: Map<string, number> = new Map<string, number>();

  for (const [seriesKey, dimensions] of deliveryFewest) {
    fewest.set(
      seriesKey,
      Math.min(
        dimensions,
        memory.get(seriesKey, data.now) ?? Number.MAX_SAFE_INTEGER,
      ),
    );
  }

  // Then: each key metric a gauge of its resources' own aggregates.
  const shaped: Array<JSONObject> = [];

  for (const resourceMetrics of data.resources) {
    let isChanged: boolean = false;
    const scopes: Array<JSONObject> = [];

    for (const rawScope of readArray(resourceMetrics["scopeMetrics"])) {
      const scope: JSONObject = readObject(rawScope);
      const metrics: Array<JSONObject> = [];

      for (const rawMetric of readArray(scope["metrics"])) {
        const metric: JSONObject = readObject(rawMetric);
        const name: string = readText(metric["name"]);
        const keyMetric: StreamedKeyMetric | undefined =
          STREAMED_KEY_METRICS.get(name.toLowerCase());

        if (!metric["summary"] || !keyMetric) {
          metrics.push(metric);
          continue;
        }

        isChanged = true;

        const dataPoints: Array<JSONObject> = [];

        for (const rawPoint of readArray(
          readObject(metric["summary"])["dataPoints"],
        )) {
          const point: JSONObject = readObject(rawPoint);
          const place: KeyPointPlace | undefined = places.get(point);

          /*
           * A series of no resource (a namespace's or an account's own
           * total), which the read never writes, or a split of a resource
           * whose own aggregate streams.
           */
          if (
            !place?.seriesKey ||
            place.dimensions >
              (fewest.get(place.seriesKey) ?? Number.MAX_SAFE_INTEGER)
          ) {
            continue;
          }

          const value: number | null = readStatisticValue(
            point,
            keyMetric.statistic,
          );

          if (value === null) {
            continue;
          }

          const startTime: number | null = readNumberLike(
            point["startTimeUnixNano"],
          );
          const time: JSONValue | undefined =
            startTime && startTime > 0
              ? point["startTimeUnixNano"]
              : point["timeUnixNano"];

          dataPoints.push({
            ...(time !== undefined && time !== null
              ? { startTimeUnixNano: time, timeUnixNano: time }
              : {}),
            asDouble: value,
            attributes: readArray(point["attributes"]),
          });
        }

        if (dataPoints.length > 0) {
          metrics.push({
            name: metric["name"] as JSONValue,
            unit: keyMetric.unit,
            gauge: { dataPoints: dataPoints as unknown as JSONArray },
          });
        }
      }

      scopes.push({ ...scope, metrics: metrics as unknown as JSONArray });
    }

    shaped.push(
      isChanged
        ? {
            ...resourceMetrics,
            scopeMetrics: scopes as unknown as JSONArray,
          }
        : resourceMetrics,
    );
  }

  for (const [seriesKey, dimensions] of deliveryFewest) {
    memory.note(seriesKey, dimensions, data.now);
  }

  return shaped;
}
