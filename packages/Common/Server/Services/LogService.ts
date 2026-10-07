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
 * count() is a UInt64, which ClickHouse sends as a JSON string or a JSON
 * number depending on output_format_json_quote_64bit_integers (see
 * AnalyticsDatabaseService.countBy). Accept both.
 */
function toCount(value: unknown): number {
  const parsed: number =
    typeof value === "number" || typeof value === "string" ? Number(value) : 0;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export class LogService extends AnalyticsDatabaseService<Log> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Log, database: clickhouseDatabase });
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
}

export default new LogService();
