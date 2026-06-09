import ObjectID from "Common/Types/ObjectID";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Query from "Common/Types/BaseDatabase/Query";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectUtil from "Common/UI/Utils/Project";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";

/*
 * RED (Rate / Errors / Duration) metrics derived from the Span analytics
 * model. Shared by the Serverless and RUM overview pages — both are
 * span-heavy workloads (function invocations / page loads + interactions),
 * so spans are the universal, always-present signal.
 */
export interface SpanRedMetrics {
  total: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
}

export interface SpanRedScope {
  // Scope by resource attributes (e.g. { "resource.faas.name": "x" }) ...
  attributes?: Record<string, string> | undefined;
  // ... or by the resource's own serviceId (RUM rows are tagged this way).
  serviceId?: ObjectID | undefined;
  start: Date;
  end: Date;
}

export const fetchSpanRedMetrics: (
  scope: SpanRedScope,
) => Promise<SpanRedMetrics> = async (
  scope: SpanRedScope,
): Promise<SpanRedMetrics> => {
  const empty: SpanRedMetrics = {
    total: 0,
    errors: 0,
    errorRatePercent: null,
    p95DurationMs: null,
  };

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId) {
    return empty;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseFilter: any = {
    projectId: projectId,
    startTime: new InBetween<Date>(scope.start, scope.end),
  };
  if (scope.serviceId) {
    baseFilter.serviceId = scope.serviceId;
  }
  if (scope.attributes && Object.keys(scope.attributes).length > 0) {
    baseFilter.attributes = scope.attributes;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorFilter: any = { ...baseFilter, statusCode: SpanStatus.Error };

  let total: number = 0;
  let errors: number = 0;
  try {
    [total, errors] = await Promise.all([
      AnalyticsModelAPI.count(Span, baseFilter as Query<Span>),
      AnalyticsModelAPI.count(Span, errorFilter as Query<Span>),
    ]);
  } catch {
    return empty;
  }

  let p95DurationMs: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aggregateBy: any = {
      query: baseFilter,
      aggregationType: AggregationType.P95,
      aggregateColumnName: "durationUnixNano",
      aggregationTimestampColumnName: "startTime",
      startTimestamp: scope.start,
      endTimestamp: scope.end,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: { startTime: SortOrder.Descending },
    };
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Span>({
      modelType: Span,
      aggregateBy: aggregateBy as AggregateBy<Span>,
    });
    const values: Array<number> = (
      (result.data || []) as Array<AggregatedModel>
    )
      .map((d: AggregatedModel): number => {
        return Number(d["value"]);
      })
      .filter((n: number): boolean => {
        return Number.isFinite(n) && n > 0;
      });
    if (values.length > 0) {
      const meanNanos: number =
        values.reduce((a: number, b: number): number => {
          return a + b;
        }, 0) / values.length;
      p95DurationMs = meanNanos / 1_000_000;
    }
  } catch {
    // Duration is supplementary — leave null if the aggregate fails.
  }

  return {
    total: total,
    errors: errors,
    errorRatePercent: total > 0 ? (errors / total) * 100 : null,
    p95DurationMs: p95DurationMs,
  };
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
