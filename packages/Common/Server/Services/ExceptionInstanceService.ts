import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, { Results } from "./AnalyticsDatabaseService";
import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";
import AggregateBy from "../Types/AnalyticsDatabase/AggregateBy";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import ExistsBy from "../Types/AnalyticsDatabase/ExistsBy";
import FindBy from "../Types/AnalyticsDatabase/FindBy";
import { OnFind } from "../Types/AnalyticsDatabase/Hooks";
import Query from "../Types/AnalyticsDatabase/Query";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TelemetryRowRetention from "../Utils/Telemetry/TelemetryRowRetention";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { ResponseJSON } from "@clickhouse/client";

// The longest exception message a trace's reader takes.
export const TRACE_EXCEPTION_MESSAGE_LENGTH: number = 500;

/*
 * ONE CRASH, COUNTED ONCE (#9923).
 *
 * An iOS crash KSCrash and MetricKit both report arrives twice. Ingest keeps
 * the second report as an occurrence of its own - the evidence it is - under
 * the first one's exception, with duplicateOf naming the first
 * (AppleCrashRegister). Everything that lists or counts occurrences reads
 * the ones that repeat none: the exceptions list and its charts, a
 * session's or an install's crashes, monitors and their baselines, the
 * Overview. A query reads repeats only by asking: by duplicateOf - the
 * repeats of an occurrence - or by an occurrence's own _id.
 *
 * SQL written by hand reads this table around these hooks, so it says the
 * same itself (EXCEPTION_ORIGINALS_SQL, held to by
 * ExceptionRepeatsCountedOnce.test.ts).
 */
export const EXCEPTION_ORIGINALS_SQL: string = "duplicateOf = ''";

export function readsOriginalOccurrences(
  query: Query<ExceptionInstance>,
): Query<ExceptionInstance> {
  if (
    Object.prototype.hasOwnProperty.call(query, "duplicateOf") ||
    Object.prototype.hasOwnProperty.call(query, "_id")
  ) {
    return query;
  }

  return { ...query, duplicateOf: "" };
}

export class ExceptionInstanceService extends AnalyticsDatabaseService<ExceptionInstance> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ExceptionInstance, database: clickhouseDatabase });
  }

  // A list reads the occurrences that repeat none (readsOriginalOccurrences).
  protected override async onBeforeFind(
    findBy: FindBy<ExceptionInstance>,
  ): Promise<OnFind<ExceptionInstance>> {
    return {
      findBy: { ...findBy, query: readsOriginalOccurrences(findBy.query) },
      carryForward: null,
    };
  }

  // And so does its count, so the two describe the same rows.
  protected override async onBeforeCount(
    countBy: CountBy<ExceptionInstance>,
  ): Promise<CountBy<ExceptionInstance>> {
    return { ...countBy, query: readsOriginalOccurrences(countBy.query) };
  }

  /*
   * The reads below go around those hooks to the read permission, so each
   * takes the same rule itself: a rule's preview and an anomaly's baseline
   * count what the monitor counts, and a chart draws what the list shows.
   */
  public override async countPerWindow(data: {
    query: Query<ExceptionInstance>;
    timeColumnName: string;
    windowInSeconds: number;
    windowsStartAt?: Date | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<{ time: Date; count: number }>> {
    return await super.countPerWindow({
      ...data,
      query: readsOriginalOccurrences(data.query),
    });
  }

  public override async countPerValueInWindows(data: {
    query: Query<ExceptionInstance>;
    valueColumnName: string;
    timeColumnName: string;
    windows: Array<{ startsAt: Date; endsAt: Date }>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, Array<number>>> {
    return await super.countPerValueInWindows({
      ...data,
      query: readsOriginalOccurrences(data.query),
    });
  }

  public override async existsBy(
    existsBy: ExistsBy<ExceptionInstance>,
  ): Promise<boolean> {
    return await super.existsBy({
      ...existsBy,
      query: readsOriginalOccurrences(existsBy.query),
    });
  }

  public override async aggregateBy(
    aggregateBy: AggregateBy<ExceptionInstance>,
  ): Promise<AggregatedResult> {
    return await super.aggregateBy({
      ...aggregateBy,
      query: readsOriginalOccurrences(aggregateBy.query),
    });
  }

  /*
   * Its resource's retention for traces of its span's status, as the
   * traces ingest gives the exceptions it records.
   */
  protected override async getRetentionDateOnCreate(
    exception: ExceptionInstance,
  ): Promise<Date | null> {
    return await TelemetryRowRetention.getRetentionDate({
      row: exception,
      pillar: "traces",
      bucketKey: exception.spanStatusCode,
    });
  }

  /*
   * The exceptions a few traces recorded, for the security events that
   * happened in them: which span threw, what (type, the start of its
   * message) and the fingerprint its exception group is found by - with the
   * service it was recorded under, which the group is unique within. One
   * project's, a bounded window's, the first `limitPerTrace` of a trace.
   */
  @CaptureSpan()
  public async findExceptionsOfTraces(data: {
    projectId: ObjectID;
    traceIds: Array<string>;
    after: Date;
    before: Date;
    limitPerTrace: number;
    limit: number;
  }): Promise<Array<JSONObject>> {
    if (data.traceIds.length === 0) {
      return [];
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT traceId, spanId, fingerprint, exceptionType, primaryEntityId, substring(message, 1, ${{
      type: TableColumnType.Number,
      value: TRACE_EXCEPTION_MESSAGE_LENGTH,
    }}) AS message, time FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.Date,
        value: data.after,
      }} AND time <= ${{
        type: TableColumnType.Date,
        value: data.before,
      }} AND traceId IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.traceIds),
      }}) AND retentionDate >= now() AND `,
    );
    // One crash, counted once (readsOriginalOccurrences).
    statement.append(EXCEPTION_ORIGINALS_SQL);
    statement.append(
      SQL` ORDER BY traceId ASC, time ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limitPerTrace)),
      }} BY traceId LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }}`,
    );
    statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

    const result: Results = await this.executeQuery(statement);
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return (response.data || []) as Array<JSONObject>;
  }
}

export default new ExceptionInstanceService();
