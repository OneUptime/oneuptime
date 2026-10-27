import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  TraceHealthHint,
  TraceHealthReport,
} from "../../../Types/Telemetry/TraceHealth";

/*
 * HOW COMPLETE A SERVICE'S TRACES ARE (POST /telemetry/traces/health): the
 * queries and how their rows are read. Pure - it builds statements and reads
 * rows, and runs nothing - so the suites hold every query and every verdict
 * without a database. TraceHealthService runs the statements.
 *
 * The service's spans are the rows whose primaryEntityId is the service, as
 * the trace histogram scopes them (TelemetryReadScopeUtil.appendServiceFilter
 * over the filter the caller's read scope allows), and its logs the same on
 * LogItemV3.
 *
 * A project can send 80M spans an hour, so the trace numbers are measured on
 * a sample of traces: a trace is read when cityHash64(traceId) % 100 falls
 * below the sample percent. A hash of the trace id keeps or leaves out every
 * span of a trace together (the parent of a span is in its trace), and reads
 * the same traces every time - so the trace set is a predicate, never a
 * LIMIT, and the two places the statement reads it see the same traces. The
 * percent is picked from the service's span count in the window, which the
 * minute projection answers cheaply, so a busy service reads about
 * TRACE_HEALTH_TARGET_SAMPLED_SPANS of its spans and a quiet one all of them.
 *
 * A span's parent is looked for among the spans of its trace in the window
 * widened by TRACE_HEALTH_PARENT_PADDING_MS on both sides: a parent starts
 * before its children, and the clocks of two hosts disagree a little. A
 * parent that started longer before the window (a long job's root span) is
 * not looked for, so its children near the window's start count as missing
 * it; so do the children of a parent still running when the window ends,
 * whose span has not been sent yet. Both are a sliver of an hour of a
 * request-serving service.
 */

// The window when the request names none: the last hour.
export const TRACE_HEALTH_DEFAULT_WINDOW_MS: number = 60 * 60 * 1000;

// The widest window measured: a wider one is cut to its last 24 hours.
export const TRACE_HEALTH_MAX_WINDOW_MS: number = 24 * 60 * 60 * 1000;

// How far past each edge of the window a span's parent is looked for.
export const TRACE_HEALTH_PARENT_PADDING_MS: number = 5 * 60 * 1000;

/*
 * About how many of the service's spans the sample reads: enough that a
 * share is good to a percent or so, few enough that the sets the statement
 * builds stay small.
 */
export const TRACE_HEALTH_TARGET_SAMPLED_SPANS: number = 20000;

/*
 * When a share looks poor - the one place the card's verdicts come from.
 *
 *   - A span's parent is there unless a sender dropped it, so more than a
 *     sliver missing (the window's edges cost about half a percent) means
 *     spans are being lost.
 *   - A one-span trace is normal for background work and calls no request
 *     made, so only when they are a large part of the traces.
 *   - Logs written outside any request carry no trace id even with
 *     correlation on, so only when most of the logs have none.
 */
export const TRACE_HEALTH_THRESHOLDS: Readonly<{
  maxOrphanSpanShare: number;
  maxSingleSpanTraceShare: number;
  minLogsLinkedShare: number;
}> = {
  maxOrphanSpanShare: 0.05,
  maxSingleSpanTraceShare: 0.3,
  minLogsLinkedShare: 0.5,
};

/*
 * A trace id of all zeros is OpenTelemetry's "no trace": a log that carries
 * it is not linked to anything.
 */
export const INVALID_TRACE_ID: string = "00000000000000000000000000000000";

const SPAN_TABLE: string = AnalyticsTableName.Span;
const LOG_TABLE: string = AnalyticsTableName.Log;

/*
 * Rows past their retention are left out, as every raw-table read leaves
 * them out (TraceAggregationService.RETENTION_FILTER).
 */
const RETENTION_FILTER: string = " AND retentionDate >= now()";

export interface TraceHealthWindow {
  startTime: Date;
  endTime: Date;
}

export interface TraceHealthQuery extends TraceHealthWindow {
  projectId: ObjectID;
  /*
   * The service the caller may read, as TelemetryReadScopeUtil.toServiceFilter
   * hands it: never empty - an empty list would read every service.
   */
  serviceFilter: TelemetryServiceFilter;
}

export interface TraceHealthSpanQuery extends TraceHealthQuery {
  // 1 to 100 (pickTraceHealthSamplePercent).
  samplePercent: number;
}

export interface TraceHealthSpanCounts {
  // The service's spans in the window, in the traces read.
  spanCount: number;
  // Those that name a parent span their trace does not have.
  orphanSpanCount: number;
  // The traces read that the service has spans in.
  traceCount: number;
  // Those that are one span long.
  singleSpanTraceCount: number;
}

export interface TraceHealthLogCounts {
  logCount: number;
  // Those that carry a trace id.
  linkedLogCount: number;
}

export const NO_TRACE_HEALTH_SPANS: TraceHealthSpanCounts = {
  spanCount: 0,
  orphanSpanCount: 0,
  traceCount: 0,
  singleSpanTraceCount: 0,
};

/*
 * An edge of the window from a request body: an ISO date string, or nothing
 * (undefined, null or ""). Read the way the trace histogram reads it
 * (OneUptimeDate.fromString); anything that is not a date is refused, so a
 * broken range is answered with the reason rather than with a query
 * ClickHouse cannot run. Text no date parser reads ("soon") is refused
 * before it reaches moment, which would log a deprecation warning for it.
 */
function readWindowEdge(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !Number.isFinite(Date.parse(value.trim()))) {
    throw new BadDataException(`${name} must be a date`);
  }

  const date: Date = OneUptimeDate.fromString(value);

  if (!Number.isFinite(date.getTime())) {
    throw new BadDataException(`${name} must be a date`);
  }

  return date;
}

/*
 * The window measured: the one asked for, the hour before its end when it
 * names no start, ending now when it names no end, and at most
 * TRACE_HEALTH_MAX_WINDOW_MS wide - a wider one keeps its last 24 hours.
 * One reading of the clock serves both default edges.
 */
export function resolveTraceHealthWindow(data: {
  startTime: unknown;
  endTime: unknown;
  now: Date;
}): TraceHealthWindow {
  const requestedStart: Date | null = readWindowEdge(
    data.startTime,
    "startTime",
  );
  const requestedEnd: Date | null = readWindowEdge(data.endTime, "endTime");

  const endTime: Date = requestedEnd || data.now;
  const startTime: Date =
    requestedStart ||
    new Date(endTime.getTime() - TRACE_HEALTH_DEFAULT_WINDOW_MS);

  if (startTime.getTime() > endTime.getTime()) {
    throw new BadDataException("startTime must not be after endTime");
  }

  if (endTime.getTime() - startTime.getTime() > TRACE_HEALTH_MAX_WINDOW_MS) {
    return {
      startTime: new Date(endTime.getTime() - TRACE_HEALTH_MAX_WINDOW_MS),
      endTime,
    };
  }

  return { startTime, endTime };
}

// The service a request asks about: a service id, or a 400.
export function readTraceHealthServiceId(value: unknown): ObjectID {
  if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
    throw new BadDataException("serviceId must be a service id");
  }

  return new ObjectID(value.trim());
}

/*
 * The share of traces to read for a service with this many spans in the
 * window: every trace up to TRACE_HEALTH_TARGET_SAMPLED_SPANS spans, and
 * past that the percent that reads about that many, never below 1.
 */
export function pickTraceHealthSamplePercent(serviceSpanCount: number): number {
  if (
    !Number.isFinite(serviceSpanCount) ||
    serviceSpanCount <= TRACE_HEALTH_TARGET_SAMPLED_SPANS
  ) {
    return 100;
  }

  return Math.min(
    100,
    Math.max(
      1,
      Math.ceil((TRACE_HEALTH_TARGET_SAMPLED_SPANS * 100) / serviceSpanCount),
    ),
  );
}

function assertSamplePercent(samplePercent: number): void {
  if (
    !Number.isInteger(samplePercent) ||
    samplePercent < 1 ||
    samplePercent > 100
  ) {
    throw new BadDataException("samplePercent must be a whole number 1-100");
  }
}

function assertServiceFilter(filter: TelemetryServiceFilter): void {
  if (!filter.serviceIds || filter.serviceIds.length === 0) {
    throw new BadDataException(
      "A trace health read names the service it reads",
    );
  }
}

function getPaddedWindow(window: TraceHealthWindow): TraceHealthWindow {
  return {
    startTime: new Date(
      window.startTime.getTime() - TRACE_HEALTH_PARENT_PADDING_MS,
    ),
    endTime: new Date(
      window.endTime.getTime() + TRACE_HEALTH_PARENT_PADDING_MS,
    ),
  };
}

// ` AND cityHash64(traceId) % 100 < pct`; nothing when every trace is read.
function appendTraceSample(statement: Statement, samplePercent: number): void {
  if (samplePercent >= 100) {
    return;
  }

  statement.append(
    SQL` AND cityHash64(traceId) % 100 < ${{
      type: TableColumnType.Number,
      value: samplePercent,
    }}`,
  );
}

// ` AND startTime >= start AND startTime <= end`.
function appendStartTimeWindow(
  statement: Statement,
  window: TraceHealthWindow,
): void {
  statement.append(
    SQL` AND startTime >= ${{
      type: TableColumnType.DateTime64,
      value: window.startTime,
    }} AND startTime <= ${{
      type: TableColumnType.DateTime64,
      value: window.endTime,
    }}`,
  );
}

/*
 * The trace set: the sampled traces the service has spans in, in the
 * window. A predicate over the trace id, with no LIMIT, so it is the same
 * traces wherever the statement reads it.
 */
function buildServiceTracesQuery(query: TraceHealthSpanQuery): Statement {
  const statement: Statement = SQL`SELECT DISTINCT traceId FROM ${SPAN_TABLE} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: query.projectId,
  }}`;

  appendStartTimeWindow(statement, query);
  appendTraceSample(statement, query.samplePercent);
  TelemetryReadScopeUtil.appendServiceFilter(statement, query.serviceFilter);
  statement.append(RETENTION_FILTER);

  return statement;
}

/*
 * ` WHERE ...` for every span the sampled traces have in the padded window,
 * whatever service sent it: the parents and the siblings of the service's
 * spans.
 */
function appendTraceSpansWhere(
  statement: Statement,
  query: TraceHealthSpanQuery,
): void {
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: query.projectId,
    }}`,
  );
  appendStartTimeWindow(statement, getPaddedWindow(query));
  appendTraceSample(statement, query.samplePercent);
  statement.append(" AND traceId GLOBAL IN service_traces");
  statement.append(RETENTION_FILTER);
}

/*
 * The service's span count in the window, from the proj_hist_by_minute
 * aggregate projection (primaryEntityId is one of its keys, and the window
 * is filtered on its toStartOfMinute key): a few pre-aggregated rows, read
 * only to pick the sample percent. The minute edges make it a little wider
 * than the window, never narrower, so a count of 0 means no span.
 */
export function buildServiceSpanCountStatement(
  query: TraceHealthQuery,
): Statement {
  assertServiceFilter(query.serviceFilter);

  const statement: Statement = SQL`SELECT count() AS spanCount FROM ${SPAN_TABLE} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: query.projectId,
  }} AND toStartOfMinute(startTime) >= toStartOfMinute(${{
    type: TableColumnType.Date,
    value: query.startTime,
  }}) AND toStartOfMinute(startTime) <= toStartOfMinute(${{
    type: TableColumnType.Date,
    value: query.endTime,
  }})`;

  TelemetryReadScopeUtil.appendServiceFilter(statement, query.serviceFilter);

  statement.append(
    getQuerySettings({
      ...INTERACTIVE_READ_TIME_LIMIT,
      additionalSettings: { optimize_use_projections: 1 },
    }),
  );

  return statement;
}

/*
 * The trace numbers, in one statement over the sampled traces the service
 * has spans in (service_traces, read twice):
 *
 *   - each trace's spans in the padded window, grouped by trace: how many
 *     (a one-span trace), and how many are the service's, in the window;
 *   - of those, the ones that name a parent span (parentSpanId set) whose
 *     (traceId, spanId) is not among the spans of the traces read. The
 *     parent id is Nullable(String): it is compared as assumeNotNull, so the
 *     tuple matches the set's (String, String), and only once it is known
 *     to be set.
 *
 * GLOBAL IN and GLOBAL NOT IN, because the span table is Distributed: a
 * subquery over the same Distributed table inside IN is refused on a
 * multi-shard cluster (Code 288), and GLOBAL builds each set once, where the
 * query was sent. On one shard it changes nothing.
 */
export function buildSpanHealthStatement(
  query: TraceHealthSpanQuery,
): Statement {
  assertServiceFilter(query.serviceFilter);
  assertSamplePercent(query.samplePercent);

  const statement: Statement = SQL`WITH service_traces AS (`;
  statement.append(buildServiceTracesQuery(query));
  statement.append(
    ") SELECT sum(serviceSpans) AS spanCount, sum(orphanSpans) AS orphanSpanCount, count() AS traceCount, countIf(spansInTrace = 1) AS singleSpanTraceCount FROM (SELECT traceId, count() AS spansInTrace, ",
  );

  // A span of the service, in the window.
  const appendIsServiceSpan: () => void = (): void => {
    statement.append("countIf(1");
    appendStartTimeWindow(statement, query);
    TelemetryReadScopeUtil.appendServiceFilter(statement, query.serviceFilter);
  };

  appendIsServiceSpan();
  statement.append(") AS serviceSpans, ");

  appendIsServiceSpan();
  statement.append(
    SQL` AND ifNull(parentSpanId, '') != '' AND (traceId, assumeNotNull(parentSpanId)) GLOBAL NOT IN (SELECT traceId, spanId FROM ${SPAN_TABLE}`,
  );
  appendTraceSpansWhere(statement, query);
  statement.append(SQL`)) AS orphanSpans FROM ${SPAN_TABLE}`);
  appendTraceSpansWhere(statement, query);
  statement.append(" GROUP BY traceId)");

  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}

/*
 * The service's logs in the window, and those that carry a trace id. Every
 * log is counted: a log's trace id is what is being measured, so it cannot
 * be sampled by one, and a count reads two narrow columns. traceId is
 * Nullable on logs.
 */
export function buildLogLinkStatement(query: TraceHealthQuery): Statement {
  assertServiceFilter(query.serviceFilter);

  const statement: Statement = SQL`SELECT count() AS logCount, countIf(ifNull(traceId, '') NOT IN ('', ${{
    type: TableColumnType.Text,
    value: INVALID_TRACE_ID,
  }})) AS linkedLogCount FROM ${LOG_TABLE} WHERE projectId = ${{
    type: TableColumnType.ObjectID,
    value: query.projectId,
  }} AND time >= ${{
    type: TableColumnType.DateTime64,
    value: query.startTime,
  }} AND time <= ${{
    type: TableColumnType.DateTime64,
    value: query.endTime,
  }}`;

  TelemetryReadScopeUtil.appendServiceFilter(statement, query.serviceFilter);
  statement.append(RETENTION_FILTER);
  statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

  return statement;
}

/*
 * A count out of a row: ClickHouse writes UInt64 as a string in JSON, and a
 * missing or broken value is 0.
 */
function readRowCount(row: JSONObject | undefined, key: string): number {
  const value: number = Number(row?.[key] ?? 0);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function readServiceSpanCount(rows: Array<JSONObject>): number {
  return readRowCount(rows[0], "spanCount");
}

export function readSpanHealthCounts(
  rows: Array<JSONObject>,
): TraceHealthSpanCounts {
  const row: JSONObject | undefined = rows[0];
  const spanCount: number = readRowCount(row, "spanCount");
  const traceCount: number = readRowCount(row, "traceCount");

  return {
    spanCount,
    orphanSpanCount: Math.min(spanCount, readRowCount(row, "orphanSpanCount")),
    traceCount,
    singleSpanTraceCount: Math.min(
      traceCount,
      readRowCount(row, "singleSpanTraceCount"),
    ),
  };
}

export function readLogLinkCounts(
  rows: Array<JSONObject>,
): TraceHealthLogCounts {
  const row: JSONObject | undefined = rows[0];
  const logCount: number = readRowCount(row, "logCount");

  return {
    logCount,
    linkedLogCount: Math.min(logCount, readRowCount(row, "linkedLogCount")),
  };
}

function getShare(part: number, whole: number): number | null {
  return whole > 0 ? Math.min(1, Math.max(0, part / whole)) : null;
}

/*
 * The shares that look poor, by TRACE_HEALTH_THRESHOLDS, in the order the
 * card shows its tiles. A share that could not be measured (null) is not a
 * finding: no logs is not unlinked logs.
 */
export function getTraceHealthHints(shares: {
  orphanSpanShare: number | null;
  singleSpanTraceShare: number | null;
  logsLinkedShare: number | null;
}): Array<TraceHealthHint> {
  const hints: Array<TraceHealthHint> = [];

  if (
    shares.orphanSpanShare !== null &&
    shares.orphanSpanShare > TRACE_HEALTH_THRESHOLDS.maxOrphanSpanShare
  ) {
    hints.push(TraceHealthHint.MissingParentSpans);
  }

  if (
    shares.singleSpanTraceShare !== null &&
    shares.singleSpanTraceShare >
      TRACE_HEALTH_THRESHOLDS.maxSingleSpanTraceShare
  ) {
    hints.push(TraceHealthHint.OneSpanTraces);
  }

  if (
    shares.logsLinkedShare !== null &&
    shares.logsLinkedShare < TRACE_HEALTH_THRESHOLDS.minLogsLinkedShare
  ) {
    hints.push(TraceHealthHint.UnlinkedLogs);
  }

  return hints;
}

/*
 * The report from what the statements counted. `logs` is null when the
 * logs were not read - the caller may read none of the service's logs, or
 * the service had no spans to measure.
 */
export function interpretTraceHealth(data: {
  window: TraceHealthWindow;
  samplePercent: number;
  spans: TraceHealthSpanCounts;
  logs: TraceHealthLogCounts | null;
}): TraceHealthReport {
  const orphanSpanShare: number | null = getShare(
    data.spans.orphanSpanCount,
    data.spans.spanCount,
  );
  const singleSpanTraceShare: number | null = getShare(
    data.spans.singleSpanTraceCount,
    data.spans.traceCount,
  );
  const logCount: number = data.logs ? data.logs.logCount : 0;
  const logsLinkedShare: number | null = data.logs
    ? getShare(data.logs.linkedLogCount, data.logs.logCount)
    : null;

  return {
    startTime: data.window.startTime.toISOString(),
    endTime: data.window.endTime.toISOString(),
    samplePercent: data.samplePercent,
    spanCount: data.spans.spanCount,
    traceCount: data.spans.traceCount,
    orphanSpanShare,
    singleSpanTraceShare,
    logCount,
    logsLinkedShare,
    hints: getTraceHealthHints({
      orphanSpanShare,
      singleSpanTraceShare,
      logsLinkedShare,
    }),
  };
}
