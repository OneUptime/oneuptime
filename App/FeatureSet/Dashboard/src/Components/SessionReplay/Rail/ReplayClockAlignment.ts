import Span from "Common/Models/AnalyticsModels/Span";
import {
  REPLAY_CLOCK_ANCHOR_MAX_DELTA_MS,
  REPLAY_CLOCK_ANCHOR_MIN_PAIRS,
  REPLAY_CLOCK_ANCHOR_TOLERANCE_MS,
  ReplayClockAlignmentState,
  ReplaySignal,
  ReplaySignalAlignment,
} from "./ReplaySignalTypes";

/*
 * Placing server-stamped rows (logs, spans, exceptions) on the session
 * clock, which is the recording's clock: header.startTimeUnixMs plus the
 * chunk offset.
 *
 * TWO CLOCKS, ONE RULE. The recorder stamps chunks with the browser's clock;
 * the server clamps the header's start time and stamps every telemetry row
 * with its own clock. The manifest's clockSkewMs is the client-vs-server
 * delta and it only ever applies to CLIENT-stamped values. Telemetry rows
 * are server-stamped, so their baseline is simply
 *
 *   offsetMs = rowUnixMs - header.startTimeUnixMs
 *
 * and is NEVER adjusted by clockSkewMs. Applying it would push every log
 * line the wrong way by exactly the amount it claims to correct (the
 * sign-inversion finding on the earlier design). clockSkewMs only feeds
 * the uncertainty label shown on unanchored rows.
 *
 * TRACE ANCHORING refines the baseline empirically: a recording network row
 * carrying a traceId and the earliest span of that same trace describe the
 * same moment on both clocks. delta = spanStart - (startTime + offset),
 * taken as the median over all such pairs. When at least
 * REPLAY_CLOCK_ANCHOR_MIN_PAIRS pairs agree within the tolerance and the
 * delta is plausible (< 5 minutes, beyond which it is a wrong pairing, not
 * skew), the delta is applied and rows are labelled "anchored". Otherwise
 * rows stay on the baseline, labelled "unanchored", with the uncertainty
 * window shown so nobody reads a 3s misplacement as causality.
 */

/* One recording request that carried a trace id: what the browser saw. */
export interface ReplayClockNetworkAnchor {
  traceId: string;
  /* Session-clock offset of the request row (exact, from the chunk). */
  offsetMs: number;
}

/* One span of a trace: what the server saw, on the server clock. */
export interface ReplayClockSpanAnchor {
  traceId: string;
  startUnixMs: number;
}

/* A matched request/span pair and the delta it votes for. */
export interface ReplayClockAnchorPair {
  traceId: string;
  networkOffsetMs: number;
  spanStartUnixMs: number;
  /* spanStartUnixMs - (startTimeUnixMs + networkOffsetMs). */
  deltaMs: number;
}

export interface ReplayClockAlignmentInput {
  /* header.startTimeUnixMs: the session clock's zero, server-clamped. */
  startTimeUnixMs: number;
  networkAnchors: Array<ReplayClockNetworkAnchor>;
  spanAnchors: Array<ReplayClockSpanAnchor>;
  /*
   * The manifest's client-vs-server delta. Only used for the uncertainty
   * label; never added to a telemetry offset.
   */
  clockSkewMs?: number | null | undefined;
  /*
   * Whether any telemetry has been fetched yet. Until it has there is
   * nothing to align and the state is "pending", which the header renders
   * as nothing rather than as a claim.
   */
  hasTelemetry: boolean;
  /* Override for the ingest-lag allowance folded into the uncertainty. */
  ingestLagAllowanceMs?: number | undefined;
}

/*
 * How late a server row can be stamped relative to the moment it describes
 * once the request left the browser: network transit plus collector
 * batching. Folded into the unanchored uncertainty window because it is
 * real, unmeasured, and the honest answer is "up to a few seconds".
 */
export const REPLAY_CLOCK_INGEST_LAG_ALLOWANCE_MS: number = 3000;

export function makePendingClockAlignment(): ReplayClockAlignmentState {
  return { status: "pending", deltaMs: 0, pairCount: 0, uncertaintyMs: 0 };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/* Lift the anchors out of already-built recording signals. */
export function networkAnchorsFromSignals(
  signals: Array<ReplaySignal>,
): Array<ReplayClockNetworkAnchor> {
  const anchors: Array<ReplayClockNetworkAnchor> = [];

  for (const signal of signals) {
    if (signal.source !== "recording" || signal.kind !== "network") {
      continue;
    }

    const traceId: string | undefined = signal.links.traceId;

    if (!traceId || !isFiniteNumber(signal.offsetMs)) {
      continue;
    }

    anchors.push({ traceId: traceId, offsetMs: signal.offsetMs });
  }

  return anchors;
}

/* Lift the anchors out of fetched Span rows (the Traces data set). */
export function spanAnchorsFromRows(
  rows: Array<Span>,
): Array<ReplayClockSpanAnchor> {
  const anchors: Array<ReplayClockSpanAnchor> = [];

  for (const row of rows) {
    const traceId: string | undefined = row.traceId;
    const startTime: Date | undefined = row.startTime;

    if (!traceId || !(startTime instanceof Date)) {
      continue;
    }

    const startUnixMs: number = startTime.getTime();

    if (!isFiniteNumber(startUnixMs)) {
      continue;
    }

    anchors.push({ traceId: traceId, startUnixMs: startUnixMs });
  }

  return anchors;
}

/*
 * Pair each trace's EARLIEST request row with its EARLIEST span. A trace
 * can have several request rows (retries, redirects) and dozens of spans;
 * the earliest of each is the pair that describes the same instant, and
 * one vote per trace keeps a chatty trace from outvoting the rest.
 */
export function collectClockAnchorPairs(
  startTimeUnixMs: number,
  networkAnchors: Array<ReplayClockNetworkAnchor>,
  spanAnchors: Array<ReplayClockSpanAnchor>,
): Array<ReplayClockAnchorPair> {
  const earliestNetworkByTrace: Map<string, number> = new Map<string, number>();

  for (const anchor of networkAnchors) {
    if (!anchor.traceId || !isFiniteNumber(anchor.offsetMs)) {
      continue;
    }

    const existing: number | undefined = earliestNetworkByTrace.get(
      anchor.traceId,
    );

    if (existing === undefined || anchor.offsetMs < existing) {
      earliestNetworkByTrace.set(anchor.traceId, anchor.offsetMs);
    }
  }

  const earliestSpanByTrace: Map<string, number> = new Map<string, number>();

  for (const anchor of spanAnchors) {
    if (!anchor.traceId || !isFiniteNumber(anchor.startUnixMs)) {
      continue;
    }

    const existing: number | undefined = earliestSpanByTrace.get(
      anchor.traceId,
    );

    if (existing === undefined || anchor.startUnixMs < existing) {
      earliestSpanByTrace.set(anchor.traceId, anchor.startUnixMs);
    }
  }

  const pairs: Array<ReplayClockAnchorPair> = [];

  /* Iterate the network side so pair order follows the recording. */
  for (const [traceId, networkOffsetMs] of earliestNetworkByTrace) {
    const spanStartUnixMs: number | undefined =
      earliestSpanByTrace.get(traceId);

    if (spanStartUnixMs === undefined) {
      continue;
    }

    pairs.push({
      traceId: traceId,
      networkOffsetMs: networkOffsetMs,
      spanStartUnixMs: spanStartUnixMs,
      deltaMs: spanStartUnixMs - (startTimeUnixMs + networkOffsetMs),
    });
  }

  return pairs;
}

export function medianOf(values: Array<number>): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted: Array<number> = [...values].sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );
  const middle: number = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] as number;
  }

  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export function computeClockAlignment(
  input: ReplayClockAlignmentInput,
): ReplayClockAlignmentState {
  if (!input.hasTelemetry) {
    return makePendingClockAlignment();
  }

  const skewMs: number = isFiniteNumber(input.clockSkewMs)
    ? Math.abs(input.clockSkewMs)
    : 0;
  const ingestLagMs: number = isFiniteNumber(input.ingestLagAllowanceMs)
    ? Math.max(0, input.ingestLagAllowanceMs)
    : REPLAY_CLOCK_INGEST_LAG_ALLOWANCE_MS;
  const unanchoredUncertaintyMs: number = skewMs + ingestLagMs;

  const pairs: Array<ReplayClockAnchorPair> = collectClockAnchorPairs(
    input.startTimeUnixMs,
    input.networkAnchors,
    input.spanAnchors,
  );

  if (pairs.length < REPLAY_CLOCK_ANCHOR_MIN_PAIRS) {
    return {
      status: "unanchored",
      deltaMs: 0,
      pairCount: pairs.length,
      uncertaintyMs: unanchoredUncertaintyMs,
    };
  }

  const median: number = medianOf(
    pairs.map((pair: ReplayClockAnchorPair): number => {
      return pair.deltaMs;
    }),
  );

  /*
   * A delta that large is not clock skew - it is a request row paired with
   * a span from an unrelated trace (id reuse) or a server whose clock is
   * simply wrong. Either way, shifting every row by it would be worse than
   * the baseline.
   */
  if (Math.abs(median) >= REPLAY_CLOCK_ANCHOR_MAX_DELTA_MS) {
    return {
      status: "unanchored",
      deltaMs: 0,
      pairCount: pairs.length,
      uncertaintyMs: unanchoredUncertaintyMs,
    };
  }

  /*
   * "Agree within the tolerance" is a pairwise promise: any two agreeing
   * pairs sit within REPLAY_CLOCK_ANCHOR_TOLERANCE_MS of each other. A
   * cluster within HALF the tolerance of the median guarantees that; the
   * full tolerance around the median would let two pairs 4s apart anchor.
   */
  const agreeing: Array<ReplayClockAnchorPair> = pairs.filter(
    (pair: ReplayClockAnchorPair): boolean => {
      return (
        Math.abs(pair.deltaMs - median) <= REPLAY_CLOCK_ANCHOR_TOLERANCE_MS / 2
      );
    },
  );

  if (agreeing.length < REPLAY_CLOCK_ANCHOR_MIN_PAIRS) {
    return {
      status: "unanchored",
      deltaMs: 0,
      pairCount: pairs.length,
      uncertaintyMs: unanchoredUncertaintyMs,
    };
  }

  /* Re-take the median over the agreeing pairs so an outlier cannot tug it. */
  const agreedDeltaMs: number = Math.round(
    medianOf(
      agreeing.map((pair: ReplayClockAnchorPair): number => {
        return pair.deltaMs;
      }),
    ),
  );

  /*
   * Anchored rows are still only as precise as the pairs' spread: the
   * uncertainty is how far the furthest agreeing pair sits from the delta.
   */
  let spreadMs: number = 0;

  for (const pair of agreeing) {
    spreadMs = Math.max(spreadMs, Math.abs(pair.deltaMs - agreedDeltaMs));
  }

  return {
    status: "anchored",
    deltaMs: agreedDeltaMs,
    pairCount: agreeing.length,
    uncertaintyMs: Math.round(spreadMs),
  };
}

/*
 * The one function every telemetry adapter goes through. Baseline is the
 * server stamp minus the session start; the anchoring delta is added only
 * when it earned trust. clockSkewMs is deliberately not a parameter.
 */
export function alignTelemetryOffsetMs(
  rowUnixMs: number,
  startTimeUnixMs: number,
  alignment: ReplayClockAlignmentState,
): number {
  const baselineMs: number = rowUnixMs - startTimeUnixMs;

  if (alignment.status === "anchored") {
    return baselineMs + alignment.deltaMs;
  }

  return baselineMs;
}

/* The per-row label a telemetry signal carries. */
export function alignmentLabelFor(
  alignment: ReplayClockAlignmentState,
): ReplaySignalAlignment {
  return alignment.status === "anchored" ? "anchored" : "unanchored";
}

function formatSecondsForCopy(ms: number): string {
  const seconds: number = ms / 1000;

  if (seconds >= 10) {
    return `${Math.round(seconds)}s`;
  }

  if (seconds >= 1) {
    return `${Math.round(seconds * 10) / 10}s`;
  }

  return `${Math.round(ms)}ms`;
}

/* "+-3s" for an unanchored row; empty when there is nothing to warn about. */
export function formatAlignmentUncertainty(
  alignment: ReplayClockAlignmentState,
): string {
  if (alignment.status === "pending" || alignment.uncertaintyMs <= 0) {
    return "";
  }

  return `±${formatSecondsForCopy(alignment.uncertaintyMs)}`;
}

/*
 * The header note. Names the cause, quantifies it. Pending returns an
 * empty string so nothing is claimed before telemetry has loaded.
 */
export function describeClockAlignment(
  alignment: ReplayClockAlignmentState,
): string {
  if (alignment.status === "pending") {
    return "";
  }

  if (alignment.status === "anchored") {
    const traceWord: string = alignment.pairCount === 1 ? "trace" : "traces";
    const precision: string =
      alignment.uncertaintyMs > 0
        ? ` (${formatAlignmentUncertainty(alignment)})`
        : "";

    return `Server times anchored via ${alignment.pairCount} ${traceWord}${precision}`;
  }

  if (alignment.uncertaintyMs > 0) {
    return `Server times unanchored; clock skew up to ${formatSecondsForCopy(alignment.uncertaintyMs)}`;
  }

  return "Server times unanchored; no trace shared between the recording and the backend yet";
}
