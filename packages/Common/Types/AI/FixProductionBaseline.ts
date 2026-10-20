import { IncidentAlertAiSubjectKind } from "./IncidentAlertAiLogs";

/*
 * What a merged fix's production check measured before the fix
 * (AIAgentTaskPullRequest.productionBaseline), for the checks that compare
 * the deployed fix with the time before its merge (FixProductionCheck).
 *
 * It is measured once, on the fix's first check after it merges, and kept:
 * span and log retention is short, so by the time a deploy ships the fix
 * the week before the merge may be gone - and a verdict measured against
 * the same numbers on every check is one that cannot drift. An exception
 * fix keeps none: its occurrences are counted as before.
 *
 * Exactly one section is set, matching the row's productionCheck. It holds
 * span names, attribute keys and log bodies, so it is server-only, like
 * AIRun.taskContext. These shapes are a wire contract - do not rename
 * fields.
 */

// Performance: the operation the fix names, and how slow it was.
export interface PerformanceFixBaseline {
  // The service whose spans are measured, and whose deploys ship the fix.
  serviceId: string;
  /*
   * The span name measured - the operation a latency insight named, or the
   * one a trace's finding slowed. Absent, every span of the service is (an
   * insight about the whole service).
   */
  spanName?: string | undefined;
  // The latency insight that opened the fix, resolved or reopened with it.
  insightId?: string | undefined;
  // The spans in the window, and their p99 in milliseconds.
  spanCount: number;
  p99Ms: number;
  // ISO-8601: the window measured, the week before the merge.
  from: string;
  to: string;
}

// Recurrence: the monitors that raised the incident or alert, and how often.
export interface RecurrenceFixBaseline {
  // Recurrences are counted of the investigated subject's kind.
  subjectKind: IncidentAlertAiSubjectKind;
  monitorIds: Array<string>;
  // The incidents (or alerts) those monitors raised in the window.
  count: number;
  // ISO-8601: the window counted, before the merge.
  from: string;
  to: string;
}

// The telemetry a telemetry improvement adds to.
export enum TelemetryFixSignal {
  Spans = "Spans",
  Logs = "Logs",
}

// Telemetry: what the fix adds that was not there before.
export interface TelemetryFixBaseline {
  /*
   * The service whose telemetry is read. Absent, the whole project's is (an
   * instrumentation fix of an incident names no service).
   */
  serviceId?: string | undefined;
  // Spans for tracing, logs for logging, both for instrumentation.
  signals: Array<TelemetryFixSignal>;
  /*
   * The text the fix's changes add - quoted on the lines its pull request
   * adds - that no span or log carried in the window as a span's name, an
   * attribute's key or a log's body: what arrives once the fix runs.
   */
  candidates: Array<string>;
  // The spans and logs the service (or the project) sent in the window.
  spanCount: number;
  logCount: number;
  // ISO-8601: the window read, the week before the merge.
  from: string;
  to: string;
}

export interface FixProductionBaseline {
  performance?: PerformanceFixBaseline | undefined;
  recurrence?: RecurrenceFixBaseline | undefined;
  telemetry?: TelemetryFixBaseline | undefined;
}

export default FixProductionBaseline;
