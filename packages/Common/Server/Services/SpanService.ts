import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService, { Results } from "./AnalyticsDatabaseService";
import Span from "../../Models/AnalyticsModels/Span";
import CountBy from "../Types/AnalyticsDatabase/CountBy";
import AggregateBy, {
  AggregateUtil,
} from "../Types/AnalyticsDatabase/AggregateBy";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import {
  getQuerySettings,
  INTERACTIVE_READ_TIME_LIMIT,
} from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../Types/BaseDatabase/AggregationType";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import InBetween from "../../Types/BaseDatabase/InBetween";
import Includes from "../../Types/BaseDatabase/Includes";
import ObjectID from "../../Types/ObjectID";
import FindBy from "../Types/AnalyticsDatabase/FindBy";
import { OnFind } from "../Types/AnalyticsDatabase/Hooks";
import ResourceEntityFilter from "../Utils/Telemetry/ResourceEntityFilter";
import HashedAddressSearch from "../Utils/Telemetry/HashedAddressSearch";
import { HashedAddressSignal } from "../../Types/Telemetry/HashedAddressSearch";
import TelemetryRowRetention from "../Utils/Telemetry/TelemetryRowRetention";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { JSONObject } from "../../Types/JSON";
import { ResponseJSON } from "@clickhouse/client";
import ModelPermission, {
  CheckReadPermissionType,
} from "../Types/AnalyticsDatabase/ModelPermission";
import Query from "../Types/AnalyticsDatabase/Query";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";

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

// The longest a group's value is kept, as a Logs monitor's group is.
const MAX_SPAN_GROUP_VALUE_LENGTH: number = 256;

export interface SpanAttributeGroupCount {
  // One value per group-by attribute, in the order they were asked for.
  values: Array<string>;
  count: number;
  /*
   * The last value each context attribute asked for had in the group's
   * spans, by attribute: what a device's group says about the device
   * (TraceGroupAbsence, #9925). Only an attribute some span gave a value.
   */
  lastValues?: Record<string, string> | undefined;
}

// A group seen between two times: its values, and its context attributes'.
export interface SpanAttributeGroup {
  values: Array<string>;
  lastValues?: Record<string, string> | undefined;
}

export interface SpanAttributeGroupCountResult {
  // The groups with the most spans first, at most `limit` of them.
  groups: Array<SpanAttributeGroupCount>;
  // Spans matched across every group - not just the groups returned.
  totalCount: number;
  // Distinct groups matched, before `limit` cut them.
  totalGroupCount: number;
}

// count() is a UInt64, a JSON string or a JSON number by server setting.
function toSpanCount(value: unknown): number {
  const parsed: number =
    typeof value === "number" || typeof value === "string" ? Number(value) : 0;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export class SpanService extends AnalyticsDatabaseService<Span> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Span, database: clickhouseDatabase });
  }

  // Its resource's retention for traces of its status, as on ingest.
  protected override async getRetentionDateOnCreate(
    span: Span,
  ): Promise<Date | null> {
    return await TelemetryRowRetention.getRetentionDate({
      row: span,
      pillar: "traces",
      bucketKey: span.statusCode,
    });
  }

  /*
   * Resolve the traces explorer's resource-facet selections (a Kubernetes
   * cluster, a host, ...) before the query is compiled. They arrive as
   * Postgres ids under `resourceFilters`; matching them needs the
   * resource's entity key, which only Postgres can supply. See
   * ResourceEntityFilter.
   */
  protected override async onBeforeFind(
    findBy: FindBy<Span>,
  ): Promise<OnFind<Span>> {
    await ResourceEntityFilter.rewriteAnalyticsQuery({
      query: findBy.query as unknown as Record<string, unknown>,
      projectId: findBy.props?.tenantId,
    });

    return { findBy, carryForward: null };
  }

  // The same rewrite, so the explorer's total counts the rows its list shows.
  protected override async onBeforeCount(
    countBy: CountBy<Span>,
  ): Promise<CountBy<Span>> {
    await ResourceEntityFilter.rewriteAnalyticsQuery({
      query: countBy.query as unknown as Record<string, unknown>,
      projectId: countBy.props?.tenantId,
    });

    return countBy;
  }

  /*
   * A search for an IP address also finds the spans whose address an IP
   * Address rule hashed, by the project's token for it (#10418): every
   * read of spans takes it (AnalyticsDatabaseService.bindReadQuery).
   */
  protected override async bindReadQuery(data: {
    query: Query<Span>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Query<Span>> {
    return await HashedAddressSearch.bindQuery({
      query: data.query,
      props: data.props,
      signal: HashedAddressSignal.Traces,
    });
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
   * inflated by spans that started in the same minute as the boundary, and
   * the projection cannot apply the retention read filter either. That is
   * fine for a threshold, which is what the projection serves. An exact
   * count is a total the traces explorer prints beside its list, where an
   * extra minute of spans reads as a wrong total — so it reads the table.
   */
  public override toCountStatement(countBy: CountBy<Span>): Statement {
    if (countBy.exact) {
      return super.toCountStatement(countBy);
    }

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
     * in depth — projection scans should complete in <1s. This is the
     * default (non-exact) count: 'break' keeps it what its callers have
     * always read, 0 when the count was broken off (see countBy). A total a
     * person reads is an exact count, which never takes this path.
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
   *      expression — never raw startTime. (The predicates name the
   *      column as s.startTime, through the table's alias, since the
   *      bucket is aliased startTime; the projection still serves it.)
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
     * This projection path derives its bucket interval from the window
     * and buckets by minute; it does not implement the explicit
     * `aggregationInterval` override (nor the `Total` whole-window mode).
     * When a caller pins an interval, fall back to the generic base
     * builder, which honors it.
     */
    if (aggregateBy.aggregationInterval !== undefined) {
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

    const aggregationInterval: AggregationInterval =
      AggregateUtil.getAggregationInterval({
        startDate: aggregateBy.startTimestamp,
        endDate: aggregateBy.endTimestamp,
      });

    /*
     * Bucket expression derived from the projection key via the shared
     * interval-expression map (the sub-hour tiers are not valid
     * date_trunc units): bucketing the minute-truncated timestamp
     * equals bucketing the raw timestamp for every interval >= 1
     * minute. Aliased to the timestamp column name so the generic
     * result parsing applies.
     */
    const statement: Statement = new Statement();
    statement
      .append(`SELECT ${aggregateExpression} as durationUnixNano, `)
      .append(
        AggregateUtil.buildBucketTimestampStatement(
          aggregationInterval,
          "toStartOfMinute(startTime)",
          aggregateBy.timezone,
        ),
      )
      .append(` as startTime`);
    /*
     * The WHERE reads the table's columns through the table's alias (s).
     * ClickHouse reads a bare name as the SELECT's alias before the
     * column, so a bare `startTime` here was the bucket above, not the
     * span's start: the window's first bucket starts before the window,
     * so all of its spans were filtered out (a day chart lost its first
     * day), and the last bucket kept spans after the window's end. The
     * qualified reads are the columns, and the projections still serve
     * the query.
     */
    statement.append(
      SQL` FROM ${databaseName}.${this.model.tableName} AS s WHERE s.projectId = ${{
        type: TableColumnType.ObjectID,
        value: projectId,
      }} AND toStartOfMinute(s.startTime) >= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: startValue,
      }}) AND toStartOfMinute(s.startTime) <= toStartOfMinute(${{
        type: TableColumnType.Date,
        value: endValue,
      }})`,
    );

    const primaryEntityIdValue: unknown = query["primaryEntityId"];
    if (primaryEntityIdValue instanceof ObjectID) {
      statement.append(
        SQL` AND s.primaryEntityId = ${{
          type: TableColumnType.ObjectID,
          value: primaryEntityIdValue,
        }}`,
      );
    } else if (primaryEntityIdValue instanceof Includes) {
      statement.append(
        SQL` AND s.primaryEntityId IN (${{
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
        SQL` AND s.isRootSpan = ${{
          type: TableColumnType.Boolean,
          value: Boolean(query["isRootSpan"]),
        }}`,
      );
    }

    const statusCodeValue: unknown = query["statusCode"];
    if (typeof statusCodeValue === "number") {
      statement.append(
        SQL` AND s.statusCode = ${{
          type: TableColumnType.Number,
          value: statusCodeValue,
        }}`,
      );
    } else if (statusCodeValue instanceof Includes) {
      statement.append(
        SQL` AND s.statusCode IN (${{
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

    // A chart: stopped at the limit, it says so (INTERACTIVE_READ_TIME_LIMIT).
    statement.append(
      getQuerySettings({
        ...INTERACTIVE_READ_TIME_LIMIT,
        additionalSettings: { optimize_use_projections: 1 },
      }),
    );

    return {
      statement,
      columns: ["durationUnixNano", "startTime"],
    };
  }

  /*
   * The spans of a few traces, for the security events that happened in
   * them (Utils/SecurityEvent/RequestTrace/SecurityRequestTrace.ts): each
   * span's identity, kind, status and duration, and of its attributes only
   * the ones asked for - an HTTP server span carries dozens. Always one
   * project's and a bounded window's, and at most `limitPerTrace` spans of
   * a trace, its earliest: the request it answers starts there.
   */
  @CaptureSpan()
  public async findSpansOfTraces(data: {
    projectId: ObjectID;
    traceIds: Array<string>;
    startedAfter: Date;
    startedBefore: Date;
    attributeKeys: Array<string>;
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

    const statement: Statement = SQL`SELECT traceId, spanId, parentSpanId, name, kind, statusCode, durationUnixNano, mapFilter((key, value) -> has(${{
      type: TableColumnType.ArrayText,
      value: data.attributeKeys,
    }}, key), attributes) AS attributes FROM `;
    statement.append(`${databaseName}.${this.model.tableName}`);
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND startTime >= ${{
        type: TableColumnType.Date,
        value: data.startedAfter,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: data.startedBefore,
      }} AND traceId IN (${{
        type: TableColumnType.Text,
        value: new Includes(data.traceIds),
      }}) AND retentionDate >= now() ORDER BY traceId ASC, startTime ASC LIMIT ${{
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

  /*
   * A grouped Traces monitor's count (#9711): one span count per distinct
   * combination of its group-by attributes' values, the busiest first, at
   * most `limit` of them, with the total and the number of groups before
   * the cut. The statement a grouped Logs monitor runs
   * (LogService.toAttributeGroupCountStatement), on spans.
   */
  @CaptureSpan()
  public async countByAttributeGroups(input: {
    query: Query<Span>;
    groupByAttributes: Array<string>;
    limit: number;
    props: DatabaseCommonInteractionProps;
    // Attributes whose last value each group's spans carried is read too.
    contextAttributes?: Array<string> | undefined;
  }): Promise<SpanAttributeGroupCountResult> {
    const query: Query<Span> = await this.readableQuery(input);

    const dbResult: Results = await this.executeQuery(
      this.toAttributeGroupCountStatement({
        query: query,
        groupByAttributes: input.groupByAttributes,
        limit: input.limit,
        contextAttributes: input.contextAttributes,
      }),
    );
    const response: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();
    const rows: Array<JSONObject> = response.data || [];
    const firstRow: JSONObject | undefined = rows[0];

    return {
      groups: rows.map((row: JSONObject): SpanAttributeGroupCount => {
        const lastValues: Record<string, string> | undefined =
          SpanService.readContextValues(row, input.contextAttributes);

        return {
          values: SpanService.readGroupValues(row, input.groupByAttributes),
          count: toSpanCount(row["groupCount"]),
          ...(lastValues ? { lastValues: lastValues } : {}),
        };
      }),
      totalCount: firstRow ? toSpanCount(firstRow["totalCount"]) : 0,
      totalGroupCount: firstRow ? toSpanCount(firstRow["totalGroupCount"]) : 0,
    };
  }

  /*
   * The groups the monitor's spans were in between `since` and `until`,
   * the most recently seen first, at most `limit`: what a grouped monitor
   * expects to keep hearing from (TraceGroupAbsence). A group whose every
   * value is empty is none - a span that names no install is no install.
   * With `contextAttributes`, each group carries the last value its spans
   * gave each of them (a quiet device's name and model, #9925).
   */
  @CaptureSpan()
  public async findRecentAttributeGroups(input: {
    query: Query<Span>;
    groupByAttributes: Array<string>;
    since: Date;
    until: Date;
    limit: number;
    props: DatabaseCommonInteractionProps;
    contextAttributes?: Array<string> | undefined;
  }): Promise<Array<SpanAttributeGroup>> {
    const query: Query<Span> = await this.readableQuery({
      query: {
        ...input.query,
        startTime: new InBetween(input.since, input.until),
      },
      props: input.props,
    });

    const statement: Statement = this.toGroupSelectStatement({
      query: query,
      groupByAttributes: input.groupByAttributes,
      select: "max(startTime) AS lastSeen",
      contextAttributes: input.contextAttributes,
    });

    statement.append(
      ` HAVING ${SpanService.groupAliases(input.groupByAttributes)
        .map((alias: string) => {
          return `${alias} != ''`;
        })
        .join(" OR ")}`,
    );
    statement.append(" ORDER BY lastSeen DESC");
    statement.append(
      SQL` LIMIT ${{
        value: SpanService.toGroupLimit(input.limit),
        type: TableColumnType.Number,
      }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    const dbResult: Results = await this.executeQuery(statement);
    const response: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();

    return (response.data || []).map((row: JSONObject): SpanAttributeGroup => {
      const lastValues: Record<string, string> | undefined =
        SpanService.readContextValues(row, input.contextAttributes);

      return {
        values: SpanService.readGroupValues(row, input.groupByAttributes),
        ...(lastValues ? { lastValues: lastValues } : {}),
      };
    });
  }

  /*
   * The grouped count as one statement - the window functions run over the
   * grouped rows before LIMIT, so the total and the number of groups cover
   * every group. Attribute keys are bound as parameters, never spliced in;
   * the aliases are built from the key's position. 'throw' on a timeout,
   * not countBy's 'break': a partial set of groups would read as devices
   * that stopped reporting.
   */
  public toAttributeGroupCountStatement(input: {
    query: Query<Span>;
    groupByAttributes: Array<string>;
    limit: number;
    contextAttributes?: Array<string> | undefined;
  }): Statement {
    const aliases: Array<string> = SpanService.groupAliases(
      input.groupByAttributes,
    );

    const statement: Statement = this.toGroupSelectStatement({
      query: input.query,
      groupByAttributes: input.groupByAttributes,
      select:
        "count() AS groupCount, sum(count()) OVER () AS totalCount, count() OVER () AS totalGroupCount",
      contextAttributes: input.contextAttributes,
    });

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
        value: SpanService.toGroupLimit(input.limit),
        type: TableColumnType.Number,
      }}`,
    );
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  /*
   * SELECT <select>, <the group values>[, <the context values>] FROM Span
   * WHERE <query> GROUP BY <the group values>. A context value is the last
   * value an attribute had in the group's spans, the latest span that gave
   * one winning (argMaxIf): a device renamed in the window reads by its new
   * name, and a span that names none does not blank it.
   */
  private toGroupSelectStatement(input: {
    query: Query<Span>;
    groupByAttributes: Array<string>;
    select: string;
    contextAttributes?: Array<string> | undefined;
  }): Statement {
    if (input.groupByAttributes.length === 0) {
      throw new BadDataException(
        "At least one attribute is needed to group spans by.",
      );
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;
    const aliases: Array<string> = SpanService.groupAliases(
      input.groupByAttributes,
    );

    const statement: Statement = new Statement();
    statement.append(`SELECT ${input.select}`);

    input.groupByAttributes.forEach((key: string, index: number) => {
      statement.append(
        SQL`, substringUTF8(attributes[${{
          value: key,
          type: TableColumnType.Text,
        }}], 1, `,
      );
      statement.append(`${MAX_SPAN_GROUP_VALUE_LENGTH}) AS ${aliases[index]}`);
    });

    (input.contextAttributes || []).forEach((key: string, index: number) => {
      statement.append(
        SQL`, argMaxIf(substringUTF8(attributes[${{
          value: key,
          type: TableColumnType.Text,
        }}], 1, `,
      );
      statement.append(`${MAX_SPAN_GROUP_VALUE_LENGTH}), startTime, `);
      statement.append(
        SQL`attributes[${{
          value: key,
          type: TableColumnType.Text,
        }}] != '')`,
      );
      statement.append(` AS ${SpanService.contextAlias(index)}`);
    });

    statement
      .append(SQL` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `)
      .append(this.statementGenerator.toWhereStatement(input.query))
      .append(this.getRetentionReadFilter());

    statement.append(` GROUP BY ${aliases.join(", ")}`);

    return statement;
  }

  // The query after the count hooks and the read permission, as countBy reads it.
  private async readableQuery(input: {
    query: Query<Span>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Query<Span>> {
    const countBy: CountBy<Span> = await this.onBeforeCount({
      query: input.query,
      props: input.props,
      skip: 0,
      limit: 1,
    });

    const permission: CheckReadPermissionType<Span> =
      await ModelPermission.checkReadPermission(
        this.modelType,
        await this.bindReadQueryOf(countBy.query, input.props),
        null,
        input.props,
      );

    return permission.query;
  }

  private static groupAliases(groupByAttributes: Array<string>): Array<string> {
    return groupByAttributes.map((_key: string, index: number) => {
      return `__group_${index}`;
    });
  }

  private static toGroupLimit(limit: number): number {
    const value: number = Math.floor(Number(limit));

    if (!Number.isFinite(value) || value < 1) {
      throw new BadDataException("The group limit must be a positive number.");
    }

    return value;
  }

  private static readGroupValues(
    row: JSONObject,
    groupByAttributes: Array<string>,
  ): Array<string> {
    return groupByAttributes.map((_key: string, index: number): string => {
      const value: unknown = row[`__group_${index}`];

      return value === undefined || value === null ? "" : String(value);
    });
  }

  private static contextAlias(index: number): string {
    return `__context_${index}`;
  }

  // The context attributes a row gave a value, by attribute; undefined if none.
  private static readContextValues(
    row: JSONObject,
    contextAttributes: Array<string> | undefined,
  ): Record<string, string> | undefined {
    const values: Record<string, string> = {};

    (contextAttributes || []).forEach((key: string, index: number) => {
      const value: unknown = row[SpanService.contextAlias(index)];

      if (value !== undefined && value !== null && String(value) !== "") {
        values[key] = String(value);
      }
    });

    return Object.keys(values).length > 0 ? values : undefined;
  }
}

export default new SpanService();
