import OneUptimeDate from "Common/Types/Date";
import Includes from "Common/Types/BaseDatabase/Includes";
import DashboardLogChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import DashboardVariable from "Common/Types/Dashboard/DashboardVariable";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import {
  LogFilter,
  queryStringToFilter,
} from "Common/Types/Log/LogQueryToFilter";
import DashboardVariableInterpolation from "Common/Utils/Dashboard/VariableInterpolation";
import DashboardChartType from "Common/Types/Dashboard/Chart/ChartType";

export type LogChartArguments = DashboardLogChartComponent["arguments"];

export interface LogHistogramBucket {
  time: string;
  severity: string;
  count: number;
}

export interface LogChartRow {
  time: string;
  [severity: string]: number | string;
}

export interface LogChartPivotResult {
  pivotedData: Array<LogChartRow>;
  severities: Array<string>;
}

export interface LogChartTimeRange {
  startTime: Date;
  endTime: Date;
  bucketSizeInMinutes: number;
}

const SEVERITY_ORDER: Array<string> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
  LogSeverity.Unspecified,
];

export function computeBucketSizeInMinutes(
  startTime: Date,
  endTime: Date,
): number {
  const diffMinutes: number =
    (endTime.getTime() - startTime.getTime()) / (1000 * 60);

  let bucketSizeInMinutes: number;
  if (diffMinutes <= 60) {
    bucketSizeInMinutes = 1;
  } else if (diffMinutes <= 360) {
    bucketSizeInMinutes = 5;
  } else if (diffMinutes <= 1440) {
    bucketSizeInMinutes = 15;
  } else if (diffMinutes <= 10080) {
    bucketSizeInMinutes = 60;
  } else if (diffMinutes <= 43200) {
    bucketSizeInMinutes = 360;
  } else {
    bucketSizeInMinutes = 1440;
  }

  // Keep even unusually large custom ranges to roughly 300 rendered buckets.
  return Math.max(
    bucketSizeInMinutes,
    Math.ceil(Math.max(diffMinutes, 1) / 300),
  );
}

export function resolveLogChartType(chartType: unknown): DashboardChartType {
  if (
    chartType === DashboardChartType.Line ||
    chartType === DashboardChartType.Area
  ) {
    return chartType;
  }

  return DashboardChartType.Bar;
}

/*
 * The histogram endpoint supports exact attribute equality. New widgets
 * store a structured key/value record; the query string remains only as a
 * fallback for widgets saved before the friendly editor existed.
 */
export function getExactAttributeFilters(data: {
  attributeFilters?: LogChartArguments["attributeFilters"] | undefined;
  attributeFilterQuery?: string | undefined;
  variables?: Array<DashboardVariable> | undefined;
}): Record<string, string | Array<string>> {
  let parsedAttributes: Record<string, unknown> = {};

  if (data.attributeFilters !== undefined) {
    parsedAttributes = { ...data.attributeFilters };
  } else if (data.attributeFilterQuery?.trim()) {
    const parsedFilter: LogFilter = queryStringToFilter(
      data.attributeFilterQuery.trim(),
    );
    parsedAttributes = parsedFilter.attributes || {};
  }

  const interpolatedAttributes: Record<string, unknown> =
    DashboardVariableInterpolation.applyToAttributes(
      parsedAttributes,
      data.variables,
    );

  const exactAttributes: Record<string, string | Array<string>> = {};
  for (const [key, value] of Object.entries(interpolatedAttributes)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      exactAttributes[key] = String(value);
    } else if (value instanceof Includes) {
      const values: Array<string> = value.values.map(
        (item: unknown): string => {
          return String(item);
        },
      );
      if (values.length > 0) {
        exactAttributes[key] = values;
      }
    }
  }

  return exactAttributes;
}

export function buildLogHistogramRequest(data: {
  arguments: LogChartArguments;
  startTime: Date;
  endTime: Date;
  variables?: Array<DashboardVariable> | undefined;
}): JSONObject {
  const request: JSONObject = {
    startTime: data.startTime.toISOString(),
    endTime: data.endTime.toISOString(),
    bucketSizeInMinutes: computeBucketSizeInMinutes(
      data.startTime,
      data.endTime,
    ),
  };

  const severityFilters: Array<string> = (
    data.arguments.severityFilters || []
  ).filter(Boolean);
  if (severityFilters.length > 0) {
    request["severityTexts"] = severityFilters;
  }

  const bodyContains: string | undefined =
    data.arguments.bodyContains?.trim() || undefined;
  if (bodyContains) {
    request["bodySearchText"] = bodyContains;
  }

  const attributes: Record<string, string | Array<string>> =
    getExactAttributeFilters({
      attributeFilters: data.arguments.attributeFilters,
      attributeFilterQuery: data.arguments.attributeFilterQuery,
      variables: data.variables,
    });
  if (Object.keys(attributes).length > 0) {
    request["attributes"] = attributes as unknown as JSONObject;
  }

  return request;
}

export function pivotLogHistogramBuckets(
  buckets: Array<LogHistogramBucket>,
  timeRange?: LogChartTimeRange | undefined,
): LogChartPivotResult {
  if (buckets.length === 0) {
    return { pivotedData: [], severities: [] };
  }

  const rowsByTime: Map<string, LogChartRow> = new Map();
  const presentSeverities: Set<string> = new Set();
  const bucketSizeInMs: number =
    (timeRange?.bucketSizeInMinutes || 0) * 60 * 1000;
  const rangeStartInMs: number = timeRange
    ? Math.floor(timeRange.startTime.getTime() / bucketSizeInMs) *
      bucketSizeInMs
    : NaN;
  const rangeEndInMs: number = timeRange
    ? Math.floor(timeRange.endTime.getTime() / bucketSizeInMs) * bucketSizeInMs
    : NaN;
  const rangeBucketCount: number =
    bucketSizeInMs > 0 && isFinite(rangeStartInMs) && isFinite(rangeEndInMs)
      ? Math.floor((rangeEndInMs - rangeStartInMs) / bucketSizeInMs) + 1
      : 0;
  const shouldFillRange: boolean =
    rangeBucketCount > 0 && rangeBucketCount <= 500;

  if (shouldFillRange) {
    for (
      let timestamp: number = rangeStartInMs;
      timestamp <= rangeEndInMs;
      timestamp += bucketSizeInMs
    ) {
      const time: string = new Date(timestamp).toISOString();
      rowsByTime.set(time, { time });
    }
  }

  for (const bucket of buckets) {
    let time: string = bucket.time;
    if (shouldFillRange) {
      const bucketDate: Date = OneUptimeDate.fromString(bucket.time);
      if (isNaN(bucketDate.getTime())) {
        continue;
      }
      const timestamp: number =
        Math.floor(bucketDate.getTime() / bucketSizeInMs) * bucketSizeInMs;
      if (timestamp < rangeStartInMs || timestamp > rangeEndInMs) {
        continue;
      }
      time = new Date(timestamp).toISOString();
    }

    let row: LogChartRow | undefined = rowsByTime.get(time);
    if (!row) {
      row = { time };
      rowsByTime.set(time, row);
    }

    const severity: string = bucket.severity || LogSeverity.Unspecified;
    presentSeverities.add(severity);
    row[severity] =
      ((row[severity] as number) || 0) + Number(bucket.count || 0);
  }

  const knownSeverities: Array<string> = SEVERITY_ORDER.filter(
    (severity: string): boolean => {
      return presentSeverities.has(severity);
    },
  );
  const unknownSeverities: Array<string> = Array.from(presentSeverities)
    .filter((severity: string): boolean => {
      return !SEVERITY_ORDER.includes(severity);
    })
    .sort();
  const severities: Array<string> = [...knownSeverities, ...unknownSeverities];

  for (const row of rowsByTime.values()) {
    for (const severity of severities) {
      if (row[severity] === undefined) {
        row[severity] = 0;
      }
    }
  }

  return {
    pivotedData: Array.from(rowsByTime.values()),
    severities,
  };
}

export function formatLogChartTickTime(
  time: string,
  includeDate: boolean = false,
): string {
  const date: Date = OneUptimeDate.fromString(time);
  if (isNaN(date.getTime())) {
    return time;
  }

  const timeLabel: string = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (!includeDate) {
    return timeLabel;
  }

  const dateLabel: string = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
  return `${dateLabel}, ${timeLabel}`;
}

export function formatLogCount(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }
  return Math.round(value).toLocaleString();
}
