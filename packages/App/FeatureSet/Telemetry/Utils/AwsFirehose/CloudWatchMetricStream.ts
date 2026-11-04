import { getAwsStoredMetricName } from "Common/Types/Cloud/CloudKeyMetrics";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
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
 * Both are turned into that OpenTelemetry 1.0 shape - the one a connection's
 * own reads write their CloudWatch metrics in (CloudMetricPayload) - so a
 * streamed metric and a read one are one series, and the ingest finds the
 * resource each datapoint is about with its own resolver
 * (CloudMonitoredResource). Every resource then carries the connection's
 * telemetry service and id, as a read's do.
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
