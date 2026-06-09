import ObjectID from "Common/Types/ObjectID";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectUtil from "Common/UI/Utils/Project";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";

export interface TimePoint {
  x: Date;
  y: number;
}

/*
 * RED (Rate / Errors / Duration) metrics + trend series derived from the
 * Span analytics model. Shared by the Serverless, Cloud and RUM overview
 * pages — all span-heavy workloads (invocations / requests / page loads),
 * so spans are the universal, always-present signal.
 */
export interface SpanMetrics {
  total: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
  countSeries: Array<TimePoint>;
  errorSeries: Array<TimePoint>;
  p95Series: Array<TimePoint>;
}

export interface SpanScope {
  attributes?: Record<string, string> | undefined;
  serviceId?: ObjectID | undefined;
  start: Date;
  end: Date;
}

const getBucketDate: (p: AggregatedModel) => Date | null = (
  p: AggregatedModel,
): Date | null => {
  const raw: unknown =
    p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
  if (raw instanceof Date) {
    return raw;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const d: Date = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const toTimePoints: (
  result: AggregatedResult,
  scale?: number,
) => Array<TimePoint> = (
  result: AggregatedResult,
  scale: number = 1,
): Array<TimePoint> => {
  const points: Array<TimePoint> = [];
  for (const p of (result.data || []) as Array<AggregatedModel>) {
    const x: Date | null = getBucketDate(p);
    const y: number = Number(p["value"]);
    if (x && Number.isFinite(y)) {
      points.push({ x: x, y: y * scale });
    }
  }
  points.sort((a: TimePoint, b: TimePoint): number => {
    return a.x.getTime() - b.x.getTime();
  });
  return points;
};

const sumY: (series: Array<TimePoint>) => number = (
  series: Array<TimePoint>,
): number => {
  return series.reduce((acc: number, p: TimePoint): number => {
    return acc + p.y;
  }, 0);
};

const meanY: (series: Array<TimePoint>) => number | null = (
  series: Array<TimePoint>,
): number | null => {
  if (series.length === 0) {
    return null;
  }
  return sumY(series) / series.length;
};

export const fetchSpanMetrics: (scope: SpanScope) => Promise<SpanMetrics> =
  async (scope: SpanScope): Promise<SpanMetrics> => {
    const empty: SpanMetrics = {
      total: 0,
      errors: 0,
      errorRatePercent: null,
      p95DurationMs: null,
      countSeries: [],
      errorSeries: [],
      p95Series: [],
    };

    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (!projectId) {
      return empty;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseQuery: any = {
      projectId: projectId,
      startTime: new InBetween<Date>(scope.start, scope.end),
    };
    if (scope.serviceId) {
      baseQuery.serviceId = scope.serviceId;
    }
    if (scope.attributes && Object.keys(scope.attributes).length > 0) {
      baseQuery.attributes = scope.attributes;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorQuery: any = { ...baseQuery, statusCode: SpanStatus.Error };

    const build: (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: any,
      aggregationType: AggregationType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ) => any = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: any,
      aggregationType: AggregationType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): any => {
      return {
        query: query,
        aggregationType: aggregationType,
        aggregateColumnName: "durationUnixNano",
        aggregationTimestampColumnName: "startTime",
        startTimestamp: scope.start,
        endTimestamp: scope.end,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { startTime: SortOrder.Descending },
      };
    };

    try {
      const [countResult, errorResult, p95Result]: [
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
      ] = await Promise.all([
        AnalyticsModelAPI.aggregate<Span>({
          modelType: Span,
          aggregateBy: build(baseQuery, AggregationType.Count) as AggregateBy<Span>,
        }),
        AnalyticsModelAPI.aggregate<Span>({
          modelType: Span,
          aggregateBy: build(
            errorQuery,
            AggregationType.Count,
          ) as AggregateBy<Span>,
        }),
        AnalyticsModelAPI.aggregate<Span>({
          modelType: Span,
          aggregateBy: build(baseQuery, AggregationType.P95) as AggregateBy<Span>,
        }),
      ]);

      const countSeries: Array<TimePoint> = toTimePoints(countResult);
      const errorSeries: Array<TimePoint> = toTimePoints(errorResult);
      // durationUnixNano (nanoseconds) → milliseconds for display.
      const p95Series: Array<TimePoint> = toTimePoints(p95Result, 1 / 1_000_000);

      const total: number = sumY(countSeries);
      const errors: number = sumY(errorSeries);

      return {
        total: total,
        errors: errors,
        errorRatePercent: total > 0 ? (errors / total) * 100 : null,
        p95DurationMs: meanY(p95Series),
        countSeries: countSeries,
        errorSeries: errorSeries,
        p95Series: p95Series,
      };
    } catch {
      return empty;
    }
  };

export interface MetricScope {
  name: string;
  attributes?: Record<string, string> | undefined;
  serviceId?: ObjectID | undefined;
  aggregationType: AggregationType;
  start: Date;
  end: Date;
}

/*
 * Time series for a named Metric (e.g. container.memory.usage). Returns the
 * value per time bucket; scale converts units if needed.
 */
export const fetchMetricSeries: (
  scope: MetricScope,
  scale?: number,
) => Promise<Array<TimePoint>> = async (
  scope: MetricScope,
  scale: number = 1,
): Promise<Array<TimePoint>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId) {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    projectId: projectId,
    time: new InBetween<Date>(scope.start, scope.end),
    name: scope.name,
  };
  if (scope.serviceId) {
    query.serviceId = scope.serviceId;
  }
  if (scope.attributes && Object.keys(scope.attributes).length > 0) {
    query.attributes = scope.attributes;
  }

  try {
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aggregateBy: {
        query: query,
        aggregationType: scope.aggregationType,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: scope.start,
        endTimestamp: scope.end,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { time: SortOrder.Descending },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    return toTimePoints(result, scale);
  } catch {
    return [];
  }
};

export interface WebVital {
  key: string;
  label: string;
  value: number | null;
  unit: "ms" | "score";
  // Core Web Vitals thresholds (good < warn, poor >= danger).
  thresholds: { warn: number; danger: number };
}

/*
 * Best-effort Core Web Vitals. OpenTelemetry has no finalized web-vitals
 * metric convention, so we probe the common community / SDK metric names
 * for each vital and surface the first that reports data. Empty when the
 * browser SDK does not emit web vitals (the page renders a clear hint).
 */
const WEB_VITAL_DEFS: Array<{
  key: string;
  label: string;
  unit: "ms" | "score";
  thresholds: { warn: number; danger: number };
  names: Array<string>;
}> = [
  {
    key: "lcp",
    label: "Largest Contentful Paint",
    unit: "ms",
    thresholds: { warn: 2500, danger: 4000 },
    names: [
      "web_vital.lcp",
      "browser.largest_contentful_paint",
      "largest_contentful_paint",
      "web.vitals.lcp",
    ],
  },
  {
    key: "inp",
    label: "Interaction to Next Paint",
    unit: "ms",
    thresholds: { warn: 200, danger: 500 },
    names: [
      "web_vital.inp",
      "browser.interaction_to_next_paint",
      "interaction_to_next_paint",
      "web.vitals.inp",
    ],
  },
  {
    key: "cls",
    label: "Cumulative Layout Shift",
    unit: "score",
    thresholds: { warn: 0.1, danger: 0.25 },
    names: [
      "web_vital.cls",
      "browser.cumulative_layout_shift",
      "cumulative_layout_shift",
      "web.vitals.cls",
    ],
  },
  {
    key: "fcp",
    label: "First Contentful Paint",
    unit: "ms",
    thresholds: { warn: 1800, danger: 3000 },
    names: [
      "web_vital.fcp",
      "browser.first_contentful_paint",
      "first_contentful_paint",
      "web.vitals.fcp",
    ],
  },
  {
    key: "ttfb",
    label: "Time to First Byte",
    unit: "ms",
    thresholds: { warn: 800, danger: 1800 },
    names: [
      "web_vital.ttfb",
      "browser.time_to_first_byte",
      "time_to_first_byte",
      "web.vitals.ttfb",
    ],
  },
];

export const fetchWebVitals: (data: {
  serviceId: ObjectID;
  start: Date;
  end: Date;
}) => Promise<Array<WebVital>> = async (data: {
  serviceId: ObjectID;
  start: Date;
  end: Date;
}): Promise<Array<WebVital>> => {
  const results: Array<WebVital> = await Promise.all(
    WEB_VITAL_DEFS.map(
      async (def: (typeof WEB_VITAL_DEFS)[number]): Promise<WebVital> => {
        let value: number | null = null;
        for (const name of def.names) {
          // eslint-disable-next-line no-await-in-loop
          const series: Array<TimePoint> = await fetchMetricSeries({
            name: name,
            serviceId: data.serviceId,
            aggregationType: AggregationType.Avg,
            start: data.start,
            end: data.end,
          });
          const mean: number | null = meanY(series);
          if (mean !== null) {
            value = mean;
            break;
          }
        }
        return {
          key: def.key,
          label: def.label,
          value: value,
          unit: def.unit,
          thresholds: def.thresholds,
        };
      },
    ),
  );
  return results;
};

export const formatCompact: (n: number | null) => string = (
  n: number | null,
): string => {
  if (n === null || !Number.isFinite(n)) {
    return "—";
  }
  if (n < 1000) {
    return String(Math.round(n));
  }
  if (n < 1_000_000) {
    return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
};

export const formatPercent: (n: number | null) => string = (
  n: number | null,
): string => {
  if (n === null || !Number.isFinite(n)) {
    return "—";
  }
  return `${n.toFixed(1)}%`;
};

export const formatDurationMs: (ms: number | null) => string = (
  ms: number | null,
): string => {
  if (ms === null || !Number.isFinite(ms)) {
    return "—";
  }
  if (ms < 1) {
    return `${(ms * 1000).toFixed(0)} µs`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
};

export const formatBytes: (bytes: number | null) => string = (
  bytes: number | null,
): string => {
  if (bytes === null || !Number.isFinite(bytes)) {
    return "—";
  }
  const units: Array<string> = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v: number = bytes;
  let i: number = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
};
