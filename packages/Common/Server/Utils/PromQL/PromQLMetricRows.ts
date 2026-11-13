import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLLabelMatcher,
} from "../../../Utils/PromQL/PromQLAst";
import { PromQLSeries } from "../../../Utils/PromQL/PromQLEngineTypes";
import {
  PromQLLabels,
  PromQLLabelsTest,
  compilePromQLMatchers,
  formatPromQLValue,
  promQLLabelsKey,
} from "../../../Utils/PromQL/PromQLLabels";
import {
  PromQLMetricRequest,
  PromQLSeriesKind,
  attributesToPromQLLabels,
} from "../../../Utils/PromQL/PromQLMetricNames";

/*
 * Turns OneUptime's metric rows into PromQL series (issue #6796).
 *
 * One OpenTelemetry point becomes the Prometheus samples it stands for: a
 * gauge or sum is one sample, a histogram its cumulative buckets, count and
 * sum, a summary its quantiles, count and sum. Delta temporality is added up
 * into a running total, so rate() and increase() read a delta counter the
 * way they read a cumulative one.
 *
 * Pure, so the ClickHouse reader (PromQLMetricSeriesSource) and its tests
 * share it.
 */

export interface PromQLMetricRow {
  name: string;
  metricPointType: string | undefined;
  aggregationTemporality: string | undefined;
  attributes: Record<string, unknown>;
  timestampMs: number;
  value: number | undefined;
  count: number | undefined;
  sum: number | undefined;
  bucketCounts: Array<number>;
  explicitBounds: Array<number>;
  summaryQuantiles: Array<number>;
  summaryValues: Array<number>;
}

const toNumber: (value: unknown) => number | undefined = (
  value: unknown,
): number | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const number: number = typeof value === "number" ? value : Number(value);
  return Number.isNaN(number) && value !== "NaN" ? undefined : number;
};

const toNumberArray: (value: unknown) => Array<number> = (
  value: unknown,
): Array<number> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item: unknown): number => {
    return toNumber(item) ?? 0;
  });
};

const toText: (value: unknown) => string | undefined = (
  value: unknown,
): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  return String(value);
};

// One row as ClickHouse answers it in JSON, read defensively.
export const parsePromQLMetricRow: (
  row: Record<string, unknown>,
) => PromQLMetricRow = (row: Record<string, unknown>): PromQLMetricRow => {
  const attributes: unknown = row["attributes"];

  return {
    name: toText(row["name"]) || "",
    metricPointType: toText(row["metricPointType"]),
    aggregationTemporality: toText(row["aggregationTemporality"]),
    attributes:
      attributes && typeof attributes === "object" && !Array.isArray(attributes)
        ? (attributes as Record<string, unknown>)
        : {},
    timestampMs: toNumber(row["timestampMs"]) ?? 0,
    value: toNumber(row["value"]),
    count: toNumber(row["count"]),
    sum: toNumber(row["sum"]),
    bucketCounts: toNumberArray(row["bucketCounts"]),
    explicitBounds: toNumberArray(row["explicitBounds"]),
    summaryQuantiles: toNumberArray(row["summaryQuantiles"]),
    summaryValues: toNumberArray(row["summaryValues"]),
  };
};

interface SeriesBuilder {
  labels: PromQLLabels;
  timestampsMs: Array<number>;
  values: Array<number>;
  // The running total of a delta series.
  total: number;
}

const isDelta: (row: PromQLMetricRow) => boolean = (
  row: PromQLMetricRow,
): boolean => {
  return row.aggregationTemporality === "Delta";
};

/*
 * The series a set of rows holds for the requests, keeping only the series
 * whose labels satisfy every matcher, and only samples after `startTimeMs`
 * and up to `endTimeMs`.
 */
export const promQLSeriesFromRows: (data: {
  rows: Array<PromQLMetricRow>;
  requests: Array<PromQLMetricRequest>;
  matchers: Array<PromQLLabelMatcher>;
  startTimeMs: number;
  endTimeMs: number;
}) => Array<PromQLSeries> = (data: {
  rows: Array<PromQLMetricRow>;
  requests: Array<PromQLMetricRequest>;
  matchers: Array<PromQLLabelMatcher>;
  startTimeMs: number;
  endTimeMs: number;
}): Array<PromQLSeries> => {
  const requestsByName: Map<string, Array<PromQLMetricRequest>> = new Map();

  for (const request of data.requests) {
    const list: Array<PromQLMetricRequest> =
      requestsByName.get(request.storedName) || [];
    list.push(request);
    requestsByName.set(request.storedName, list);
  }

  // Oldest first: delta totals add up in time order.
  const rows: Array<PromQLMetricRow> = [...data.rows].sort(
    (a: PromQLMetricRow, b: PromQLMetricRow): number => {
      return a.timestampMs - b.timestampMs;
    },
  );

  const builders: Map<string, SeriesBuilder> = new Map();
  // The matchers' patterns, compiled once for every label set below.
  const accepts: PromQLLabelsTest = compilePromQLMatchers(data.matchers);
  // Label sets already checked against the matchers, by key.
  const accepted: Map<string, boolean> = new Map();

  const push: (
    seriesName: string,
    baseLabels: PromQLLabels,
    extraLabels: PromQLLabels,
    timestampMs: number,
    value: number,
    accumulate: boolean,
  ) => void = (
    seriesName: string,
    baseLabels: PromQLLabels,
    extraLabels: PromQLLabels,
    timestampMs: number,
    value: number,
    accumulate: boolean,
  ): void => {
    const labels: PromQLLabels = {
      ...baseLabels,
      ...extraLabels,
      [PROMQL_METRIC_NAME_LABEL]: seriesName,
    };
    const key: string = promQLLabelsKey(labels);
    let isAccepted: boolean | undefined = accepted.get(key);

    if (isAccepted === undefined) {
      isAccepted = accepts(labels);
      accepted.set(key, isAccepted);
    }

    if (!isAccepted) {
      return;
    }

    let builder: SeriesBuilder | undefined = builders.get(key);

    if (!builder) {
      builder = { labels, timestampsMs: [], values: [], total: 0 };
      builders.set(key, builder);
    }

    let sampleValue: number = value;

    if (accumulate) {
      builder.total += value;
      sampleValue = builder.total;
    }

    // A window's edges bound what is kept, after delta totals have added up.
    if (timestampMs <= data.startTimeMs || timestampMs > data.endTimeMs) {
      return;
    }

    const last: number = builder.timestampsMs.length - 1;

    // Two points at one time are one sample: the later row wins.
    if (last >= 0 && builder.timestampsMs[last] === timestampMs) {
      builder.values[last] = sampleValue;
      return;
    }

    builder.timestampsMs.push(timestampMs);
    builder.values.push(sampleValue);
  };

  for (const row of rows) {
    const requests: Array<PromQLMetricRequest> | undefined = requestsByName.get(
      row.name,
    );

    if (!requests) {
      continue;
    }

    const baseLabels: PromQLLabels = attributesToPromQLLabels(row.attributes);
    const pointType: string = row.metricPointType || "Gauge";
    const delta: boolean = isDelta(row);

    for (const request of requests) {
      switch (request.kind) {
        case PromQLSeriesKind.Value: {
          if (pointType === "Gauge" || pointType === "Sum") {
            if (row.value !== undefined) {
              push(
                request.seriesName,
                baseLabels,
                {},
                row.timestampMs,
                row.value,
                pointType === "Sum" && delta,
              );
            }
          } else if (pointType === "Summary") {
            row.summaryQuantiles.forEach(
              (quantile: number, index: number): void => {
                const value: number | undefined = row.summaryValues[index];

                if (value !== undefined) {
                  push(
                    request.seriesName,
                    baseLabels,
                    { quantile: formatPromQLValue(quantile) },
                    row.timestampMs,
                    value,
                    false,
                  );
                }
              },
            );
          }
          break;
        }
        case PromQLSeriesKind.Bucket: {
          if (pointType !== "Histogram" || row.bucketCounts.length === 0) {
            break;
          }

          // OpenTelemetry counts per bucket; Prometheus counts up to `le`.
          let cumulative: number = 0;

          row.bucketCounts.forEach((count: number, index: number): void => {
            cumulative += count;
            const bound: number | undefined = row.explicitBounds[index];
            const le: string =
              bound === undefined || index >= row.explicitBounds.length
                ? "+Inf"
                : formatPromQLValue(bound);

            push(
              request.seriesName,
              baseLabels,
              { le },
              row.timestampMs,
              cumulative,
              delta,
            );
          });

          // A histogram whose counts stop short of +Inf still has its total.
          if (row.bucketCounts.length <= row.explicitBounds.length) {
            push(
              request.seriesName,
              baseLabels,
              { le: "+Inf" },
              row.timestampMs,
              row.count ?? cumulative,
              delta,
            );
          }
          break;
        }
        case PromQLSeriesKind.Count: {
          if (
            (pointType === "Histogram" ||
              pointType === "ExponentialHistogram" ||
              pointType === "Summary") &&
            row.count !== undefined
          ) {
            push(
              request.seriesName,
              baseLabels,
              {},
              row.timestampMs,
              row.count,
              delta,
            );
          }
          break;
        }
        case PromQLSeriesKind.Sum: {
          if (
            pointType === "Histogram" ||
            pointType === "ExponentialHistogram" ||
            pointType === "Summary"
          ) {
            const sum: number | undefined = row.sum ?? row.value;

            if (sum !== undefined) {
              push(
                request.seriesName,
                baseLabels,
                {},
                row.timestampMs,
                sum,
                delta,
              );
            }
          }
          break;
        }
      }
    }
  }

  const series: Array<PromQLSeries> = [];

  for (const builder of builders.values()) {
    if (builder.values.length > 0) {
      series.push({
        labels: builder.labels,
        timestampsMs: builder.timestampsMs,
        values: builder.values,
      });
    }
  }

  return series;
};
