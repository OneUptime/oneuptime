/*
 * Critical Path Analysis for distributed traces
 * Computes self-time, critical path, and bottleneck identification
 */

export interface SpanData {
  spanId: string;
  parentSpanId: string | undefined;
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  durationUnixNano: number;
  serviceId: string | undefined;
  name: string | undefined;
}

export interface SpanSelfTime {
  spanId: string;
  selfTimeUnixNano: number;
  childTimeUnixNano: number;
  totalTimeUnixNano: number;
  selfTimePercent: number;
}

export interface CriticalPathResult {
  criticalPathSpanIds: string[];
  totalTraceDurationUnixNano: number;
  criticalPathDurationUnixNano: number;
}

export interface ServiceBreakdown {
  serviceId: string;
  totalDurationUnixNano: number;
  selfTimeUnixNano: number;
  spanCount: number;
  percentOfTrace: number;
}

export default class CriticalPathUtil {
  /**
   * Compute self-time for each span.
   * Self-time = span duration minus the time covered by direct children,
   * accounting for overlapping children.
   */
  public static computeSelfTimes(spans: SpanData[]): Map<string, SpanSelfTime> {
    const result: Map<string, SpanSelfTime> = new Map();

    // Build parent -> children index
    const childrenMap: Map<string, SpanData[]> = new Map();
    for (const span of spans) {
      if (span.parentSpanId) {
        const children: SpanData[] = childrenMap.get(span.parentSpanId) || [];
        children.push(span);
        childrenMap.set(span.parentSpanId, children);
      }
    }

    for (const span of spans) {
      const children: SpanData[] = childrenMap.get(span.spanId) || [];
      const childTimeUnixNano: number =
        CriticalPathUtil.computeMergedChildDuration(
          children,
          span.startTimeUnixNano,
          span.endTimeUnixNano,
        );

      const selfTimeUnixNano: number = Math.max(
        0,
        span.durationUnixNano - childTimeUnixNano,
      );

      result.set(span.spanId, {
        spanId: span.spanId,
        selfTimeUnixNano,
        childTimeUnixNano,
        totalTimeUnixNano: span.durationUnixNano,
        selfTimePercent:
          span.durationUnixNano > 0
            ? (selfTimeUnixNano / span.durationUnixNano) * 100
            : 0,
      });
    }

    return result;
  }

  /**
   * Compute the merged duration of child spans within the parent's time window.
   * Handles overlapping children by merging intervals.
   */
  private static computeMergedChildDuration(
    children: SpanData[],
    parentStart: number,
    parentEnd: number,
  ): number {
    if (children.length === 0) {
      return 0;
    }

    // Clamp children to parent boundaries and create intervals
    const intervals: Array<{ start: number; end: number }> = children
      .map((child: SpanData) => {
        return {
          start: Math.max(child.startTimeUnixNano, parentStart),
          end: Math.min(child.endTimeUnixNano, parentEnd),
        };
      })
      .filter((interval: { start: number; end: number }) => {
        return interval.end > interval.start;
      });

    if (intervals.length === 0) {
      return 0;
    }

    // Sort by start time
    intervals.sort(
      (
        a: { start: number; end: number },
        b: { start: number; end: number },
      ) => {
        return a.start - b.start;
      },
    );

    // Merge overlapping intervals
    let mergedDuration: number = 0;
    let currentStart: number = intervals[0]!.start;
    let currentEnd: number = intervals[0]!.end;

    for (let i: number = 1; i < intervals.length; i++) {
      const interval: { start: number; end: number } = intervals[i]!;
      if (interval.start <= currentEnd) {
        // Overlapping - extend
        currentEnd = Math.max(currentEnd, interval.end);
      } else {
        // Non-overlapping - add previous and start new
        mergedDuration += currentEnd - currentStart;
        currentStart = interval.start;
        currentEnd = interval.end;
      }
    }

    mergedDuration += currentEnd - currentStart;

    return mergedDuration;
  }

  /**
   * Compute the critical path through the trace.
   * The critical path is the longest sequential chain of spans,
   * accounting for parallelism (parallel children don't add to the critical path together).
   */
  public static computeCriticalPath(spans: SpanData[]): CriticalPathResult {
    if (spans.length === 0) {
      return {
        criticalPathSpanIds: [],
        totalTraceDurationUnixNano: 0,
        criticalPathDurationUnixNano: 0,
      };
    }

    // Find total trace duration
    let traceStart: number = spans[0]!.startTimeUnixNano;
    let traceEnd: number = spans[0]!.endTimeUnixNano;
    for (const span of spans) {
      if (span.startTimeUnixNano < traceStart) {
        traceStart = span.startTimeUnixNano;
      }
      if (span.endTimeUnixNano > traceEnd) {
        traceEnd = span.endTimeUnixNano;
      }
    }

    // Build parent -> children index
    const childrenMap: Map<string, SpanData[]> = new Map();
    const spanMap: Map<string, SpanData> = new Map();
    const allSpanIds: Set<string> = new Set();

    for (const span of spans) {
      spanMap.set(span.spanId, span);
      allSpanIds.add(span.spanId);
    }

    for (const span of spans) {
      if (span.parentSpanId && allSpanIds.has(span.parentSpanId)) {
        const children: SpanData[] = childrenMap.get(span.parentSpanId) || [];
        children.push(span);
        childrenMap.set(span.parentSpanId, children);
      }
    }

    // Find root spans
    const rootSpans: SpanData[] = spans.filter((span: SpanData) => {
      return !span.parentSpanId || !allSpanIds.has(span.parentSpanId);
    });

    if (rootSpans.length === 0) {
      return {
        criticalPathSpanIds: [],
        totalTraceDurationUnixNano: traceEnd - traceStart,
        criticalPathDurationUnixNano: 0,
      };
    }

    // For each span, compute the critical path weight (longest path through this span and descendants)
    const criticalPathCache: Map<string, { weight: number; path: string[] }> =
      new Map();

    const computeWeight = (
      spanId: string,
    ): { weight: number; path: string[] } => {
      const cached: { weight: number; path: string[] } | undefined =
        criticalPathCache.get(spanId);
      if (cached) {
        return cached;
      }

      const span: SpanData | undefined = spanMap.get(spanId);
      if (!span) {
        return { weight: 0, path: [] };
      }

      const children: SpanData[] = childrenMap.get(spanId) || [];

      if (children.length === 0) {
        const result: { weight: number; path: string[] } = {
          weight: span.durationUnixNano,
          path: [spanId],
        };
        criticalPathCache.set(spanId, result);
        return result;
      }

      // Find the child with the longest critical path
      let maxChildWeight: number = 0;
      let maxChildPath: string[] = [];

      for (const child of children) {
        const childResult: { weight: number; path: string[] } = computeWeight(
          child.spanId,
        );
        if (childResult.weight > maxChildWeight) {
          maxChildWeight = childResult.weight;
          maxChildPath = childResult.path;
        }
      }

      // Self time contribution
      const selfTimes: Map<string, SpanSelfTime> =
        CriticalPathUtil.computeSelfTimes([span, ...children]);
      const selfTime: SpanSelfTime | undefined = selfTimes.get(spanId);
      const selfTimeValue: number = selfTime ? selfTime.selfTimeUnixNano : 0;

      const result: { weight: number; path: string[] } = {
        weight: selfTimeValue + maxChildWeight,
        path: [spanId, ...maxChildPath],
      };
      criticalPathCache.set(spanId, result);
      return result;
    };

    // Find the root with the longest critical path
    let maxWeight: number = 0;
    let criticalPath: string[] = [];

    for (const rootSpan of rootSpans) {
      const result: { weight: number; path: string[] } = computeWeight(
        rootSpan.spanId,
      );
      if (result.weight > maxWeight) {
        maxWeight = result.weight;
        criticalPath = result.path;
      }
    }

    return {
      criticalPathSpanIds: criticalPath,
      totalTraceDurationUnixNano: traceEnd - traceStart,
      criticalPathDurationUnixNano: maxWeight,
    };
  }

  /**
   * Compute latency breakdown by service.
   */
  public static computeServiceBreakdown(spans: SpanData[]): ServiceBreakdown[] {
    const selfTimes: Map<string, SpanSelfTime> =
      CriticalPathUtil.computeSelfTimes(spans);

    // Find total trace duration
    let traceStart: number = Number.MAX_SAFE_INTEGER;
    let traceEnd: number = 0;
    for (const span of spans) {
      if (span.startTimeUnixNano < traceStart) {
        traceStart = span.startTimeUnixNano;
      }
      if (span.endTimeUnixNano > traceEnd) {
        traceEnd = span.endTimeUnixNano;
      }
    }
    const totalDuration: number = traceEnd - traceStart;

    // Aggregate by service
    const serviceMap: Map<
      string,
      { totalDuration: number; selfTime: number; spanCount: number }
    > = new Map();

    for (const span of spans) {
      const serviceId: string = span.serviceId || "unknown";
      const entry: {
        totalDuration: number;
        selfTime: number;
        spanCount: number;
      } = serviceMap.get(serviceId) || {
        totalDuration: 0,
        selfTime: 0,
        spanCount: 0,
      };

      entry.totalDuration += span.durationUnixNano;
      const selfTime: SpanSelfTime | undefined = selfTimes.get(span.spanId);
      entry.selfTime += selfTime ? selfTime.selfTimeUnixNano : 0;
      entry.spanCount += 1;
      serviceMap.set(serviceId, entry);
    }

    const result: ServiceBreakdown[] = [];
    for (const [serviceId, data] of serviceMap.entries()) {
      result.push({
        serviceId,
        totalDurationUnixNano: data.totalDuration,
        selfTimeUnixNano: data.selfTime,
        spanCount: data.spanCount,
        percentOfTrace:
          totalDuration > 0 ? (data.selfTime / totalDuration) * 100 : 0,
      });
    }

    // Sort by self-time descending (biggest contributors first)
    result.sort((a: ServiceBreakdown, b: ServiceBreakdown) => {
      return b.selfTimeUnixNano - a.selfTimeUnixNano;
    });

    return result;
  }
}
