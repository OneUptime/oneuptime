import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import DashboardTraceChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";

/*
 * Pure, React-free data helpers for the trace chart widget. Kept out of the
 * .tsx (which imports recharts) so the request-building and pivot logic — the
 * core of "does the chart render the right thing" — can be unit-tested in the
 * node test environment.
 */

export type TraceChartArguments = DashboardTraceChartComponent["arguments"];

export interface TimeseriesRow {
  time: string;
  value: number;
  groupValues: Record<string, string>;
}

export interface PivotedRow {
  time: string;
  [series: string]: number | string;
}

export interface PivotResult {
  pivotedData: Array<PivotedRow>;
  seriesKeys: Array<string>;
}

// Count-style metrics render as bars; everything else is a duration (ms).
export function isDurationMetric(metric: string): boolean {
  return metric !== "count" && metric !== "errorCount";
}

export function formatDurationMs(ms: number): string {
  if (!isFinite(ms)) {
    return "-";
  }
  if (ms < 1) {
    return `${Math.round(ms * 1000)} µs`;
  }
  if (ms < 1000) {
    return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)} s`;
  }
  return `${(ms / 60000).toFixed(1)} min`;
}

export function formatCount(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }
  return Math.round(value).toLocaleString();
}

export function formatTickTime(time: string): string {
  const date: Date = OneUptimeDate.fromString(time);
  if (isNaN(date.getTime())) {
    return time;
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function computeBucketSizeInMinutes(
  startTime: Date,
  endTime: Date,
): number {
  const diffMinutes: number =
    (endTime.getTime() - startTime.getTime()) / (1000 * 60);
  if (diffMinutes <= 60) {
    return 1;
  }
  if (diffMinutes <= 360) {
    return 5;
  }
  if (diffMinutes <= 1440) {
    return 15;
  }
  if (diffMinutes <= 10080) {
    return 60;
  }
  return 360;
}

/*
 * Normalize the saved attribute filters into a flat key=value record the
 * trace analytics endpoint expects. Accepts both the structured record the
 * editor now writes and the legacy "key=value; key2=value2" string.
 */
export function parseAttributeFilters(
  raw: string | Record<string, unknown> | undefined,
): Record<string, string> {
  const filters: Record<string, string> = {};
  if (!raw) {
    return filters;
  }

  if (typeof raw === "string") {
    for (const pair of raw.split(";")) {
      const eqIndex: number = pair.indexOf("=");
      if (eqIndex <= 0) {
        continue;
      }
      const key: string = pair.substring(0, eqIndex).trim();
      const value: string = pair.substring(eqIndex + 1).trim();
      if (key && value) {
        filters[key] = value;
      }
    }
    return filters;
  }

  for (const rawKey of Object.keys(raw)) {
    const key: string = rawKey.trim();
    const rawValue: unknown = raw[rawKey];
    if (!key || rawValue === undefined || rawValue === null) {
      continue;
    }
    /*
     * Equality filters serialize to scalars; an object (operator-wrapped
     * value) is unwrapped defensively so a value still reaches the query.
     */
    const scalar: unknown =
      typeof rawValue === "object"
        ? (rawValue as { value?: unknown }).value
        : rawValue;
    if (scalar === undefined || scalar === null) {
      continue;
    }
    const value: string = String(scalar).trim();
    if (value) {
      filters[key] = value;
    }
  }
  return filters;
}

export interface BuildTraceAnalyticsRequestParams {
  arguments: TraceChartArguments;
  startTime: Date;
  endTime: Date;
}

/*
 * Build the POST body for /telemetry/traces/analytics from the widget's
 * stored arguments. Optional filters are only included when set so the
 * backend doesn't receive empty objects.
 */
export function buildTraceAnalyticsRequest(
  params: BuildTraceAnalyticsRequestParams,
): JSONObject {
  const args: TraceChartArguments = params.arguments;
  const metric: string = args.metric || "count";

  const requestData: JSONObject = {
    startTime: params.startTime.toISOString(),
    endTime: params.endTime.toISOString(),
    bucketSizeInMinutes: computeBucketSizeInMinutes(
      params.startTime,
      params.endTime,
    ),
    chartType: "timeseries",
    metric,
    /*
     * Dashboard form arguments may arrive as strings — coerce so the
     * server-side numeric check doesn't silently fall back to 10.
     */
    limit: Number(args.topLimit) || 10,
    /*
     * Root spans only by default, matching the traces explorer the user
     * compares against. Including child spans flips it off.
     */
    rootOnly: !args.includeChildSpans,
  };

  const spanNameContains: string | undefined =
    args.spanNameContains?.trim() || undefined;
  if (spanNameContains) {
    requestData["spanNameSearches"] = [spanNameContains];
  }

  const attributes: Record<string, string> = parseAttributeFilters(
    args.attributeFilters,
  );
  if (Object.keys(attributes).length > 0) {
    requestData["attributes"] = attributes;
  }

  const groupByAttribute: string | undefined =
    args.groupByAttribute?.trim() || undefined;
  if (groupByAttribute) {
    requestData["groupBy"] = [groupByAttribute];
  }

  return requestData;
}

/*
 * Collapse the flat timeseries rows the endpoint returns into one row per
 * timestamp with a column per series. A row with no groupValues is the
 * single, unsplit series and is keyed by the metric name.
 */
export function pivotTimeseries(
  rows: Array<TimeseriesRow>,
  metric: string,
): PivotResult {
  const map: Map<string, PivotedRow> = new Map();
  const seriesKeysSet: Set<string> = new Set();

  for (const row of rows) {
    let pivotRow: PivotedRow | undefined = map.get(row.time);
    if (!pivotRow) {
      pivotRow = { time: row.time };
      map.set(row.time, pivotRow);
    }
    const seriesKey: string =
      Object.values(row.groupValues || {}).join(" / ") || metric;
    seriesKeysSet.add(seriesKey);
    pivotRow[seriesKey] = row.value;
  }

  return {
    pivotedData: Array.from(map.values()),
    seriesKeys: Array.from(seriesKeysSet),
  };
}
