import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, { Results } from "./AnalyticsDatabaseService";
import ExceptionInstance from "../../Models/AnalyticsModels/ExceptionInstance";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { ResponseJSON } from "@clickhouse/client";

// The longest exception message a trace's reader takes.
export const TRACE_EXCEPTION_MESSAGE_LENGTH: number = 500;

export class ExceptionInstanceService extends AnalyticsDatabaseService<ExceptionInstance> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: ExceptionInstance, database: clickhouseDatabase });
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
      }}) AND retentionDate >= now() ORDER BY traceId ASC, time ASC LIMIT ${{
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
