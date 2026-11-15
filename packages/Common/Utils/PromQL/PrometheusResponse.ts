import { PromQLLabels } from "./PromQLLabels";

/*
 * Reads a Prometheus HTTP API answer (issue #6796): the Metrics page's
 * PromQL tab reads OneUptime's own /api/prometheus answers with it, so the
 * page sees what Grafana sees. Values arrive as strings ("1.5", "NaN",
 * "+Inf") and times as Unix seconds.
 */

export interface PrometheusPoint {
  timestampMs: number;
  value: number;
}

export interface PrometheusSeries {
  labels: PromQLLabels;
  points: Array<PrometheusPoint>;
}

export type PrometheusResult =
  | { resultType: "matrix"; series: Array<PrometheusSeries> }
  | { resultType: "vector"; series: Array<PrometheusSeries> }
  | { resultType: "scalar"; value: PrometheusPoint }
  | { resultType: "string"; timestampMs: number; text: string };

export const parsePrometheusValue: (value: unknown) => number = (
  value: unknown,
): number => {
  if (typeof value === "number") {
    return value;
  }

  const text: string = String(value);

  if (text === "+Inf" || text === "Inf") {
    return Infinity;
  }

  if (text === "-Inf") {
    return -Infinity;
  }

  return Number(text);
};

const toPoint: (pair: unknown) => PrometheusPoint | undefined = (
  pair: unknown,
): PrometheusPoint | undefined => {
  if (!Array.isArray(pair) || pair.length < 2) {
    return undefined;
  }

  const seconds: number = Number(pair[0]);

  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  return {
    timestampMs: Math.round(seconds * 1000),
    value: parsePrometheusValue(pair[1]),
  };
};

const toLabels: (metric: unknown) => PromQLLabels = (
  metric: unknown,
): PromQLLabels => {
  if (!metric || typeof metric !== "object") {
    return {};
  }

  const labels: PromQLLabels = {};

  for (const [name, value] of Object.entries(
    metric as Record<string, unknown>,
  )) {
    labels[name] = String(value);
  }

  return labels;
};

/*
 * The result of a successful /query or /query_range answer's `data`.
 * Undefined for a shape that is not one.
 */
export const parsePrometheusResult: (
  data: unknown,
) => PrometheusResult | undefined = (
  data: unknown,
): PrometheusResult | undefined => {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const record: Record<string, unknown> = data as Record<string, unknown>;
  const resultType: unknown = record["resultType"];
  const result: unknown = record["result"];

  if (resultType === "scalar") {
    const point: PrometheusPoint | undefined = toPoint(result);
    return point ? { resultType: "scalar", value: point } : undefined;
  }

  if (resultType === "string") {
    if (!Array.isArray(result) || result.length < 2) {
      return undefined;
    }

    return {
      resultType: "string",
      timestampMs: Math.round(Number(result[0]) * 1000),
      text: String(result[1]),
    };
  }

  if (
    (resultType !== "matrix" && resultType !== "vector") ||
    !Array.isArray(result)
  ) {
    return undefined;
  }

  const series: Array<PrometheusSeries> = result.map(
    (entry: unknown): PrometheusSeries => {
      const item: Record<string, unknown> =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};
      const pairs: Array<unknown> =
        resultType === "matrix"
          ? Array.isArray(item["values"])
            ? (item["values"] as Array<unknown>)
            : []
          : [item["value"]];
      const points: Array<PrometheusPoint> = [];

      for (const pair of pairs) {
        const point: PrometheusPoint | undefined = toPoint(pair);

        if (point) {
          points.push(point);
        }
      }

      return { labels: toLabels(item["metric"]), points };
    },
  );

  return { resultType, series };
};
