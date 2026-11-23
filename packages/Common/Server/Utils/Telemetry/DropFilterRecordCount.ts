import { ResponseJSON } from "@clickhouse/client";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DROP_FILTER_IMPACT_LOOKBACK_IN_HOURS,
  DropFilterRecordCount,
  DropFilterRecordCountState,
} from "../../../Types/Telemetry/DropFilterImpact";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryFieldSignal } from "../../../Types/Telemetry/TelemetryFieldReaders";
import { TelemetryFilterExpression } from "../../../Utils/Telemetry/TelemetryFilterQuery";
import AnalyticsDatabaseService, {
  Results,
} from "../../Services/AnalyticsDatabaseService";
import LogService, {
  LogService as LogServiceClass,
} from "../../Services/LogService";
import SpanService from "../../Services/SpanService";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import { appendTraceScanCandidateCondition } from "../SecurityEvent/TelemetryScan/TelemetryScanStatements";
import { buildTelemetryFilterCondition } from "./TelemetryFilterQuerySql";
import TelemetryReadAccess from "./TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "./TelemetryReadScope";

/*
 * HOW MANY OF THE LAST DAY'S RECORDS A DROP OR SAMPLE FILTER MATCHES, AND
 * HOW MANY OF THOSE SECURITY EVENTS READ (#10436).
 *
 * Counted the way Drop This Metric counts what its rule would drop
 * (DataSecurity/Telemetry/TelemetryMetricDrop): the last day, read once,
 * bounded in time, and said to be unknown - never zero - when it could not
 * be read. One ClickHouse statement over one project's records of the day:
 *
 *   SELECT count() AS total,
 *          countIf((<the filter's query>) AS isMatched) AS matched,
 *          countIf(isMatched AND <Security Events' prefilter>) AS securityRead
 *   FROM <Log or Span> WHERE projectId = ... AND <the last day>
 *   SETTINGS max_execution_time = 10, timeout_overflow_mode = 'throw', ...
 *
 * The filter's query is read as ingest reads it (TelemetryFilterQuerySql);
 * the prefilter is the very condition the scan reads candidates by - the
 * log scan's (LogService.buildSecurityLogPrefilter) or the trace scan's
 * (appendTraceScanCandidateCondition) - and only where that scan reads the
 * signal. `isMatched` is worked out once a row, and the prefilter only for
 * the rows it holds (ClickHouse evaluates AND short-circuit).
 *
 * A count that runs out of its time is stopped and said to be so: the form
 * says it, and never waits on it. Counted over the services whose records
 * the person may read: a count is about what the records hold, and a query
 * someone writes could otherwise ask, one count at a time, what is in
 * records they may not read.
 */

// How long the count may run.
export const DROP_FILTER_COUNT_TIME_LIMIT_IN_SECONDS: number = 10;

interface SignalTable {
  service: AnalyticsDatabaseService<AnalyticsBaseModel>;
  model: { new (): AnalyticsBaseModel };
  // The column a record's time is in, which the table is sorted by.
  timeColumn: string;
}

function tableOfSignal(signal: TelemetryFieldSignal): SignalTable {
  return signal === "log"
    ? {
        service:
          LogService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
        model: Log,
        timeColumn: "time",
      }
    : {
        service:
          SpanService as unknown as AnalyticsDatabaseService<AnalyticsBaseModel>,
        model: Span,
        timeColumn: "startTime",
      };
}

function qualifiedTableName(table: SignalTable): string {
  if (!table.service.database) {
    table.service.useDefaultDatabase();
  }

  return `${table.service.database.getDatasourceOptions().database}.${
    new table.model().tableName
  }`;
}

// Security Events' prefilter of the signal, as a condition.
export function buildSecurityEventsPrefilter(
  signal: TelemetryFieldSignal,
): Statement {
  if (signal === "log") {
    return LogServiceClass.buildSecurityLogPrefilter();
  }

  const statement: Statement = SQL``;
  appendTraceScanCandidateCondition(statement);

  return statement;
}

export function buildDropFilterCountStatement(data: {
  signal: TelemetryFieldSignal;
  projectId: ObjectID;
  expr: TelemetryFilterExpression;
  since: Date;
  until: Date;
  // Count what Security Events reads too: only where it reads the signal.
  countSecurityEvents: boolean;
  serviceFilter?: TelemetryServiceFilter | undefined;
  tableName: string;
  timeColumn: string;
  timeLimitInSeconds: number;
}): Statement {
  const statement: Statement = SQL`SELECT count() AS total, countIf((`;
  statement.append(
    buildTelemetryFilterCondition({ signal: data.signal, expr: data.expr }),
  );
  statement.append(") AS isMatched) AS matched");

  if (data.countSecurityEvents) {
    statement.append(", countIf(isMatched AND ");
    statement.append(buildSecurityEventsPrefilter(data.signal));
    statement.append(") AS securityRead");
  }

  // The table and the time column are this file's own, never a caller's.
  statement.append(` FROM ${data.tableName}`);
  statement.append(
    SQL` WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }}`,
  );
  statement.append(` AND ${data.timeColumn} >= `);
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.since }}`,
  );
  statement.append(` AND ${data.timeColumn} <= `);
  statement.append(
    SQL`${{ type: TableColumnType.DateTime64, value: data.until }}`,
  );
  statement.append(" AND retentionDate >= now()");

  if (data.serviceFilter) {
    TelemetryReadScopeUtil.appendServiceFilter(statement, data.serviceFilter);
  }

  statement.append(
    getQuerySettings({
      maxExecutionTimeInSeconds: data.timeLimitInSeconds,
      timeoutOverflowMode: "throw",
      boundScanMemory: true,
    }),
  );

  return statement;
}

function isPermissionRefusal(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof NotAuthenticatedException ||
    error instanceof PaymentRequiredException
  );
}

function readCount(row: JSONObject | undefined, key: string): number {
  const value: number = Number(row?.[key]);

  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/*
 * The count for the person asking (`props`): over the services whose
 * records they may read, or not at all when they may read none.
 */
export async function countDropFilterRecords(data: {
  signal: TelemetryFieldSignal;
  projectId: ObjectID;
  expr: TelemetryFilterExpression;
  countSecurityEvents: boolean;
  props: DatabaseCommonInteractionProps;
  now?: Date | undefined;
  timeLimitInSeconds?: number | undefined;
}): Promise<DropFilterRecordCount> {
  const timeLimitInSeconds: number =
    data.timeLimitInSeconds || DROP_FILTER_COUNT_TIME_LIMIT_IN_SECONDS;
  const count: DropFilterRecordCount = {
    state: DropFilterRecordCountState.Failed,
    lookbackInHours: DROP_FILTER_IMPACT_LOOKBACK_IN_HOURS,
    total: 0,
    matched: 0,
    securityEventsRead: null,
    isScoped: false,
    timeLimitInSeconds,
  };
  const table: SignalTable = tableOfSignal(data.signal);
  let serviceFilter: TelemetryServiceFilter | undefined;

  try {
    const scope: TelemetryReadScope = await TelemetryReadAccess.getScope(
      table.model,
      data.props,
    );

    if (!TelemetryReadScopeUtil.isProjectWide(scope)) {
      serviceFilter = TelemetryReadScopeUtil.toServiceFilter(scope);
      count.isScoped = true;
    }
  } catch (error) {
    if (isPermissionRefusal(error)) {
      count.state = DropFilterRecordCountState.NotPermitted;
      return count;
    }

    logger.warn(
      `Drop filter impact: could not tell which ${data.signal}s of project ${data.projectId.toString()} the person asking may read:`,
    );
    logger.warn(error);

    return count;
  }

  const until: Date = data.now || new Date();
  const since: Date = new Date(
    until.getTime() - DROP_FILTER_IMPACT_LOOKBACK_IN_HOURS * 60 * 60 * 1000,
  );

  try {
    const result: Results = await table.service.executeQuery(
      buildDropFilterCountStatement({
        signal: data.signal,
        projectId: data.projectId,
        expr: data.expr,
        since,
        until,
        countSecurityEvents: data.countSecurityEvents,
        serviceFilter,
        tableName: qualifiedTableName(table),
        timeColumn: table.timeColumn,
        timeLimitInSeconds,
      }),
    );
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();
    const row: JSONObject | undefined = (response.data || [])[0] as
      | JSONObject
      | undefined;

    count.state = DropFilterRecordCountState.Counted;
    count.total = readCount(row, "total");
    count.matched = readCount(row, "matched");
    count.securityEventsRead = data.countSecurityEvents
      ? readCount(row, "securityRead")
      : null;

    return count;
  } catch (error) {
    if (AnalyticsDatabaseService.isQueryTimeoutError(error)) {
      count.state = DropFilterRecordCountState.TimedOut;
      return count;
    }

    logger.warn(
      `Drop filter impact: could not count the ${data.signal}s of project ${data.projectId.toString()} a filter matches:`,
    );
    logger.warn(error);

    return count;
  }
}
