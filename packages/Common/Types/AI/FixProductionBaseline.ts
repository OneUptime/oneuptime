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
  /*
   * ISO-8601: the last check that found one of their incidents (or alerts)
   * open after the deploy. A monitor raises no other while one is open, so
   * the deployed fix's quiet time counts from then.
   */
  openSeenAt?: string | undefined;
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

/*
 * TelemetryLeak (#10368): one place a Data Security telemetry issue found
 * its data, as the fix's first check read it.
 */
export interface TelemetryLeakFixPlace {
  // The DataStoreFinding.
  findingId: string;
  dataTypeId: string;
  // Where it sits: body, attributes.user.email, events.login.token.
  location: string;
  // The enabled scrub rules that hid it at ingest when the fix merged.
  scrubRuleIds: Array<string>;
  // ISO-8601: when the scan last saw it.
  lastSeenAt?: string | undefined;
}

// One telemetry store - a service's logs, its spans - the fix is for.
export interface TelemetryLeakFixStore {
  dataStoreId: string;
  // Its DataStoreKind: which of the service's records are counted.
  kind: string;
  // The store's issues the fix is for.
  issueIds: Array<string>;
  places: Array<TelemetryLeakFixPlace>;
  /*
   * How many records of the store the old version sent in the hour its
   * data was last seen - what the new version must send before it can be
   * called fixed. The store's records as a whole, not only those holding
   * the attribute: a fix that removes the attribute leaves none there.
   */
  recordsBefore: number;
  // ISO-8601: the start of that hour.
  recordsBeforeHour?: string | undefined;
}

/*
 * TelemetryLeak: what a code fix of a telemetry leak is watched for - the
 * service whose deploys ship it, and its stores' places and rules.
 */
export interface TelemetryLeakFixBaseline {
  serviceId: string;
  stores: Array<TelemetryLeakFixStore>;
  // The code task in Code that opened the pull request (its first turn).
  taskId?: string | undefined;
  // The values the places' rules changed in the week before the merge.
  valuesChangedBefore: number;
  // ISO-8601: the week read, before the merge.
  from: string;
  to: string;
}

// StoreConfiguration (#10368): one store's issue the fix is for.
export interface StoreConfigurationFixIssue {
  issueId: string;
  dataStoreId: string;
  checkId: string;
}

/*
 * StoreConfiguration: the issues a fix in infrastructure code is for, and
 * what was done while it is watched - each read asked for, and the one
 * notice that it merged and was not applied.
 */
export interface StoreConfigurationFixBaseline {
  issues: Array<StoreConfigurationFixIssue>;
  // The code task in Code that opened the pull request (its first turn).
  taskId?: string | undefined;
  // Who asked OneUptime AI for it: the pull request's author, to OneUptime.
  askedByUserId?: string | undefined;
  // ISO-8601: when the stores were asked to be read again, at once after the merge.
  readAskedAt?: string | undefined;
  // ISO-8601: when they were asked again, a day after the merge.
  dayReadAskedAt?: string | undefined;
  /*
   * ISO-8601: when the store's owners and the pull request's author were
   * told it merged and was not applied - once, never again.
   */
  notAppliedToldAt?: string | undefined;
}

export interface FixProductionBaseline {
  performance?: PerformanceFixBaseline | undefined;
  recurrence?: RecurrenceFixBaseline | undefined;
  telemetry?: TelemetryFixBaseline | undefined;
  telemetryLeak?: TelemetryLeakFixBaseline | undefined;
  storeConfiguration?: StoreConfigurationFixBaseline | undefined;
}

export default FixProductionBaseline;
