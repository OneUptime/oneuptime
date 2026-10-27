import { JSONObject } from "../JSON";

/*
 * How complete one service's traces are: the response of
 * POST /telemetry/traces/health, which the "Trace health" card at the top of
 * a service's Traces page shows.
 *
 * A trace-quality review of real data found problems nobody could see from
 * the UI: a third of one project's traces were a single span, most of those
 * pointing at a parent span that never arrived, and none of its pod logs
 * carried a trace id. Senders dropping spans under load surfaced only as
 * "N spans missing a parent" on individual traces. The report puts three
 * numbers on that for a service, measured over a deterministic sample of its
 * traces (Server/Utils/Telemetry/TraceHealth builds the queries and reads
 * them):
 *
 *   - orphanSpanShare: of the service's spans, those that name a parent span
 *     the trace does not have;
 *   - singleSpanTraceShare: of the traces the service has spans in, those
 *     that are one span long;
 *   - logsLinkedShare: of the service's logs, those that carry a trace id.
 *
 * Shares are fractions from 0 to 1, and null when there is nothing to divide
 * (no spans, no traces, no logs). `hints` names the shares that look poor,
 * by the thresholds the server keeps; the page words them.
 *
 * Imports nothing but JSON types, so the Dashboard and the server read the
 * same contract and the suites read it without a database.
 */

export const TRACE_HEALTH_ROUTE: string = "/telemetry/traces/health";

export enum TraceHealthHint {
  // Some of the service's spans name a parent span that never arrived.
  MissingParentSpans = "MissingParentSpans",
  // Many of the traces the service has spans in are one span long.
  OneSpanTraces = "OneSpanTraces",
  // Most of the service's logs carry no trace id.
  UnlinkedLogs = "UnlinkedLogs",
}

export interface TraceHealthReport {
  // The window measured, as ISO 8601 instants.
  startTime: string;
  endTime: string;
  /*
   * The share of traces read, 1 to 100: a trace is read when its id hashes
   * below it, so every span of a read trace is read and every run reads the
   * same traces.
   */
  samplePercent: number;
  // The service's spans in the window, in the traces read.
  spanCount: number;
  // The traces read that the service has spans in.
  traceCount: number;
  orphanSpanShare: number | null;
  singleSpanTraceShare: number | null;
  // The service's logs in the window. Logs are counted in full, not sampled.
  logCount: number;
  logsLinkedShare: number | null;
  hints: Array<TraceHealthHint>;
}

export interface TraceHealthRequestBody {
  serviceId: string;
  // ISO 8601. The last hour when left out; at most 24 hours wide.
  startTime?: string | undefined;
  endTime?: string | undefined;
}

const HINTS: ReadonlyArray<string> = Object.values(TraceHealthHint);

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readShare(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(1, Math.max(0, value));
}

function readInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

/*
 * The report as the route returns it, or null when the body is not that
 * shape: a server mid-rollout or a broken response draws nothing rather than
 * a card of zeros.
 */
export function parseTraceHealthReport(
  value: unknown,
): TraceHealthReport | null {
  if (!isObject(value)) {
    return null;
  }

  const startTime: string | null = readInstant(value["startTime"]);
  const endTime: string | null = readInstant(value["endTime"]);
  const samplePercent: number = readCount(value["samplePercent"]);

  if (!startTime || !endTime || samplePercent < 1) {
    return null;
  }

  const hints: Array<TraceHealthHint> = Array.isArray(value["hints"])
    ? HINTS.filter((hint: string): boolean => {
        return (value["hints"] as Array<unknown>).includes(hint);
      }).map((hint: string): TraceHealthHint => {
        return hint as TraceHealthHint;
      })
    : [];

  return {
    startTime,
    endTime,
    samplePercent: Math.min(100, samplePercent),
    spanCount: readCount(value["spanCount"]),
    traceCount: readCount(value["traceCount"]),
    orphanSpanShare: readShare(value["orphanSpanShare"]),
    singleSpanTraceShare: readShare(value["singleSpanTraceShare"]),
    logCount: readCount(value["logCount"]),
    logsLinkedShare: readShare(value["logsLinkedShare"]),
    hints,
  };
}
