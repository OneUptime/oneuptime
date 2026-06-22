import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Span from "../../Models/AnalyticsModels/Span";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import AggregateBy, {
  AggregateUtil,
} from "../Types/AnalyticsDatabase/AggregateBy";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import InBetween from "../../Types/BaseDatabase/InBetween";
import Includes from "../../Types/BaseDatabase/Includes";
import ObjectID from "../../Types/ObjectID";

/**
 * Columns the proj_hist_by_minute projection can answer with. If a count
 * query touches only these columns, we can route it through the projection
 * for a 100x+ speedup over scanning the raw 1.8B-row span table. Any other
 * column (kind, name, traceId, attributes, …) forces a fallback to the
 * generic table scan because the projection doesn't store those values.
 */
const PROJECTION_ELIGIBLE_KEYS: Set<string> = new Set([
  "projectId",
  "startTime",
  "isRootSpan",
  "primaryEntityId",
  "statusCode",
]);

export class SpanService extends AnalyticsDatabaseService<Span> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Span, database: clickhouseDatabase });
  }

  /**
   * Normalize a JSON-deserialized date value to a Date instance. When a query
   * crosses the API boundary, InBetween's startValue/endValue come back as ISO
   * strings (or numeric epoch ms) rather than Date objects. Returns null if
   * the value is unusable.
   */
  private static coerceToDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "string" || typeof value === "number") {
      const parsed: Date = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  /**
   * Override the count statement to route eligible queries through the
   * proj_hist_by_minute projection. The projection is keyed on
   * (projectId, toStartOfMinute(startTime), primaryEntityId, statusCode,
   * isRootSpan) so its WHERE clause must reference the projection's exact
   * expressions — filtering on raw `startTime` won't trigger projection use.
   *
   * Trade-off: time bounds get rounded to the minute, so the count can be
   * inflated by spans that started in the same minute as the boundary. For
   * pagination this is acceptable.
   */
  public override toCountStatement(countBy: CountBy<Span>): Statement {
    const projectionStatement: Statement | null =
      this.tryBuildProjectionCountStatement(countBy);
    if (projectionStatement) {
      return projectionStatement;
    }
    return super.toCountStatement(countBy);
  }

  private tryBuildProjectionCountStatement(
    countBy: CountBy<Span>,
  ): Statement | null {
    if (countBy.groupBy && Object.keys(countBy.groupBy).length > 0) {
      // GROUP BY count needs the raw table; projection can't help.
      return null;
    }

    const query: Record<string, unknown> = (countBy.query ||
      {}) as unknown as Record<string, unknown>;

    // Bail out if the query references any column the projection doesn't store.
    for (const key of Object.keys(query)) {
      if (!PROJECTION_ELIGIBLE_KEYS.has(key)) {
        return null;
      }
    }

    const projectId: ObjectID | undefined = query["projectId"] as
      | ObjectID
      | undefined;
    const startTimeFilter: unknown = query["startTime"];

    /*
     * Projection only helps when both projectId and a time range are bound —
     * these are the partition pruning / primary key conditions the optimizer
     * needs to see in projection-form.
     */
    if (!projectId || !(startTimeFilter instanceof InBetween)) {
      return null;
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string = this.database.getDatasourceOptions().database!;

    const startValue: Date | null = SpanService.coerceToDate(
      startTimeFilter.startValue,
    );
    const endValue: Date | null = SpanService.coerceToDate(
      startTimeFilter.endValue,
    );
    if (!startValue || !endValue) {
      return null;
    }

    const statement: Statement = SQL`SELECT count() AS count FROM ${databaseName}.${this.model.getReadTableName()} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: projectId,
    }} AND toStartOfMinute(startTime) >= toStartOfMinute(${{
      type: TableColumnType.Date,
      value: startValue,
    }}) AND toStartOfMinute(startTime) <= toStartOfMinute(${{
      type: TableColumnType.Date,
      value: endValue,
    }})`;

    if (query["isRootSpan"] !== undefined) {
      statement.append(
        SQL` AND isRootSpan = ${{
          type: TableColumnType.Boolean,
          value: Boolean(query["isRootSpan"]),
        }}`,
      );
    }

    const primaryEntityIdValue: unknown = query["primaryEntityId"];
    if (primaryEntityIdValue instanceof ObjectID) {
      statement.append(
        SQL` AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: primaryEntityIdValue,
        }}`,
      );
    } else if (primaryEntityIdValue instanceof Includes) {
      statement.append(
        SQL` AND primaryEntityId IN (${{
          type: TableColumnType.ObjectID,
          value: primaryEntityIdValue,
        }})`,
      );
    } else if (primaryEntityIdValue !== undefined) {
      // Unrecognized primaryEntityId form — let the generic path handle it.
      return null;
    }

    const statusCodeValue: unknown = query["statusCode"];
    if (typeof statusCodeValue === "number") {
      statement.append(
        SQL` AND statusCode = ${{
          type: TableColumnType.Number,
          value: statusCodeValue,
        }}`,
      );
    } else if (statusCodeValue instanceof Includes) {
      statement.append(
        SQL` AND statusCode IN (${{
          type: TableColumnType.Number,
          value: statusCodeValue,
        }})`,
      );
    } else if (statusCodeValue !== undefined) {
      return null;
    }

    /*
     * optimize_use_projections is on by default in modern ClickHouse but we
     * set it explicitly to make the intent obvious. The 45s cap is defense
     * in depth — projection scans should complete in <1s.
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    return statement;
  }

  /**
   * Route eligible duration aggregations through the proj_agg_by_service
   * projection (projectId, primaryEntityId, toStartOfMinute(startTime) ->
   * count() / avg(durationUnixNano) / quantile(0.99)(durationUnixNano)).
   * The projection stores aggregate-function STATES, so re-grouping its
   * minute rows into coarser buckets merges those states — results are
   * identical to scanning the raw table, at a fraction of the read
   * (verified on dev with EXPLAIN indexes=1: ReadFromMergeTree
   * (proj_agg_by_service), 9/2136 granules for a full-day window).
   *
   * Count queries may additionally filter on statusCode / isRootSpan: the
   * optimizer then serves them from proj_hist_by_minute, whose key is
   * (projectId, minute, primaryEntityId, statusCode, isRootSpan). This is
   * the error-rate series on the Service / RUM / Serverless overview
   * pages. Those filters stay rejected for Avg/P99 — proj_agg_by_service
   * cannot evaluate them, and quantile states for different levels do not
   * merge.
   *
   * Two things are load-bearing for the optimizer to pick the projection:
   *   1. The time predicates AND the bucket expression must be written
   *      over toStartOfMinute(startTime) — the projection's key
   *      expression — never raw startTime.
   *   2. The aggregate must byte-match a stored expression: count() (NOT
   *      count(durationUnixNano) — equivalent here since the column is
   *      non-nullable), avg(durationUnixNano) or
   *      quantile(0.99)(durationUnixNano).
   *
   * Trade-off (same as the count override): window edges round to the
   * minute, so the boundary buckets may include spans from the partial
   * boundary minute.
   */
  public override toAggregateStatement(aggregateBy: AggregateBy<Span>): {
    statement: Statement;
    columns: Array<string>;
  } {
    const projectionStatement: {
      statement: Statement;
      columns: Array<string>;
    } | null = this.tryBuildProjectionAggregateStatement(aggregateBy);
    if (projectionStatement) {
      return projectionStatement;
    }
    return super.toAggregateStatement(aggregateBy);
  }

  private tryBuildProjectionAggregateStatement(
    aggregateBy: AggregateBy<Span>,
  ): { statement: Statement; columns: Array<string> } | null {
    if (aggregateBy.aggregateColumnName?.toString() !== "durationUnixNano") {
      return null;
    }

    /*
     * Only the aggregates whose states the projection stores. P95 etc.
     * must fall back: the projection has no quantile(0.95) state and
     * quantile states for different levels do not merge into each other.
     */
    const aggregateExpressionByType: Partial<Record<AggregationType, string>> =
      {
        [AggregationType.Count]: "count()",
        [AggregationType.Avg]: "avg(durationUnixNano)",
        [AggregationType.P99]: "quantile(0.99)(durationUnixNano)",
      };
    const aggregateExpression: string | undefined =
      aggregateExpressionByType[aggregateBy.aggregationType];
    if (!aggregateExpression) {
      return null;
    }

    if (
      aggregateBy.aggregationTimestampColumnName?.toString() !== "startTime"
    ) {
      return null;
    }

    if (aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0) {
      // Extra GROUP BY dimensions aren't all projection columns; fall back.
      return null;
    }

    if (!aggregateBy.startTimestamp || !aggregateBy.endTimestamp) {
      // Needed to derive the bucket interval (mirrors the generic path).
      return null;
    }

    const query: Record<string, unknown> = (aggregateBy.query ||
      {}) as unknown as Record<string, unknown>;

    /*
     * Filters the projections can evaluate. Avg/P99 are served by
     * proj_agg_by_service, which is keyed only on (projectId,
     * primaryEntityId, minute) — a statusCode/isRootSpan filter must bail.
     * Count is also served by proj_hist_by_minute, whose key includes
     * statusCode and isRootSpan, so those filters stay projection-servable
     * for Count (this is the error-rate series on the overview pages).
     */
    const eligibleKeys: Array<string> = [
      "projectId",
      "startTime",
      "primaryEntityId",
    ];
    if (aggregateBy.aggregationType === AggregationType.Count) {
      eligibleKeys.push("statusCode", "isRootSpan");
    }

    // Bail out on any filter the projections cannot evaluate.
    for (const key of Object.keys(query)) {
      if (!eligibleKeys.includes(key)) {
        return null;
      }
    }

    const projectId: ObjectID | undefined = query["projectId"] as
      | ObjectID
      | undefined;
    const startTimeFilter: unknown = query["startTime"];

    if (!projectId || !(startTimeFilter instanceof InBetween)) {
      return null;
    }

    const startValue: Date | null = SpanService.coerceToDate(
      startTimeFilter.startValue,
    );
    const endValue: Date | null = SpanService.coerceToDate(
      startTimeFilter.endValue,
    );
    if (!startValue || !endValue) {
      return null;
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string = this.database.getDatasourceOptions().database!;

    const aggregationInterval: string = AggregateUtil.getAggregationInterval({
      startDate: aggregateBy.startTimestamp,
      endDate: aggregateBy.endTimestamp,
    }).toLowerCase();

    /*
     * Bucket expression derived from the projection key: for the minute
     * interval date_trunc is a no-op, for coarser intervals truncating
     * the minute equals truncating the raw timestamp. Aliased to the
     * timestamp column name so the generic result parsing applies.
     */
    const statement: Statement = new Statement();
    statement.append(
      `SELECT ${aggregateExpression} as durationUnixNano, date_trunc('${aggregationInterval}', toStartOfMinute(startTime)) as startTime`,
    );
    statement.append(
      SQL` FROM ${databaseName}.${this.model.getReadTableName()} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: projectId,
      }} AND toStartOfMinute(startTime) >= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: startValue,
      }}) AND toStartOfMinute(startTime) <= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: endValue,
      }})`,
    );

    const primaryEntityIdValue: unknown = query["primaryEntityId"];
    if (primaryEntityIdValue instanceof ObjectID) {
      statement.append(
        SQL` AND primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: primaryEntityIdValue,
        }}`,
      );
    } else if (primaryEntityIdValue instanceof Includes) {
      statement.append(
        SQL` AND primaryEntityId IN (${{
          type: TableColumnType.ObjectID,
          value: primaryEntityIdValue,
        }})`,
      );
    } else if (primaryEntityIdValue !== undefined) {
      return null;
    }

    /*
     * Only reachable for Count (the whitelist above rejects these keys for
     * Avg/P99). Predicate translation mirrors
     * tryBuildProjectionCountStatement: scalar = equality, Includes = IN,
     * anything else = bail to the generic path.
     */
    if (query["isRootSpan"] !== undefined) {
      statement.append(
        SQL` AND isRootSpan = ${{
          type: TableColumnType.Boolean,
          value: Boolean(query["isRootSpan"]),
        }}`,
      );
    }

    const statusCodeValue: unknown = query["statusCode"];
    if (typeof statusCodeValue === "number") {
      statement.append(
        SQL` AND statusCode = ${{
          type: TableColumnType.Number,
          value: statusCodeValue,
        }}`,
      );
    } else if (statusCodeValue instanceof Includes) {
      statement.append(
        SQL` AND statusCode IN (${{
          type: TableColumnType.Number,
          value: statusCodeValue,
        }})`,
      );
    } else if (statusCodeValue !== undefined) {
      return null;
    }

    statement.append(" GROUP BY startTime");

    const sortOrder: SortOrder | undefined = aggregateBy.sort
      ? (Object.values(aggregateBy.sort)[0] as SortOrder | undefined)
      : undefined;
    statement.append(
      ` ORDER BY startTime ${sortOrder === SortOrder.Ascending ? "ASC" : "DESC"}`,
    );

    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: Number(aggregateBy.limit) || 10,
      }} OFFSET ${{
        type: TableColumnType.Number,
        value: Number(aggregateBy.skip) || 0,
      }}`,
    );

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "break",
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    return {
      statement,
      columns: ["durationUnixNano", "startTime"],
    };
  }
}

export default new SpanService();
