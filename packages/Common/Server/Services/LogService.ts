import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, { Results } from "./AnalyticsDatabaseService";
import Log from "../../Models/AnalyticsModels/Log";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import FindBy from "../Types/AnalyticsDatabase/FindBy";
import { OnFind } from "../Types/AnalyticsDatabase/Hooks";
import ModelPermission, {
  CheckReadPermissionType,
} from "../Types/AnalyticsDatabase/ModelPermission";
import Query from "../Types/AnalyticsDatabase/Query";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import ResourceEntityFilter from "../Utils/Telemetry/ResourceEntityFilter";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { ResponseJSON } from "@clickhouse/client";
import ObjectID from "../../Types/ObjectID";
import { SECURITY_LOG_PREFILTER } from "../../Utils/SecurityEvent/LogParsers/SecurityLogParser";

/*
 * Group values longer than this are cut, in the query itself so that two
 * values that only differ past the cut still form one group. A value
 * becomes an alert's label and can be placed in its title, which has a
 * fixed length; a log line can carry anything.
 */
export const MAX_LOG_GROUP_VALUE_LENGTH: number = 256;

// One combination of group-by attribute values and how many logs carry it.
export interface LogAttributeGroupCount {
  // One value per group-by attribute, in the order they were asked for.
  values: Array<string>;
  count: number;
}

export interface LogAttributeGroupCountResult {
  // The groups with the most logs first, at most `limit` of them.
  groups: Array<LogAttributeGroupCount>;
  // Logs matched across every group - not just the groups returned.
  totalCount: number;
  // Distinct groups matched, before `limit` cut them.
  totalGroupCount: number;
}

/*
 * What a Logs monitor whose groups are resolved by a log is judged on.
 *
 * `groups` are the ones still open: they matched the monitor's filters in
 * the window, and no resolving log has arrived for them since. A group
 * that matched and was then resolved is not in it, however many of its
 * logs are still in the window.
 */
export interface LogUnresolvedAttributeGroupResult {
  // Open groups, the ones with the most matching logs first, at most `limit`.
  groups: Array<LogAttributeGroupCount>;
  /*
   * The values of every group a resolving log has arrived for after its
   * last matching log - or that only resolving logs were seen for - at
   * most `resolvedLimit` of them.
   */
  resolvedGroups: Array<Array<string>>;
  // Matching logs across every open group - not just the groups returned.
  totalCount: number;
  // Open groups, before `limit` cut them.
  totalGroupCount: number;
}

/*
 * count() is a UInt64, which ClickHouse sends as a JSON string or a JSON
 * number depending on output_format_json_quote_64bit_integers (see
 * AnalyticsDatabaseService.countBy). Accept both.
 */
function toCount(value: unknown): number {
  const parsed: number =
    typeof value === "number" || typeof value === "string" ? Number(value) : 0;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/*
 * One page of a project's logs that arrived in a window and hold a security
 * record's words (SECURITY_LOG_PREFILTER): what the log scan of "Your
 * logs" reads.
 */
export interface FindSecurityLogCandidatesData {
  projectId: ObjectID;
  // Exclusive.
  arrivedAfter: Date;
  // Inclusive.
  arrivedUntil: Date;
  /*
   * Logs written before this are left out: the table is sorted by when a
   * log was written, so this keeps the read to its recent parts.
   */
  happenedAfter: Date;
  limit: number;
  offset: number;
}

// The most of a log's body the scan reads: a security record is never longer.
export const SECURITY_LOG_SCAN_MAX_BODY_LENGTH: number = 256 * 1024;

export class LogService extends AnalyticsDatabaseService<Log> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Log, database: clickhouseDatabase });
  }

  /*
   * The prefilter as a ClickHouse condition on the body, every word bound as
   * a parameter: a line holds one of `anyOf`, or matches one of the groups.
   */
  public static buildSecurityLogPrefilter(): Statement {
    const statement: Statement = SQL`(multiSearchAnyCaseInsensitive(body, ${{
      type: TableColumnType.ArrayText,
      value: [...SECURITY_LOG_PREFILTER.anyOf],
    }})`;

    for (const group of SECURITY_LOG_PREFILTER.groups) {
      statement.append(
        SQL` OR (positionCaseInsensitive(body, ${{
          type: TableColumnType.Text,
          value: group.requires,
        }}) > 0 AND multiSearchAnyCaseInsensitive(body, ${{
          type: TableColumnType.ArrayText,
          value: [...group.anyOf],
        }})`,
      );

      if (group.noneOf && group.noneOf.length > 0) {
        statement.append(
          SQL` AND (NOT multiSearchAnyCaseInsensitive(body, ${{
            type: TableColumnType.ArrayText,
            value: [...group.noneOf],
          }})`,
        );

        if (group.unlessAnyOf && group.unlessAnyOf.length > 0) {
          statement.append(
            SQL` OR multiSearchAnyCaseInsensitive(body, ${{
              type: TableColumnType.ArrayText,
              value: [...group.unlessAnyOf],
            }})`,
          );
        }

        statement.append(")");
      }

      statement.append(")");
    }

    statement.append(")");

    return statement;
  }

  /*
   * A page of one project's logs that arrived in a window and may hold a
   * security record. Only the candidate lines leave the database, and only
   * the first SECURITY_LOG_SCAN_MAX_BODY_LENGTH characters of each. Always
   * one project's: the project is the first condition.
   */
  @CaptureSpan()
  public async findSecurityLogCandidates(
    data: FindSecurityLogCandidatesData,
  ): Promise<Array<JSONObject>> {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string =
      this.database!.getDatasourceOptions().database!;

    const statement: Statement = SQL`SELECT _id, time, createdAt, primaryEntityId, primaryEntityType, traceId, spanId, sessionId, attributes, substring(body, 1, ${{
      type: TableColumnType.Number,
      value: SECURITY_LOG_SCAN_MAX_BODY_LENGTH,
    }}) AS body FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND time >= ${{
        type: TableColumnType.DateTime64,
        value: data.happenedAfter,
      }} AND createdAt > ${{
        type: TableColumnType.Date,
        value: data.arrivedAfter,
      }} AND createdAt <= ${{
        type: TableColumnType.Date,
        value: data.arrivedUntil,
      }} AND `,
    );
    statement.append(LogService.buildSecurityLogPrefilter());
    statement.append(
      SQL` ORDER BY createdAt ASC, _id ASC LIMIT ${{
        type: TableColumnType.Number,
        value: Math.max(1, Math.trunc(data.limit)),
      }} OFFSET ${{
        type: TableColumnType.Number,
        value: Math.max(0, Math.trunc(data.offset)),
      }}`,
    );
    statement.append(getQuerySettings({ maxExecutionTimeInSeconds: 60 }));

    const result: Results = await this.executeQuery(statement);
    const response: ResponseJSON<JSONObject> = await result.json<JSONObject>();

    return (response.data || []) as Array<JSONObject>;
  }

  /*
   * Resolve the logs explorer's resource-facet selections (a Kubernetes
   * cluster, a host, ...) before the query is compiled. They arrive as
   * Postgres ids under `resourceFilters`; matching them needs the
   * resource's entity key, which only Postgres can supply. See
   * ResourceEntityFilter.
   */
  protected override async onBeforeFind(
    findBy: FindBy<Log>,
  ): Promise<OnFind<Log>> {
    await ResourceEntityFilter.rewriteAnalyticsQuery({
      query: findBy.query as unknown as Record<string, unknown>,
      projectId: findBy.props?.tenantId,
    });

    return { findBy, carryForward: null };
  }

  // The same rewrite, so the explorer's total counts the rows its list shows.
  protected override async onBeforeCount(
    countBy: CountBy<Log>,
  ): Promise<CountBy<Log>> {
    await ResourceEntityFilter.rewriteAnalyticsQuery({
      query: countBy.query as unknown as Record<string, unknown>,
      projectId: countBy.props?.tenantId,
    });

    return countBy;
  }

  /*
   * Count the logs a query matches once per distinct combination of the
   * given attributes' values - a grouped Logs monitor's evaluation, one
   * count per IPsec tunnel rather than one for the whole monitor.
   *
   * The filter is the very one countBy compiles for the ungrouped monitor,
   * so the groups add up to what that count would have been. A log that
   * does not carry an attribute is counted under "" for it - a Map lookup
   * of a missing key is the empty string - the same way a metric series
   * missing a label is grouped.
   */
  @CaptureSpan()
  public async countByAttributeGroups(input: {
    query: Query<Log>;
    groupByAttributes: Array<string>;
    limit: number;
    props: DatabaseCommonInteractionProps;
  }): Promise<LogAttributeGroupCountResult> {
    const countBy: CountBy<Log> = await this.onBeforeCount({
      query: input.query,
      props: input.props,
      skip: 0,
      limit: input.limit,
    });

    const permission: CheckReadPermissionType<Log> =
      await ModelPermission.checkReadPermission(
        this.modelType,
        countBy.query,
        null,
        input.props,
      );

    const statement: Statement = this.toAttributeGroupCountStatement({
      query: permission.query,
      groupByAttributes: input.groupByAttributes,
      limit: input.limit,
    });

    const dbResult: Results = await this.executeQuery(statement);
    const response: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();

    return LogService.toAttributeGroupCountResult({
      rows: response.data || [],
      groupByAttributes: input.groupByAttributes,
    });
  }

  /*
   * The grouped count as one statement:
   *
   *   SELECT count() AS groupCount,
   *          sum(count()) OVER () AS totalCount,
   *          count() OVER () AS totalGroupCount,
   *          substringUTF8(attributes[{key}], 1, 256) AS __group_0, ...
   *   FROM <db>.Log WHERE <the monitor's filter>
   *   GROUP BY __group_0, ... ORDER BY groupCount DESC, __group_0, ...
   *   LIMIT {limit}
   *
   * The window functions run over the grouped rows before LIMIT, so the
   * total and the number of groups cover every group, not just the ones
   * kept - one scan instead of a second counting query.
   *
   * Attribute keys come from the person configuring the monitor and are
   * bound as query parameters, never spliced into the SQL; the aliases
   * are built from the key's position, not its text.
   */
  public toAttributeGroupCountStatement(input: {
    query: Query<Log>;
    groupByAttributes: Array<string>;
    limit: number;
  }): Statement {
    if (input.groupByAttributes.length === 0) {
      throw new BadDataException(
        "At least one attribute is needed to group logs by.",
      );
    }

    const limit: number = Math.floor(Number(input.limit));

    if (!Number.isFinite(limit) || limit < 1) {
      throw new BadDataException("The group limit must be a positive number.");
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const aliases: Array<string> = input.groupByAttributes.map(
      (_key: string, index: number) => {
        return `__group_${index}`;
      },
    );

    const statement: Statement = SQL`SELECT count() AS groupCount, sum(count()) OVER () AS totalCount, count() OVER () AS totalGroupCount`;

    input.groupByAttributes.forEach((key: string, index: number) => {
      statement.append(
        SQL`, substringUTF8(attributes[${{
          value: key,
          type: TableColumnType.Text,
        }}], 1, `,
      );
      statement.append(`${MAX_LOG_GROUP_VALUE_LENGTH}) AS ${aliases[index]}`);
    });

    statement
      .append(SQL` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `)
      .append(this.statementGenerator.toWhereStatement(input.query))
      .append(this.getRetentionReadFilter());

    statement.append(` GROUP BY ${aliases.join(", ")}`);

    // Busiest first; the values break ties so the cut is stable.
    statement.append(
      ` ORDER BY groupCount DESC, ${aliases
        .map((alias: string) => {
          return `${alias} ASC`;
        })
        .join(", ")}`,
    );

    statement.append(
      SQL` LIMIT ${{
        value: limit,
        type: TableColumnType.Number,
      }}`,
    );

    /*
     * 'throw', not the 'break' countBy uses. A partial count is a fine
     * lower bound for one threshold, but a partial set of groups would
     * read as "this tunnel stopped logging" and resolve its alert. A
     * timeout fails the evaluation instead, and the next one retries.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  public static toAttributeGroupCountResult(input: {
    rows: Array<JSONObject>;
    groupByAttributes: Array<string>;
  }): LogAttributeGroupCountResult {
    const groups: Array<LogAttributeGroupCount> = input.rows.map(
      (row: JSONObject): LogAttributeGroupCount => {
        return {
          values: input.groupByAttributes.map(
            (_key: string, index: number): string => {
              const value: unknown = row[`__group_${index}`];

              return value === undefined || value === null ? "" : String(value);
            },
          ),
          count: toCount(row["groupCount"]),
        };
      },
    );

    const firstRow: JSONObject | undefined = input.rows[0];

    return {
      groups: groups,
      totalCount: firstRow ? toCount(firstRow["totalCount"]) : 0,
      totalGroupCount: firstRow ? toCount(firstRow["totalGroupCount"]) : 0,
    };
  }

  /*
   * The grouped count of a monitor whose groups are resolved by a log:
   * which groups are open, and which a resolving log has closed.
   *
   * `query` is the monitor's own filter; `resolvedByQuery` matches the logs
   * that resolve a group (see MonitorStepLogMonitorUtil.toResolvedByQuery).
   * Both are read in one statement, so the two sides are one snapshot: a
   * group can never be counted open by one query and resolved by another
   * that ran a moment later.
   */
  @CaptureSpan()
  public async countUnresolvedAttributeGroups(input: {
    query: Query<Log>;
    resolvedByQuery: Query<Log>;
    groupByAttributes: Array<string>;
    limit: number;
    resolvedLimit: number;
    props: DatabaseCommonInteractionProps;
  }): Promise<LogUnresolvedAttributeGroupResult> {
    const queries: Array<Query<Log>> = [];

    for (const query of [input.query, input.resolvedByQuery]) {
      const countBy: CountBy<Log> = await this.onBeforeCount({
        query: query,
        props: input.props,
        skip: 0,
        limit: input.limit,
      });

      const permission: CheckReadPermissionType<Log> =
        await ModelPermission.checkReadPermission(
          this.modelType,
          countBy.query,
          null,
          input.props,
        );

      queries.push(permission.query);
    }

    const statement: Statement = this.toUnresolvedAttributeGroupStatement({
      query: queries[0]!,
      resolvedByQuery: queries[1]!,
      groupByAttributes: input.groupByAttributes,
      limit: input.limit,
      resolvedLimit: input.resolvedLimit,
    });

    const dbResult: Results = await this.executeQuery(statement);
    const response: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();

    return LogService.toUnresolvedAttributeGroupResult({
      rows: response.data || [],
      groupByAttributes: input.groupByAttributes,
      limit: input.limit,
    });
  }

  /*
   * Open and resolved groups as one statement:
   *
   *   SELECT countIf(__isProblem = 1) AS groupCount,
   *          maxIf(time, __isProblem = 0) > maxIf(time, __isProblem = 1)
   *            AS isResolved,
   *          sum(groupCount) OVER (PARTITION BY isResolved) AS totalCount,
   *          count() OVER (PARTITION BY isResolved) AS totalGroupCount,
   *          __group_0, ...
   *   FROM (
   *     SELECT time, 1 AS __isProblem,
   *            substringUTF8(attributes[{key}], 1, 256) AS __group_0, ...
   *     FROM <db>.Log WHERE <the monitor's filter>
   *     UNION ALL
   *     SELECT time, 0 AS __isProblem, ...
   *     FROM <db>.Log WHERE <the resolving logs' filter>
   *   )
   *   GROUP BY __group_0, ...
   *   ORDER BY isResolved ASC, groupCount DESC, __group_0, ...
   *   LIMIT {rows} BY isResolved
   *
   * A group is resolved when its newest resolving log is newer than its
   * newest matching log. maxIf over no rows is the epoch, so a group with
   * only resolving logs is resolved and one with none is open. Two logs
   * at the very same instant leave the group open: the order they
   * happened in is not known, and an alert left open is seen, while one
   * closed by mistake is not.
   *
   * LIMIT BY keeps the first rows of each side, so a burst of groups on
   * one side can never crowd out the other. The window functions run
   * before it and cover every group of their side.
   *
   * As in the plain grouped count, attribute keys are bound as query
   * parameters and the aliases come from the key's position.
   */
  public toUnresolvedAttributeGroupStatement(input: {
    query: Query<Log>;
    resolvedByQuery: Query<Log>;
    groupByAttributes: Array<string>;
    limit: number;
    resolvedLimit: number;
  }): Statement {
    if (input.groupByAttributes.length === 0) {
      throw new BadDataException(
        "At least one attribute is needed to group logs by.",
      );
    }

    const limit: number = Math.floor(Number(input.limit));
    const resolvedLimit: number = Math.floor(Number(input.resolvedLimit));

    if (
      !Number.isFinite(limit) ||
      limit < 1 ||
      !Number.isFinite(resolvedLimit) ||
      resolvedLimit < 1
    ) {
      throw new BadDataException("The group limit must be a positive number.");
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const aliases: Array<string> = input.groupByAttributes.map(
      (_key: string, index: number) => {
        return `__group_${index}`;
      },
    );

    const statement: Statement = SQL`SELECT countIf(__isProblem = 1) AS groupCount, maxIf(time, __isProblem = 0) > maxIf(time, __isProblem = 1) AS isResolved, sum(groupCount) OVER (PARTITION BY isResolved) AS totalCount, count() OVER (PARTITION BY isResolved) AS totalGroupCount`;

    statement.append(`, ${aliases.join(", ")} FROM (`);

    const sides: Array<{ query: Query<Log>; isProblem: number }> = [
      { query: input.query, isProblem: 1 },
      { query: input.resolvedByQuery, isProblem: 0 },
    ];

    sides.forEach(
      (side: { query: Query<Log>; isProblem: number }, sideIndex: number) => {
        if (sideIndex > 0) {
          statement.append(" UNION ALL ");
        }

        statement.append(`SELECT time, ${side.isProblem} AS __isProblem`);

        input.groupByAttributes.forEach((key: string, index: number) => {
          statement.append(
            SQL`, substringUTF8(attributes[${{
              value: key,
              type: TableColumnType.Text,
            }}], 1, `,
          );
          statement.append(
            `${MAX_LOG_GROUP_VALUE_LENGTH}) AS ${aliases[index]}`,
          );
        });

        statement
          .append(
            SQL` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `,
          )
          .append(this.statementGenerator.toWhereStatement(side.query))
          .append(this.getRetentionReadFilter());
      },
    );

    statement.append(`) GROUP BY ${aliases.join(", ")}`);

    // Open groups first, the busiest of them first; values break ties.
    statement.append(
      ` ORDER BY isResolved ASC, groupCount DESC, ${aliases
        .map((alias: string) => {
          return `${alias} ASC`;
        })
        .join(", ")}`,
    );

    statement.append(
      SQL` LIMIT ${{
        value: Math.max(limit, resolvedLimit),
        type: TableColumnType.Number,
      }} BY isResolved`,
    );

    // 'throw', for the reason the plain grouped count gives.
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  public static toUnresolvedAttributeGroupResult(input: {
    rows: Array<JSONObject>;
    groupByAttributes: Array<string>;
    limit: number;
  }): LogUnresolvedAttributeGroupResult {
    const valuesOf: (row: JSONObject) => Array<string> = (
      row: JSONObject,
    ): Array<string> => {
      return input.groupByAttributes.map(
        (_key: string, index: number): string => {
          const value: unknown = row[`__group_${index}`];

          return value === undefined || value === null ? "" : String(value);
        },
      );
    };

    const groups: Array<LogAttributeGroupCount> = [];
    const resolvedGroups: Array<Array<string>> = [];
    let totalCount: number = 0;
    let totalGroupCount: number = 0;

    for (const row of input.rows) {
      // A UInt8: 1, "1" or true, depending on the client's settings.
      const isResolved: boolean =
        row["isResolved"] === true || toCount(row["isResolved"]) > 0;

      if (isResolved) {
        resolvedGroups.push(valuesOf(row));
        continue;
      }

      const count: number = toCount(row["groupCount"]);

      // The totals of the open side are on each of its rows.
      totalCount = toCount(row["totalCount"]);
      totalGroupCount = toCount(row["totalGroupCount"]);

      // Only resolving logs can make a row with no matching log, and that is resolved.
      if (count > 0 && groups.length < input.limit) {
        groups.push({ values: valuesOf(row), count: count });
      }
    }

    return {
      groups: groups,
      resolvedGroups: resolvedGroups,
      totalCount: totalCount,
      totalGroupCount: totalGroupCount,
    };
  }
}

export default new LogService();
