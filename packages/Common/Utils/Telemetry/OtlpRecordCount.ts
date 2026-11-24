import { JSONObject } from "../../Types/JSON";

/*
 * How many records one OTLP resource block of a batch holds: its log
 * records, its spans, its metric points or its profiles - each a row once
 * stored. A batch's counted bytes are shared out over its resources by
 * these (TelemetryIngestAttribution, #6355 and #6386): a walk over the
 * block's arrays, never over the records themselves.
 *
 * Lenient, as anything read off the wire must be: what is not an array
 * counts nothing.
 */

const lengthOf: (value: unknown) => number = (value: unknown): number => {
  return Array.isArray(value) ? value.length : 0;
};

const scopesOf: (resource: unknown, key: string) => Array<JSONObject> = (
  resource: unknown,
  key: string,
): Array<JSONObject> => {
  if (!resource || typeof resource !== "object") {
    return [];
  }

  const scopes: unknown = (resource as JSONObject)[key];

  return Array.isArray(scopes)
    ? scopes.filter((scope: unknown): boolean => {
        return Boolean(scope) && typeof scope === "object";
      })
    : [];
};

const sumOver: (
  resource: unknown,
  scopesKey: string,
  recordsKey: string,
) => number = (
  resource: unknown,
  scopesKey: string,
  recordsKey: string,
): number => {
  let records: number = 0;

  for (const scope of scopesOf(resource, scopesKey)) {
    records += lengthOf(scope[recordsKey]);
  }

  return records;
};

// A ResourceLogs block's log records.
export const countOtlpLogRecords: (resourceLog: unknown) => number = (
  resourceLog: unknown,
): number => {
  return sumOver(resourceLog, "scopeLogs", "logRecords");
};

// A ResourceSpans block's spans.
export const countOtlpSpans: (resourceSpan: unknown) => number = (
  resourceSpan: unknown,
): number => {
  return sumOver(resourceSpan, "scopeSpans", "spans");
};

// A ResourceProfiles block's profiles.
export const countOtlpProfiles: (resourceProfile: unknown) => number = (
  resourceProfile: unknown,
): number => {
  return sumOver(resourceProfile, "scopeProfiles", "profiles");
};

// The kinds of metric, each with its points under `dataPoints`.
const METRIC_DATA_KEYS: ReadonlyArray<string> = [
  "gauge",
  "sum",
  "histogram",
  "exponentialHistogram",
  "summary",
];

// A ResourceMetrics block's metric points, a metric with none counting one.
export const countOtlpMetricPoints: (resourceMetric: unknown) => number = (
  resourceMetric: unknown,
): number => {
  let points: number = 0;

  for (const scope of scopesOf(resourceMetric, "scopeMetrics")) {
    const metrics: unknown = scope["metrics"];

    if (!Array.isArray(metrics)) {
      continue;
    }

    for (const metric of metrics) {
      if (!metric || typeof metric !== "object") {
        continue;
      }

      let metricPoints: number = 0;

      for (const key of METRIC_DATA_KEYS) {
        const data: unknown = (metric as JSONObject)[key];

        if (data && typeof data === "object") {
          metricPoints += lengthOf((data as JSONObject)["dataPoints"]);
        }
      }

      points += Math.max(1, metricPoints);
    }
  }

  return points;
};
