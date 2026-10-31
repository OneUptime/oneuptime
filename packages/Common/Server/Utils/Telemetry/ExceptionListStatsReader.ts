import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  clampExceptionTrendBucket,
  emptyExceptionTrend,
  ExceptionListStats,
  ExceptionListStatsItem,
  getExceptionTrendBucketSizeInSeconds,
  MAX_EXCEPTION_LIST_STATS_IDS,
} from "../../../Types/Telemetry/ExceptionListStats";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import ExceptionInstanceService from "../../Services/ExceptionInstanceService";
import TelemetryExceptionService from "../../Services/TelemetryExceptionService";
import QueryHelper from "../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import logger from "../Logger";
import TelemetryReadAccess from "./TelemetryReadAccess";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "./TelemetryReadScope";

/*
 * THE NUMBERS BESIDE EACH ROW OF THE EXCEPTIONS LIST, FOR ONE PAGE.
 *
 * Asked for the exceptions on the page and the range the list shows, it
 * answers, per exception, how many distinct users its occurrences in the
 * range happened to and how many occurrences fell in each slice of the range
 * (Common/Types/Telemetry/ExceptionListStats).
 *
 * Read as the person asking: the exceptions through their permissions (one
 * they may not read is not answered for), then the occurrences in ClickHouse
 * with their telemetry read scope applied, and only for those exceptions'
 * fingerprints - never the whole project's. Two small GROUP BY reads, over
 * the same narrow slice the list's chart reads, in parallel.
 */

const TABLE_NAME: string = AnalyticsTableName.ExceptionInstance;

export interface ExceptionListStatsQuery {
  projectId: ObjectID;
  /*
   * The fingerprints read, and beside each the exception it counts for: its
   * own, or the one it was merged into. Both reads group by that exception,
   * so a user who met two merged exceptions counts once.
   */
  fingerprints: Array<string>;
  groupIds: Array<string>;
  startTime: Date;
  endTime: Date;
  bucketSizeInSeconds: number;
  serviceFilter: TelemetryServiceFilter;
}

interface TrendRow {
  groupId: string;
  bucket: number;
  count: number;
}

interface AffectedUsersRow {
  groupId: string;
  users: number;
}

function toNumber(value: unknown): number {
  const parsed: number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isFinite(parsed) ? parsed : NaN;
}

export default class ExceptionListStatsReader {
  /*
   * The range a request may ask about: two real times, the end after the
   * start. The list never sends anything else.
   */
  public static checkRange(startTime: Date, endTime: Date): void {
    if (
      !(startTime instanceof Date) ||
      !(endTime instanceof Date) ||
      Number.isNaN(startTime.getTime()) ||
      Number.isNaN(endTime.getTime())
    ) {
      throw new BadDataException("A start and an end time are required");
    }

    if (endTime.getTime() <= startTime.getTime()) {
      throw new BadDataException("The end time must be after the start time");
    }
  }

  // Shared by both reads: the project, the range, the fingerprints, the scope.
  private static appendWhere(
    statement: Statement,
    query: ExceptionListStatsQuery,
  ): void {
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND time >= ${{
        type: TableColumnType.Date,
        value: query.startTime,
      }} AND time <= ${{
        type: TableColumnType.Date,
        value: query.endTime,
      }} AND fingerprint IN (${{
        type: TableColumnType.Text,
        value: new Includes(query.fingerprints),
      }})`,
    );

    /*
     * Rows past their retention stay in their part until the whole part
     * drops (ttl_only_drop_parts): the chart above the list leaves them out
     * the same way.
     */
    statement.append(" AND retentionDate >= now()");

    TelemetryReadScopeUtil.appendServiceFilter(statement, query.serviceFilter);
  }

  // The exception an occurrence counts for, from its fingerprint.
  private static groupColumn(query: ExceptionListStatsQuery): Statement {
    return SQL`transform(fingerprint, ${{
      type: TableColumnType.Text,
      value: new Includes(query.fingerprints),
    }}, ${{
      type: TableColumnType.Text,
      value: new Includes(query.groupIds),
    }}, '') AS grp`;
  }

  /*
   * Occurrences per exception and slice. The slice is counted from the
   * range's own start, so slice 0 is its first EXCEPTION_TREND_BUCKET_COUNT-th.
   */
  public static buildTrendStatement(query: ExceptionListStatsQuery): Statement {
    const statement: Statement = SQL`SELECT `;
    statement.append(ExceptionListStatsReader.groupColumn(query));
    statement.append(
      SQL`, intDiv(toInt64(toUnixTimestamp(time)) - ${{
        type: TableColumnType.BigNumber,
        value: Math.floor(query.startTime.getTime() / 1000),
      }}, ${{
        type: TableColumnType.Number,
        value: query.bucketSizeInSeconds,
      }}) AS bucket, count() AS cnt FROM ${TABLE_NAME}`,
    );

    ExceptionListStatsReader.appendWhere(statement, query);

    statement.append(" GROUP BY grp, bucket");
    statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

    return statement;
  }

  /*
   * Distinct users per exception. Occurrences that name no user are left
   * out, so an exception none of whose occurrences names one counts nobody
   * rather than one "empty" user.
   */
  public static buildAffectedUsersStatement(
    query: ExceptionListStatsQuery,
  ): Statement {
    const statement: Statement = SQL`SELECT `;
    statement.append(ExceptionListStatsReader.groupColumn(query));
    statement.append(SQL`, uniq(userId) AS users FROM ${TABLE_NAME}`);

    ExceptionListStatsReader.appendWhere(statement, query);

    statement.append(" AND userId != ''");
    statement.append(" GROUP BY grp");
    statement.append(getQuerySettings({ ...INTERACTIVE_READ_TIME_LIMIT }));

    return statement;
  }

  private static async readRows(
    statement: Statement,
  ): Promise<Array<JSONObject>> {
    const result: Results =
      await ExceptionInstanceService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }

  public static toTrendRows(rows: Array<JSONObject>): Array<TrendRow> {
    const out: Array<TrendRow> = [];

    for (const row of rows) {
      const bucket: number = toNumber(row["bucket"]);
      const count: number = toNumber(row["cnt"]);

      if (Number.isNaN(bucket) || Number.isNaN(count) || count <= 0) {
        continue;
      }

      out.push({
        groupId: String(row["grp"] || "").toLowerCase(),
        bucket,
        count: Math.floor(count),
      });
    }

    return out;
  }

  public static toAffectedUsersRows(
    rows: Array<JSONObject>,
  ): Array<AffectedUsersRow> {
    const out: Array<AffectedUsersRow> = [];

    for (const row of rows) {
      const users: number = toNumber(row["users"]);

      if (Number.isNaN(users) || users < 0) {
        continue;
      }

      out.push({
        groupId: String(row["grp"] || "").toLowerCase(),
        users: Math.floor(users),
      });
    }

    return out;
  }

  /*
   * The exceptions' ids, without repeats and capped at the largest page the
   * list offers. A malformed id is refused: ObjectID accepts any string.
   */
  public static readIds(raw: unknown): Array<ObjectID> {
    if (!Array.isArray(raw)) {
      throw new BadDataException("telemetryExceptionIds must be a list");
    }

    if (raw.length > MAX_EXCEPTION_LIST_STATS_IDS) {
      throw new BadDataException(
        `Ask about at most ${MAX_EXCEPTION_LIST_STATS_IDS} exceptions at once`,
      );
    }

    const seen: Set<string> = new Set<string>();
    const ids: Array<ObjectID> = [];

    for (const value of raw) {
      if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
        throw new BadDataException("Invalid Telemetry Exception ID");
      }

      if (!seen.has(value.toLowerCase())) {
        seen.add(value.toLowerCase());
        ids.push(new ObjectID(value));
      }
    }

    return ids;
  }

  public static async read(data: {
    telemetryExceptionIds: Array<ObjectID>;
    startTime: Date;
    endTime: Date;
    props: DatabaseCommonInteractionProps;
  }): Promise<ExceptionListStats> {
    ExceptionListStatsReader.checkRange(data.startTime, data.endTime);

    if (!data.props.tenantId) {
      throw new BadDataException("Project ID is required");
    }

    const bucketSizeInSeconds: number = getExceptionTrendBucketSizeInSeconds(
      data.startTime,
      data.endTime,
    );

    const answer: ExceptionListStats = {
      items: [],
      bucketSizeInSeconds,
      startTime: data.startTime.toISOString(),
      endTime: data.endTime.toISOString(),
    };

    const requestedIds: Array<ObjectID> = data.telemetryExceptionIds.slice(
      0,
      MAX_EXCEPTION_LIST_STATS_IDS,
    );

    if (requestedIds.length === 0) {
      return answer;
    }

    // As the caller: an exception they may not read is not answered for.
    const exceptions: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: {
          projectId: data.props.tenantId,
          _id: QueryHelper.any(requestedIds),
        } as never,
        select: {
          _id: true,
          fingerprint: true,
          primaryEntityId: true,
        },
        limit: requestedIds.length,
        skip: 0,
        props: data.props,
      });

    const exceptionById: Map<string, TelemetryException> = new Map();
    // Each fingerprint read, and the exception it counts for.
    const groupByFingerprint: Map<string, string> = new Map();
    const entityIds: Array<string> = [];

    for (const exception of exceptions) {
      const id: string = exception.id?.toString().toLowerCase() || "";
      const fingerprint: string = exception.fingerprint || "";

      if (!id || !fingerprint) {
        continue;
      }

      exceptionById.set(id, exception);
      if (!groupByFingerprint.has(fingerprint)) {
        groupByFingerprint.set(fingerprint, id);
      }

      const entityId: string = exception.primaryEntityId?.toString() || "";
      if (entityId && !entityIds.includes(entityId)) {
        entityIds.push(entityId);
      }
    }

    if (exceptionById.size === 0) {
      return answer;
    }

    /*
     * The exceptions merged into these (TelemetryExceptionMerge): their
     * occurrences keep their own fingerprint and count here, so their
     * fingerprints are read for the exception they were merged into. As
     * the caller, as the exceptions themselves were.
     */
    const members: Array<TelemetryException> =
      await TelemetryExceptionService.findBy({
        query: {
          projectId: data.props.tenantId,
          mergedIntoTelemetryExceptionId: QueryHelper.any(
            Array.from(exceptionById.keys()),
          ),
        } as never,
        select: {
          fingerprint: true,
          mergedIntoTelemetryExceptionId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: data.props,
      });

    for (const member of members) {
      const survivorId: string =
        member.mergedIntoTelemetryExceptionId?.toString().toLowerCase() || "";
      const fingerprint: string = member.fingerprint || "";

      if (
        !fingerprint ||
        !exceptionById.has(survivorId) ||
        groupByFingerprint.has(fingerprint)
      ) {
        continue;
      }

      groupByFingerprint.set(fingerprint, survivorId);
    }

    // Their occurrences, within the caller's telemetry read scope.
    const serviceFilter: TelemetryServiceFilter =
      await TelemetryReadAccess.getServiceFilter({
        modelType: ExceptionInstance,
        props: data.props,
        requested: entityIds.length > 0 ? entityIds : undefined,
      });

    const query: ExceptionListStatsQuery = {
      projectId: data.props.tenantId,
      fingerprints: Array.from(groupByFingerprint.keys()),
      groupIds: Array.from(groupByFingerprint.values()),
      startTime: data.startTime,
      endTime: data.endTime,
      bucketSizeInSeconds,
      serviceFilter,
    };

    const [trendRows, userRows] = await Promise.all([
      ExceptionListStatsReader.readRows(
        ExceptionListStatsReader.buildTrendStatement(query),
      ),
      /*
       * Best effort: the trends still show when users cannot be counted
       * (an install whose table has not gained the userId column yet).
       */
      ExceptionListStatsReader.readRows(
        ExceptionListStatsReader.buildAffectedUsersStatement(query),
      ).catch((error: unknown): null => {
        logger.warn(
          `Could not count the affected users of the exceptions list: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      }),
    ]);

    const trendById: Map<string, Array<number>> = new Map();
    for (const row of ExceptionListStatsReader.toTrendRows(trendRows)) {
      const bucket: number | null = clampExceptionTrendBucket(row.bucket);

      if (bucket === null || !exceptionById.has(row.groupId)) {
        continue;
      }

      const trend: Array<number> =
        trendById.get(row.groupId) || emptyExceptionTrend();
      trend[bucket] = (trend[bucket] || 0) + row.count;
      trendById.set(row.groupId, trend);
    }

    const usersById: Map<string, number> = new Map();
    if (userRows) {
      for (const row of ExceptionListStatsReader.toAffectedUsersRows(
        userRows,
      )) {
        if (exceptionById.has(row.groupId)) {
          usersById.set(row.groupId, row.users);
        }
      }
    }

    // In the order asked, each exception the caller may read, once.
    const answered: Set<string> = new Set<string>();

    for (const requestedId of requestedIds) {
      const id: string = requestedId.toString().toLowerCase();

      if (!exceptionById.has(id) || answered.has(id)) {
        continue;
      }

      answered.add(id);

      const item: ExceptionListStatsItem = {
        telemetryExceptionId: exceptionById.get(id)!.id!.toString(),
        affectedUsers: userRows ? usersById.get(id) || 0 : null,
        trend: trendById.get(id) || emptyExceptionTrend(),
      };

      answer.items.push(item);
    }

    return answer;
  }
}
