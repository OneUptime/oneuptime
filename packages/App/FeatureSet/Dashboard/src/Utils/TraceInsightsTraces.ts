import { SpanStatus } from "Common/Models/AnalyticsModels/Span";

/*
 * The Insights page samples the newest spans in the time range (capped at a
 * few thousand) and turns them into "recent error traces" and "slowest
 * traces". Those lists are about TRACES, so each row has to describe the
 * trace — its root operation, when it started, how long the whole thing took
 * — not whichever of its spans happened to be newest in the sample.
 *
 * Taking the first span seen per traceId out of a newest-first list does the
 * latter: a trace whose root is "POST /api/checkout" showed up named after its
 * last Redis call ("set") with that call's few-microsecond duration, so the
 * "slowest traces" list ranked traces by their fastest-looking leaf.
 *
 * Pure functions, unit tested in Tests/Dashboard/TraceInsightsTraces.test.ts.
 */

export interface TraceInsightsSpanInput {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  primaryEntityId: string;
  startTime: Date | undefined;
  durationNano: number;
  statusCode: SpanStatus;
}

export interface TraceInsightsTrace {
  traceId: string;
  name: string;
  primaryEntityId: string;
  startTime: Date;
  statusCode: SpanStatus;
  durationNano: number;
  /*
   * False when the sample held no root span for this trace (it started
   * before the window, or its root fell outside the sample cap). The name
   * and timing then come from the earliest span that WAS sampled, and the
   * duration is a lower bound.
   */
  hasRootSpan: boolean;
}

export interface TraceInsightsTraces {
  // Every sampled trace, in the order its newest span appeared.
  allTraces: Array<TraceInsightsTrace>;
  // Traces with at least one errored span, in the order of their newest error.
  errorTraces: Array<TraceInsightsTrace>;
}

export const UNKNOWN_TRACE_NAME: string = "Unknown";

export function isRootSpan(span: TraceInsightsSpanInput): boolean {
  return !span.parentSpanId;
}

function startMillis(span: TraceInsightsSpanInput): number {
  const time: number | undefined = span.startTime?.getTime();
  return time === undefined || Number.isNaN(time)
    ? Number.POSITIVE_INFINITY
    : time;
}

/*
 * The span that speaks for the trace: its root when the sample has one,
 * otherwise the earliest-starting sampled span — the closest thing to the
 * root that is available. Ties keep the span seen first.
 */
export function pickRepresentativeSpan(
  spans: Array<TraceInsightsSpanInput>,
): TraceInsightsSpanInput | undefined {
  let best: TraceInsightsSpanInput | undefined = undefined;
  for (const span of spans) {
    if (!best) {
      best = span;
      continue;
    }
    const spanIsRoot: boolean = isRootSpan(span);
    const bestIsRoot: boolean = isRootSpan(best);
    if (spanIsRoot !== bestIsRoot) {
      if (spanIsRoot) {
        best = span;
      }
      continue;
    }
    if (startMillis(span) < startMillis(best)) {
      best = span;
    }
  }
  return best;
}

export function summarizeTrace(
  traceId: string,
  spans: Array<TraceInsightsSpanInput>,
): TraceInsightsTrace | undefined {
  const representative: TraceInsightsSpanInput | undefined =
    pickRepresentativeSpan(spans);
  if (!representative) {
    return undefined;
  }

  const hasRootSpan: boolean = isRootSpan(representative);

  /*
   * A root span covers its whole trace, so its duration IS the trace's.
   * Without one, no sampled span can be longer than the trace, so the
   * longest one is the best lower bound — and never the shortest leaf.
   */
  let durationNano: number = representative.durationNano || 0;
  if (!hasRootSpan) {
    for (const span of spans) {
      durationNano = Math.max(durationNano, span.durationNano || 0);
    }
  }

  const hasError: boolean = spans.some((span: TraceInsightsSpanInput) => {
    return span.statusCode === SpanStatus.Error;
  });

  return {
    traceId,
    name: representative.name || UNKNOWN_TRACE_NAME,
    primaryEntityId: representative.primaryEntityId,
    startTime: representative.startTime || new Date(0),
    statusCode: hasError
      ? SpanStatus.Error
      : representative.statusCode || SpanStatus.Unset,
    durationNano,
    hasRootSpan,
  };
}

/*
 * Groups a newest-first span sample into traces. Spans without a traceId are
 * skipped: they cannot be linked to the trace view anyway.
 */
export function summarizeRecentTraces(
  spans: Array<TraceInsightsSpanInput>,
): TraceInsightsTraces {
  const spansByTrace: Map<string, Array<TraceInsightsSpanInput>> = new Map();
  const traceOrder: Array<string> = [];
  const errorOrder: Array<string> = [];
  const seenError: Set<string> = new Set();

  for (const span of spans) {
    const traceId: string = span.traceId;
    if (!traceId) {
      continue;
    }
    let group: Array<TraceInsightsSpanInput> | undefined =
      spansByTrace.get(traceId);
    if (!group) {
      group = [];
      spansByTrace.set(traceId, group);
      traceOrder.push(traceId);
    }
    group.push(span);

    if (span.statusCode === SpanStatus.Error && !seenError.has(traceId)) {
      seenError.add(traceId);
      errorOrder.push(traceId);
    }
  }

  const summaries: Map<string, TraceInsightsTrace> = new Map();
  for (const traceId of traceOrder) {
    const summary: TraceInsightsTrace | undefined = summarizeTrace(
      traceId,
      spansByTrace.get(traceId) || [],
    );
    if (summary) {
      summaries.set(traceId, summary);
    }
  }

  const pick: (ids: Array<string>) => Array<TraceInsightsTrace> = (
    ids: Array<string>,
  ): Array<TraceInsightsTrace> => {
    const out: Array<TraceInsightsTrace> = [];
    for (const id of ids) {
      const summary: TraceInsightsTrace | undefined = summaries.get(id);
      if (summary) {
        out.push(summary);
      }
    }
    return out;
  };

  return {
    allTraces: pick(traceOrder),
    errorTraces: pick(errorOrder),
  };
}

// The slowest traces first; equal durations keep their sample order.
export function getSlowestTraces(
  traces: Array<TraceInsightsTrace>,
  limit: number,
): Array<TraceInsightsTrace> {
  return traces
    .map((trace: TraceInsightsTrace, index: number) => {
      return { trace, index };
    })
    .sort(
      (
        a: { trace: TraceInsightsTrace; index: number },
        b: { trace: TraceInsightsTrace; index: number },
      ) => {
        return b.trace.durationNano - a.trace.durationNano || a.index - b.index;
      },
    )
    .slice(0, Math.max(0, limit))
    .map((entry: { trace: TraceInsightsTrace; index: number }) => {
      return entry.trace;
    });
}
