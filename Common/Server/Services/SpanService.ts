import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Span from "../../Models/AnalyticsModels/Span";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
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
  "serviceId",
  "statusCode",
]);

export class SpanService extends AnalyticsDatabaseService<Span> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Span, database: clickhouseDatabase });
  }

  /**
   * Override the count statement to route eligible queries through the
   * proj_hist_by_minute projection. The projection is keyed on
   * (projectId, toStartOfMinute(startTime), serviceId, statusCode, isRootSpan)
   * so its WHERE clause must reference the projection's exact expressions —
   * filtering on raw `startTime` won't trigger projection use.
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

    // Projection only helps when both projectId and a time range are bound —
    // these are the partition pruning / primary key conditions the optimizer
    // needs to see in projection-form.
    if (!projectId || !(startTimeFilter instanceof InBetween)) {
      return null;
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string = this.database.getDatasourceOptions().database!;

    const startValue: unknown = startTimeFilter.startValue;
    const endValue: unknown = startTimeFilter.endValue;
    if (!(startValue instanceof Date) || !(endValue instanceof Date)) {
      return null;
    }

    const statement: Statement = SQL`SELECT count() AS count FROM ${databaseName}.${this.model.tableName} WHERE projectId = ${{
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

    const serviceIdValue: unknown = query["serviceId"];
    if (serviceIdValue instanceof ObjectID) {
      statement.append(
        SQL` AND serviceId = ${{
          type: TableColumnType.ObjectID,
          value: serviceIdValue,
        }}`,
      );
    } else if (serviceIdValue instanceof Includes) {
      statement.append(
        SQL` AND serviceId IN (${{
          type: TableColumnType.ObjectID,
          value: serviceIdValue,
        }})`,
      );
    } else if (serviceIdValue !== undefined) {
      // Unrecognized serviceId form — let the generic path handle it.
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
      " SETTINGS optimize_use_projections = 1, max_execution_time = 45, timeout_overflow_mode = 'break'",
    );

    return statement;
  }
}

export default new SpanService();
