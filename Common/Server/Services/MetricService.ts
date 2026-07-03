import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import { MutableMetricService as MutableMetricServiceClass } from "./MutableMetricService";
import Metric from "../../Models/AnalyticsModels/Metric";
import AggregateBy, {
  AggregateUtil,
} from "../Types/AnalyticsDatabase/AggregateBy";
import DeleteBy from "../Types/AnalyticsDatabase/DeleteBy";
import Query from "../Types/AnalyticsDatabase/Query";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import AggregationType, {
  getPercentileLevel,
  isPercentileAggregation,
} from "../../Types/BaseDatabase/AggregationType";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { keyForHost } from "../../Utils/Telemetry/EntityKey";
import ObjectID from "../../Types/ObjectID";
import logger, { LogAttributes } from "../Utils/Logger";
import ModelPermission, {
  CheckReadPermissionType,
} from "../Types/AnalyticsDatabase/ModelPermission";
import Select from "../Types/AnalyticsDatabase/Select";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { ResponseJSON, ResultSet } from "@clickhouse/client";

/**
 * Maximum number of aggregated (series × minute-bucket) rows a single
 * per-series aggregation query returns. This bounds worker memory, not
 * fleet size: because aggregation happens in ClickHouse, the row count
 * scales with `distinct series × minutes in window` instead of
 * `series × samples` — a 10,000-device fleet on a 5-minute window is
 * 50,000 rows, comfortably under this cap, where the old raw-row path
 * (capped at LIMIT_PER_PROJECT = 10,000 raw samples) silently dropped
 * most of the fleet. Truncation against this cap is detected via
 * ClickHouse's rows_before_limit_at_least and surfaced to callers.
 */
export const PER_SERIES_AGGREGATION_MAX_ROWS: number = 100000;

/**
 * Alias prefix for the scalar columns that carry each requested group-by
 * attribute key in per-series aggregation results. Key order in
 * `groupByAttributeKeys` maps to `${prefix}0`, `${prefix}1`, ...
 */
export const PER_SERIES_ATTRIBUTE_ALIAS_PREFIX: string = "seriesAttribute";

/**
 * Alias for the minute-bucket column in per-series aggregation results.
 *
 * MUST NOT be `time` (or any other real column name): ClickHouse
 * substitutes SELECT aliases into the WHERE clause (default
 * prefer_column_name_to_alias = 0), so `toStartOfMinute(time) AS time`
 * silently rewrites the window predicate to
 * `toStartOfMinute(time) >= windowStart` — dropping every raw row in
 * the minute containing a non-minute-aligned window start. Monitor
 * windows come from RollingTimeUtil relative to "now" and are
 * essentially never minute-aligned, so a colliding alias would shave
 * the first partial minute off every evaluation. (Do NOT "fix" a
 * collision with prefer_column_name_to_alias = 1 either — that would
 * rebind the alias references in GROUP BY/ORDER BY to the raw column
 * and break the bucketing.)
 */
export const PER_SERIES_BUCKET_TIME_ALIAS: string = "seriesBucketTime";

export interface MetricPerSeriesAggregationResult {
  /** Rows shaped exactly like the legacy in-process aggregation path. */
  result: AggregatedResult;
  /** True when the row cap dropped aggregated rows. */
  truncated: boolean;
  /** Exact number of aggregated rows dropped by the row cap. */
  droppedRowCount: number;
}

export class MetricService extends AnalyticsDatabaseService<Metric> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Metric, database: clickhouseDatabase });
  }

  /*
   * Cascade deletes from `MetricItemV3` into the aggregating
   * materialized-view target tables.
   *
   * `MetricItemAggMV1m` and `MetricBaselineHourly` are AggregatingMergeTree
   * tables populated by attached MVs that only fire on inserts —
   * `ALTER ... DELETE` against the source table does not roll back the
   * previously-accumulated `sumState`/`countState` rows already in the MV
   * tables. Without a matching DELETE on each MV, dashboard widgets that
   * read from `MetricItemAggMV1m` keep counting and averaging metrics
   * belonging to entities (incidents, alerts) the user has just deleted.
   * See https://github.com/OneUptime/oneuptime/issues/2419.
   *
   * The cascade only runs when the caller scoped the delete by
   * `primaryEntityId`. Global time-based purges (TTL cleanup) are handled
   * by each MV table's own `retentionDate TTL DELETE`, so cascading those
   * would pointlessly scan the whole MV. The per-host MV
   * (`MetricItemAggMV1mByHostV2`) is keyed by `hostEntityKey` rather than
   * `primaryEntityId`, so an entity-scoped delete has nothing to remove
   * there — skip it.
   */
  public override async deleteBy(deleteBy: DeleteBy<Metric>): Promise<void> {
    await super.deleteBy(deleteBy);

    const cascadeQuery: Query<Metric> | null = this.buildMVCascadeQuery(
      deleteBy.query,
    );
    if (!cascadeQuery) {
      return;
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string = this.database.getDatasourceOptions().database!;
    const whereStatement: Statement =
      this.statementGenerator.toWhereStatement(cascadeQuery);

    const cascadeTargets: ReadonlyArray<AnalyticsTableName> = [
      AnalyticsTableName.MetricItemAggMV1m,
      AnalyticsTableName.MetricBaselineHourly,
    ];

    for (const tableName of cascadeTargets) {
      try {
        /*
         * Lightweight delete — see toDeleteStatement() in
         * AnalyticsDatabaseService for the rationale (avoids the
         * ALTER mutations queue which is capped at 1000 per table).
         */
        const statement: Statement =
          SQL`DELETE FROM ${databaseName}.${tableName} WHERE TRUE `.append(
            whereStatement,
          );
        await this.execute(statement);
      } catch (err) {
        logger.error(
          `Cascade delete into ${tableName} failed; dashboard widgets reading from this MV may temporarily show stale aggregated values for the deleted entity.`,
        );
        logger.error(err);
      }
    }
  }

  private buildMVCascadeQuery(query: Query<Metric>): Query<Metric> | null {
    if (!query || typeof query !== "object") {
      return null;
    }

    const queryRecord: Record<string, unknown> = query as unknown as Record<
      string,
      unknown
    >;

    /*
     * Cascade only when the delete is scoped by primaryEntityId. The MV
     * sort key is (projectId, name, primaryEntityId, bucketTime); without
     * primaryEntityId the DELETE would scan a huge swath of unrelated
     * rows and risk removing data that belongs to other entities sharing
     * the same project.
     */
    if (
      queryRecord["primaryEntityId"] === undefined ||
      queryRecord["primaryEntityId"] === null
    ) {
      return null;
    }

    /*
     * Only project the keys the MV target tables actually expose.
     * `time`, `attributes`, `primaryEntityType`, and the metric-payload
     * columns don't exist on the MV schema and would either fail
     * where-statement generation or reference a missing column.
     */
    const allowedKeys: ReadonlyArray<string> = [
      "projectId",
      "name",
      "primaryEntityId",
    ];
    const out: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      const value: unknown = queryRecord[key];
      if (value !== undefined) {
        out[key] = value;
      }
    }

    return out as unknown as Query<Metric>;
  }

  /**
   * Histogram-aware aggregation override.
   *
   * For non-percentile aggregations (Sum/Avg/Min/Max/Count) we delegate
   * to the base implementation. For percentile aggregations
   * (P50/P90/P95/P99) we build a subquery that fans each metric row out
   * into one or more `(midpoint, weight)` samples — derived from
   * histogram buckets when present — and then runs
   * `quantileExactWeighted` over the fanned-out distribution. This means
   * a P95 of `http.server.request.duration` returns a real
   * bucket-derived 95th percentile of observed values, not the 95th
   * percentile of per-row `sum`s.
   *
   * Per `metricPointType` the fanout is:
   *
   *   Histogram             -> one (midpoint, count) per explicit bucket;
   *                            midpoint = (lower + upper) / 2, with the
   *                            implicit -inf/+inf buckets approximated
   *                            against the nearest bound.
   *   ExponentialHistogram  -> one (geomean, count) per positive bucket;
   *                            base = 2^(2^-scale); bucket index `k` is
   *                            `positiveOffset + i - 1` (1-indexed) and
   *                            we use the geometric midpoint
   *                            base^(k + 0.5). Negative buckets are
   *                            currently ignored (rare in practice and
   *                            would require a separate fanout).
   *   Summary               -> exactly one sample: the value at the
   *                            stored quantile closest to (and >=) the
   *                            target `p`, weighted 1; falls back to the
   *                            highest stored quantile when nothing
   *                            covers `p`.
   *   Sum / Gauge / unknown -> raw `value` weighted 1 (same as the
   *                            generic `quantile(p)(value)` path).
   */
  public override toAggregateStatement(aggregateBy: AggregateBy<Metric>): {
    statement: Statement;
    columns: Array<string>;
  } {
    const mutableMetricStatement: {
      statement: Statement;
      columns: Array<string>;
    } | null = this.tryBuildMutableMetricAggregateStatement(aggregateBy);

    if (mutableMetricStatement) {
      return mutableMetricStatement;
    }

    if (!isPercentileAggregation(aggregateBy.aggregationType)) {
      /*
       * Try the per-host MV first — host detail pages are the
       * dominant attribute-filtered path and the per-host MV is
       * the only one that can serve them. If it doesn't apply
       * (no host filter, or extra attrs/groupBy), fall through
       * to the project/primaryEntityId MV, then to the base table.
       */
      const hostMvStatement: {
        statement: Statement;
        columns: Array<string>;
      } | null = this.tryBuildHostAggregateMVStatement(aggregateBy);
      if (hostMvStatement) {
        return hostMvStatement;
      }
      const mvStatement: {
        statement: Statement;
        columns: Array<string>;
      } | null = this.tryBuildMinuteAggregateMVStatement(aggregateBy);
      if (mvStatement) {
        return mvStatement;
      }
      return super.toAggregateStatement(aggregateBy);
    }

    const percentileLevel: number | null = getPercentileLevel(
      aggregateBy.aggregationType,
    );
    if (percentileLevel === null) {
      return super.toAggregateStatement(aggregateBy);
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const aggregationColumn: string =
      aggregateBy.aggregateColumnName.toString();
    const aggregationTimestampColumn: string =
      aggregateBy.aggregationTimestampColumnName.toString();
    const aggregationInterval: string = AggregateUtil.getAggregationInterval({
      startDate: aggregateBy.startTimestamp!,
      endDate: aggregateBy.endTimestamp!,
    }).toLowerCase();

    /*
     * Group-by columns from the caller need to be carried through the
     * inner subquery so the outer GROUP BY can reference them. Only
     * columns that exist on the model are accepted (matches the base
     * generator's safety net).
     */
    const groupByKeys: Array<string> = [];
    if (aggregateBy.groupBy) {
      for (const key of Object.keys(aggregateBy.groupBy)) {
        if (!this.model.getTableColumn(key)) {
          continue;
        }
        groupByKeys.push(key);
      }
    }

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      aggregateBy.query,
    );
    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      aggregateBy.sort!,
    );

    /*
     * Per-row fanout. The result of multiIf is `Array(Tuple(Float64,
     * Float64))` — element 1 is the sample midpoint, element 2 is the
     * weight (rounded to UInt64 in the outer SELECT for
     * quantileExactWeighted). Each branch is guarded by a presence
     * check so a row missing its expected payload (e.g. a zero-bucket
     * histogram) silently drops to the scalar fallback rather than
     * exploding.
     */
    const fanoutExpression: string = `
      multiIf(
        metricPointType = 'ExponentialHistogram' AND notEmpty(positiveBucketCounts),
          arrayMap(
            i -> tuple(
              pow(
                pow(2.0, pow(2.0, -toFloat64(coalesce(scale, 0)))),
                toFloat64(coalesce(positiveOffset, 0)) + toFloat64(i) - 0.5
              ),
              toFloat64(positiveBucketCounts[i])
            ),
            arrayEnumerate(positiveBucketCounts)
          ),
        metricPointType = 'Histogram' AND notEmpty(bucketCounts),
          arrayMap(
            i -> tuple(
              multiIf(
                length(explicitBounds) = 0,
                  toFloat64(coalesce(value, sum, 0)),
                i = 1,
                  toFloat64(explicitBounds[1]) / 2.0,
                i > length(explicitBounds),
                  toFloat64(explicitBounds[length(explicitBounds)]) * 1.5,
                (toFloat64(explicitBounds[i - 1]) + toFloat64(explicitBounds[i])) / 2.0
              ),
              toFloat64(bucketCounts[i])
            ),
            arrayEnumerate(bucketCounts)
          ),
        metricPointType = 'Summary' AND notEmpty(summaryValues),
          [tuple(
            if(
              arrayFirstIndex(q -> q >= ${percentileLevel}, summaryQuantiles) > 0,
              summaryValues[arrayFirstIndex(q -> q >= ${percentileLevel}, summaryQuantiles)],
              summaryValues[length(summaryValues)]
            ),
            1.0
          )],
        [tuple(toFloat64(coalesce(value, sum, 0)), 1.0)]
      )
    `;

    /*
     * Inner subquery: keeps the row's timestamp and any group-by
     * columns, then fans the row into per-sample rows via arrayJoin.
     * We use `__pcl_pair` so the column name doesn't collide with any
     * model column should ClickHouse ever surface it through a tooling
     * layer.
     */
    const innerSelectColumns: Array<string> = [aggregationTimestampColumn];
    for (const key of groupByKeys) {
      if (!innerSelectColumns.includes(key)) {
        innerSelectColumns.push(key);
      }
    }

    const innerSelectClause: string = `${innerSelectColumns.join(", ")}, arrayJoin(${fanoutExpression}) AS __pcl_pair`;

    const statement: Statement = SQL``;

    /*
     * Outer SELECT: time bucket + weighted quantile + carry-forward
     * group-by columns. Quantile weight must be UInt for
     * quantileExactWeighted; we round to nearest integer (a count of
     * 0.5 rounds to 0 which drops the sample, but bucket counts are
     * always whole numbers in practice).
     */
    statement.append(
      `SELECT quantileExactWeighted(${percentileLevel})(__pcl_pair.1, toUInt64(greatest(0, round(__pcl_pair.2)))) as ${aggregationColumn}, date_trunc('${aggregationInterval}', toStartOfInterval(${aggregationTimestampColumn}, INTERVAL 1 ${aggregationInterval})) as ${aggregationTimestampColumn}`,
    );

    for (const key of groupByKeys) {
      statement.append(`, ${key}`);
    }

    statement.append(SQL` FROM (`);
    statement.append(`SELECT ${innerSelectClause}`);
    statement.append(
      ` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `,
    );
    statement.append(whereStatement);
    statement.append(this.getRetentionReadFilter());
    statement.append(SQL`) `);

    statement.append(SQL` GROUP BY `).append(`${aggregationTimestampColumn}`);
    for (const key of groupByKeys) {
      statement.append(`, ${key}`);
    }

    statement.append(SQL` ORDER BY `).append(sortStatement);

    statement.append(
      SQL` LIMIT ${{
        value: Number(aggregateBy.limit),
        type: TableColumnType.Number,
      }}`,
    );
    statement.append(
      SQL` OFFSET ${{
        value: Number(aggregateBy.skip),
        type: TableColumnType.Number,
      }} `,
    );

    /*
     * Match the read-path settings the base aggregator now appends (see
     * AnalyticsDatabaseService.toAggregateStatement). The percentile
     * path bypasses the base method, so we mirror them here to keep
     * cluster behavior consistent across aggregation kinds.
     */
    statement.append(
      getQuerySettings({
        additionalSettings: {
          optimize_aggregation_in_order: 1,
          optimize_move_to_prewhere: 1,
          max_threads: 4,
        },
      }),
    );

    const columns: Array<string> = [
      aggregationColumn,
      aggregationTimestampColumn,
      ...groupByKeys,
    ];

    logger.debug(`${this.model.tableName} Percentile Aggregate Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return { statement, columns };
  }

  private tryBuildMutableMetricAggregateStatement(
    aggregateBy: AggregateBy<Metric>,
  ): { statement: Statement; columns: Array<string> } | null {
    const metricName: string | null = this.getExactMetricNameFromQuery(
      aggregateBy.query,
    );

    if (
      !MutableMetricServiceClass.isMutableMetricName(metricName || undefined)
    ) {
      return null;
    }

    if (!this.canRouteAggregateToMutableMetricTable(aggregateBy)) {
      return null;
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const select: { statement: Statement; columns: Array<string> } =
      this.statementGenerator.toAggregateSelectStatement(aggregateBy);

    const innerWhereStatement: Statement =
      this.statementGenerator.toWhereStatement(
        this.getMutableMetricInnerQuery(aggregateBy.query),
      );
    const outerWhereStatement: Statement =
      this.statementGenerator.toWhereStatement(aggregateBy.query);
    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      aggregateBy.sort!,
    );

    const statement: Statement = SQL``;

    statement
      .append(SQL`SELECT `)
      .append(select.statement)
      .append(
        SQL`
          FROM (
            SELECT
              projectId,
              name,
              primaryEntityId,
              primaryEntityType,
              metricPointId,
              argMax(metricPointType, version) AS metricPointType,
              argMax(time, version) AS time,
              argMax(timeUnixNano, version) AS timeUnixNano,
              argMax(attributes, version) AS attributes,
              argMax(attributeKeys, version) AS attributeKeys,
              argMax(value, version) AS value,
              argMax(retentionDate, version) AS retentionDate,
              argMax(isDeleted, version) AS isDeleted
            FROM ${databaseName}.${AnalyticsTableName.MutableMetric}
            WHERE TRUE
        `,
      )
      .append(innerWhereStatement)
      .append(
        SQL`
            GROUP BY
              projectId,
              name,
              primaryEntityId,
              primaryEntityType,
              metricPointId
          )
          WHERE isDeleted = false
        `,
      )
      .append(outerWhereStatement)
      .append(SQL` AND retentionDate >= now()`);

    statement
      .append(SQL` GROUP BY `)
      .append(`${aggregateBy.aggregationTimestampColumnName.toString()}`);

    if (aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0) {
      statement
        .append(SQL` , `)
        .append(
          this.statementGenerator.toGroupByStatement(aggregateBy.groupBy),
        );
    }

    statement.append(SQL` ORDER BY `).append(sortStatement);

    statement.append(
      SQL` LIMIT ${{
        value: Number(aggregateBy.limit),
        type: TableColumnType.Number,
      }}`,
    );

    statement.append(
      SQL` OFFSET ${{
        value: Number(aggregateBy.skip),
        type: TableColumnType.Number,
      }}`,
    );

    statement.append(
      getQuerySettings({
        additionalSettings: {
          optimize_move_to_prewhere: 1,
          max_threads: 4,
        },
      }),
    );

    logger.debug("Mutable metric aggregate statement", {
      metricName: metricName || "",
    } as LogAttributes);
    logger.debug(statement, {
      metricName: metricName || "",
    } as LogAttributes);

    return {
      statement,
      columns: select.columns,
    };
  }

  private getMutableMetricInnerQuery(query: Query<Metric>): Query<Metric> {
    const queryRecord: Record<string, unknown> = query as unknown as Record<
      string,
      unknown
    >;
    const allowedInnerKeys: Array<string> = [
      "projectId",
      "name",
      "primaryEntityId",
      "primaryEntityType",
    ];
    const innerQuery: Record<string, unknown> = {};

    for (const key of allowedInnerKeys) {
      if (queryRecord[key] !== undefined) {
        innerQuery[key] = queryRecord[key];
      }
    }

    return innerQuery as unknown as Query<Metric>;
  }

  private getExactMetricNameFromQuery(query: Query<Metric>): string | null {
    const queryRecord: Record<string, unknown> = query as unknown as Record<
      string,
      unknown
    >;
    const metricName: unknown = queryRecord["name"];

    if (typeof metricName !== "string") {
      return null;
    }

    return metricName;
  }

  private canRouteAggregateToMutableMetricTable(
    aggregateBy: AggregateBy<Metric>,
  ): boolean {
    const supportedColumns: Set<string> = new Set<string>([
      "projectId",
      "name",
      "primaryEntityId",
      "primaryEntityType",
      "metricPointType",
      "time",
      "timeUnixNano",
      "attributes",
      "attributeKeys",
      "value",
      "retentionDate",
    ]);

    const queryRecord: Record<string, unknown> =
      aggregateBy.query as unknown as Record<string, unknown>;

    for (const key of Object.keys(queryRecord)) {
      if (!supportedColumns.has(key)) {
        return false;
      }
    }

    if (
      !supportedColumns.has(aggregateBy.aggregateColumnName.toString()) ||
      !supportedColumns.has(
        aggregateBy.aggregationTimestampColumnName.toString(),
      )
    ) {
      return false;
    }

    if (aggregateBy.groupBy) {
      for (const key of Object.keys(aggregateBy.groupBy)) {
        if (!supportedColumns.has(key)) {
          return false;
        }
      }
    }

    if (aggregateBy.sort) {
      for (const key of Object.keys(aggregateBy.sort)) {
        if (!supportedColumns.has(key)) {
          return false;
        }
      }
    }

    return true;
  }

  /*
   * Materialized-view fast path for scalar aggregations.
   *
   * Returns a statement that reads from MetricItemAggMV1m (the
   * 1-minute pre-aggregate created by
   * AddMetricMinuteAggregateMaterializedView) when:
   *
   *   - The aggregation is Sum/Avg/Min/Max/Count over `value`.
   *   - The dashboard's effective bucket interval is >= 1 minute (the
   *     MV stores 1-minute states; sub-minute requests need raw rows).
   *   - The query carries no per-attribute filter or group-by, since
   *     the MV is keyed by (projectId, name, primaryEntityId, bucketTime)
   *     only — it does not preserve attribute breakdowns.
   *   - The query carries no group-by other than the time bucket.
   *
   * Returns `null` if any condition fails so the caller falls back to
   * the base table. The result row shape (columns: aggregateColumn,
   * timestampColumn) matches the base statement so downstream code
   * needs no changes.
   */
  private tryBuildMinuteAggregateMVStatement(
    aggregateBy: AggregateBy<Metric>,
  ): { statement: Statement; columns: Array<string> } | null {
    const aggType: AggregationType = aggregateBy.aggregationType;
    const supported: ReadonlyArray<AggregationType> = [
      AggregationType.Sum,
      AggregationType.Avg,
      AggregationType.Min,
      AggregationType.Max,
      AggregationType.Count,
    ];
    if (!supported.includes(aggType)) {
      return null;
    }

    if (
      aggregateBy.aggregateColumnName.toString() !== "value" ||
      aggregateBy.aggregationTimestampColumnName.toString() !== "time"
    ) {
      return null;
    }

    const interval: AggregationInterval = AggregateUtil.getAggregationInterval({
      startDate: aggregateBy.startTimestamp!,
      endDate: aggregateBy.endTimestamp!,
    });
    /*
     * The MV is bucketed at 1 minute, so all values of AggregationInterval
     * (Minute / Hour / Day / Week / Month / Year) are >= MV resolution
     * and acceptable. Kept as a no-op read so the dependency on
     * AggregateUtil makes the intent obvious.
     */
    void interval;

    const queryRecord: Record<string, unknown> =
      (aggregateBy.query as unknown as Record<string, unknown>) || {};
    const attrs: unknown = queryRecord["attributes"];
    if (
      attrs !== undefined &&
      attrs !== null &&
      !(
        typeof attrs === "object" &&
        Object.keys(attrs as Record<string, unknown>).length === 0
      )
    ) {
      return null;
    }

    if (aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0) {
      return null;
    }

    /*
     * The MV only carries projectId/name/primaryEntityId/bucketTime, so a
     * query filtering on any other column (e.g. entityKeys membership,
     * which exists only on the raw Metric table) must fall back to the
     * raw-table path or the generated WHERE would reference a column the
     * MV does not have.
     */
    const mvQueryableColumns: ReadonlyArray<string> = [
      "projectId",
      "name",
      "primaryEntityId",
      "time", // stripped below; bucketTime range is added explicitly
      "attributes", // guarded empty above
    ];
    for (const queryKey of Object.keys(queryRecord)) {
      if (!mvQueryableColumns.includes(queryKey)) {
        return null;
      }
    }

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string = this.database.getDatasourceOptions().database!;

    const intervalLower: string = interval.toLowerCase();

    let mergedExpr: string;
    if (aggType === AggregationType.Sum) {
      mergedExpr = `sumMerge(valueSumState)`;
    } else if (aggType === AggregationType.Count) {
      mergedExpr = `countMerge(valueCountState)`;
    } else if (aggType === AggregationType.Min) {
      mergedExpr = `minMerge(valueMinState)`;
    } else if (aggType === AggregationType.Max) {
      mergedExpr = `maxMerge(valueMaxState)`;
    } else {
      // Avg = sum / count, derived from the two stored states.
      mergedExpr = `if(countMerge(valueCountState) = 0, 0, sumMerge(valueSumState) / countMerge(valueCountState))`;
    }

    /*
     * Build the WHERE on a copy of the query with `time` removed so
     * the generator never references a column that doesn't exist on
     * the MV. We then add an explicit `bucketTime` range from
     * startTimestamp/endTimestamp.
     */
    const nonTimeWhere: Statement = this.statementGenerator.toWhereStatement(
      this.stripTimeFromQuery(aggregateBy.query) as typeof aggregateBy.query,
    );
    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      aggregateBy.sort!,
    );

    const statement: Statement = SQL``;

    statement.append(
      `SELECT ${mergedExpr} as value, date_trunc('${intervalLower}', toStartOfInterval(bucketTime, INTERVAL 1 ${intervalLower})) as time`,
    );
    statement.append(SQL` FROM ${databaseName}.MetricItemAggMV1m`);
    statement.append(
      ` WHERE bucketTime >= toDateTime('${this.formatDateTime(aggregateBy.startTimestamp!)}') AND bucketTime <= toDateTime('${this.formatDateTime(aggregateBy.endTimestamp!)}')${this.getRetentionReadFilter()}`,
    );
    statement.append(SQL` `).append(nonTimeWhere);

    statement.append(SQL` GROUP BY `).append(`time`);
    statement.append(SQL` ORDER BY `).append(sortStatement);
    statement.append(
      SQL` LIMIT ${{
        value: Number(aggregateBy.limit),
        type: TableColumnType.Number,
      }}`,
    );
    statement.append(
      SQL` OFFSET ${{
        value: Number(aggregateBy.skip),
        type: TableColumnType.Number,
      }} `,
    );
    statement.append(
      getQuerySettings({
        additionalSettings: {
          optimize_aggregation_in_order: 1,
          optimize_move_to_prewhere: 1,
          max_threads: 4,
        },
      }),
    );

    logger.debug(`${this.model.tableName} MV Aggregate Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return {
      statement,
      columns: [
        aggregateBy.aggregateColumnName.toString(),
        aggregateBy.aggregationTimestampColumnName.toString(),
      ],
    };
  }

  /*
   * Per-host materialized-view fast path.
   *
   * Returns a statement that reads from MetricItemAggMV1mByHostV2
   * (created by RekeyMetricHostRollupToEntityKey), which is keyed by
   * the stable `hostEntityKey` — the incoming `resource.host.name`
   * filter value is folded into that key server-side via
   * EntityKey.keyForHost, so spelling drift (case/whitespace) in the
   * reported hostname still lands on one rollup stream. Applies when:
   *
   *   - The aggregation is Sum/Avg/Min/Max/Count over `value`.
   *   - The only attribute filter is `resource.host.name` as a
   *     bare-string equality (the dashboard's host detail page
   *     pattern), and the query carries a `projectId` (the entity
   *     key is tenant-scoped by construction).
   *   - The query carries no group-by other than the time
   *     bucket — the MV is keyed by hostEntityKey and does not
   *     preserve other attribute breakdowns.
   *
   * Returns `null` if any condition fails so the caller falls
   * through to the next fast path / base table. The result row
   * shape (columns: aggregateColumn, timestampColumn) matches
   * the base statement so downstream code needs no changes.
   */
  private tryBuildHostAggregateMVStatement(
    aggregateBy: AggregateBy<Metric>,
  ): { statement: Statement; columns: Array<string> } | null {
    const aggType: AggregationType = aggregateBy.aggregationType;
    const supported: ReadonlyArray<AggregationType> = [
      AggregationType.Sum,
      AggregationType.Avg,
      AggregationType.Min,
      AggregationType.Max,
      AggregationType.Count,
    ];
    if (!supported.includes(aggType)) {
      return null;
    }

    if (
      aggregateBy.aggregateColumnName.toString() !== "value" ||
      aggregateBy.aggregationTimestampColumnName.toString() !== "time"
    ) {
      return null;
    }

    if (aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0) {
      return null;
    }

    /*
     * Inspect the attribute filter. This MV is only safe when
     * the user is filtering by exactly one attribute,
     * `resource.host.name`, with a bare-string value (the
     * canonical Overview/Metrics-page pattern). Anything else —
     * extra attribute filters, NotEqual, Search, etc. — has to
     * fall back so the result stays correct.
     */
    const queryRecord: Record<string, unknown> =
      (aggregateBy.query as unknown as Record<string, unknown>) || {};
    const attrs: unknown = queryRecord["attributes"];
    if (!attrs || typeof attrs !== "object") {
      return null;
    }
    const attrEntries: Array<[string, unknown]> = Object.entries(
      attrs as Record<string, unknown>,
    );
    if (attrEntries.length !== 1) {
      return null;
    }
    const [attrKey, attrValue] = attrEntries[0]!;
    if (attrKey !== "resource.host.name") {
      return null;
    }
    if (attrValue === undefined || attrValue === null) {
      return null;
    }

    /*
     * The MV only carries projectId/name/hostEntityKey/bucketTime. Any
     * other query key (primaryEntityId, entityScope, entityKeys, ...)
     * would compile to a WHERE over a column the MV does not have, so
     * fall back to the raw table for those. Mirrors
     * tryBuildMinuteAggregateMVStatement.
     */
    const mvQueryableColumns: ReadonlyArray<string> = [
      "projectId",
      "name",
      "time", // stripped below; bucketTime range is added explicitly
      "attributes", // rewritten below into the hostEntityKey predicate
    ];
    for (const queryKey of Object.keys(queryRecord)) {
      if (!mvQueryableColumns.includes(queryKey)) {
        return null;
      }
    }
    const hostIdentifier: string =
      typeof attrValue === "string" ? attrValue : "";
    if (!hostIdentifier) {
      return null;
    }

    /*
     * The entity key folds the tenant in (sha256(projectId|host|...)), so
     * the MV row can only be located when the query is project-scoped.
     * Dashboard reads always are; anything else falls back safely.
     */
    const projectIdValue: unknown = queryRecord["projectId"];
    let projectId: string = "";
    if (projectIdValue instanceof ObjectID) {
      projectId = projectIdValue.toString();
    } else if (typeof projectIdValue === "string") {
      projectId = projectIdValue;
    }
    if (!projectId) {
      return null;
    }

    /*
     * Same canonicalized key the ingest pipeline stamps into
     * MetricItemV3.hostEntityKey (and the V2 MV groups by) — byte-equality
     * is what makes this lookup correct, see Common/Utils/Telemetry/EntityKey.
     */
    const hostEntityKey: string = keyForHost(projectId, hostIdentifier);

    const interval: AggregationInterval = AggregateUtil.getAggregationInterval({
      startDate: aggregateBy.startTimestamp!,
      endDate: aggregateBy.endTimestamp!,
    });
    void interval;

    if (!this.database) {
      this.useDefaultDatabase();
    }
    const databaseName: string = this.database.getDatasourceOptions().database!;

    const intervalLower: string = interval.toLowerCase();

    let mergedExpr: string;
    if (aggType === AggregationType.Sum) {
      mergedExpr = `sumMerge(valueSumState)`;
    } else if (aggType === AggregationType.Count) {
      mergedExpr = `countMerge(valueCountState)`;
    } else if (aggType === AggregationType.Min) {
      mergedExpr = `minMerge(valueMinState)`;
    } else if (aggType === AggregationType.Max) {
      mergedExpr = `maxMerge(valueMaxState)`;
    } else {
      mergedExpr = `if(countMerge(valueCountState) = 0, 0, sumMerge(valueSumState) / countMerge(valueCountState))`;
    }

    /*
     * Strip both `time` (column doesn't exist on the MV; we
     * inject an explicit bucketTime range below) and
     * `attributes` (the attribute filter is now an explicit
     * `hostEntityKey =` predicate against an MV column).
     */
    const filteredQuery: typeof aggregateBy.query =
      this.stripAttributesAndTimeFromQuery(
        aggregateBy.query,
      ) as typeof aggregateBy.query;
    const nonTimeWhere: Statement =
      this.statementGenerator.toWhereStatement(filteredQuery);
    const sortStatement: Statement = this.statementGenerator.toSortStatement(
      aggregateBy.sort!,
    );

    const statement: Statement = SQL``;

    statement.append(
      `SELECT ${mergedExpr} as value, date_trunc('${intervalLower}', toStartOfInterval(bucketTime, INTERVAL 1 ${intervalLower})) as time`,
    );
    statement.append(SQL` FROM ${databaseName}.MetricItemAggMV1mByHostV2`);
    statement.append(
      ` WHERE bucketTime >= toDateTime('${this.formatDateTime(aggregateBy.startTimestamp!)}') AND bucketTime <= toDateTime('${this.formatDateTime(aggregateBy.endTimestamp!)}')${this.getRetentionReadFilter()}`,
    );
    statement.append(
      SQL` AND hostEntityKey = ${{
        value: hostEntityKey,
        type: TableColumnType.Text,
      }}`,
    );
    statement.append(SQL` `).append(nonTimeWhere);

    statement.append(SQL` GROUP BY `).append(`time`);
    statement.append(SQL` ORDER BY `).append(sortStatement);
    statement.append(
      SQL` LIMIT ${{
        value: Number(aggregateBy.limit),
        type: TableColumnType.Number,
      }}`,
    );
    statement.append(
      SQL` OFFSET ${{
        value: Number(aggregateBy.skip),
        type: TableColumnType.Number,
      }} `,
    );
    statement.append(
      getQuerySettings({
        additionalSettings: {
          optimize_aggregation_in_order: 1,
          optimize_move_to_prewhere: 1,
          max_threads: 4,
        },
      }),
    );

    logger.debug(`${this.model.tableName} Host MV Aggregate Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return {
      statement,
      columns: [
        aggregateBy.aggregateColumnName.toString(),
        aggregateBy.aggregationTimestampColumnName.toString(),
      ],
    };
  }

  private stripAttributesAndTimeFromQuery(query: unknown): typeof query {
    if (!query || typeof query !== "object") {
      return query;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
      if (k === "time" || k === "attributes") {
        continue;
      }
      out[k] = v;
    }
    return out as typeof query;
  }

  private stripTimeFromQuery(query: unknown): typeof query {
    if (!query || typeof query !== "object") {
      return query;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(query as Record<string, unknown>)) {
      if (k === "time") {
        continue;
      }
      out[k] = v;
    }
    return out as typeof query;
  }

  /**
   * Map a MetricsAggregationType onto the ClickHouse aggregate
   * expression used by the per-series aggregation path. Covers every
   * type the legacy in-process path supported (Sum / Count / Max / Min /
   * Avg, with unknown types falling back to Avg exactly like the JS
   * switch did) and additionally maps percentile types onto
   * `quantile(p)(value)` so P50–P99 group-by monitors aggregate
   * server-side too.
   *
   * `count(value)` (not `count()`) so rows without a scalar value
   * (histogram payload rows) are excluded, matching the in-process path
   * which only counted rows that carried a usable numeric value.
   */
  public static getPerSeriesAggregationExpression(
    aggregationType: AggregationType,
  ): string {
    switch (aggregationType) {
      case AggregationType.Sum:
        return "sum(value)";
      case AggregationType.Count:
        return "count(value)";
      case AggregationType.Max:
        return "max(value)";
      case AggregationType.Min:
        return "min(value)";
      case AggregationType.Avg:
        return "avg(value)";
      default: {
        const percentileLevel: number | null =
          getPercentileLevel(aggregationType);
        if (percentileLevel !== null) {
          return `quantile(${percentileLevel})(value)`;
        }
        // Mirror the legacy in-process fallback: unknown types -> Avg.
        return "avg(value)";
      }
    }
  }

  /**
   * Build the per-series aggregation statement:
   *
   *   SELECT <agg>(value) AS value,
   *          toStartOfMinute(time) AS seriesBucketTime,
   *          attributes[{key0}] AS seriesAttribute0, ...
   *   FROM <db>.<Metric>
   *   WHERE <query> GROUP BY seriesBucketTime, seriesAttribute0, ...
   *   ORDER BY seriesBucketTime DESC LIMIT <limit>
   *
   * Minute buckets match what the in-process fallback produced
   * (aggregatePerSeriesFromRawMetrics bucketed samples to the start of
   * their minute), so downstream formula/timestamp alignment is
   * unchanged.
   *
   * Alias-shadowing pitfall: the bucket column is deliberately aliased
   * to PER_SERIES_BUCKET_TIME_ALIAS, never `AS time` — ClickHouse
   * substitutes SELECT aliases into WHERE, which would turn the window
   * predicate into `toStartOfMinute(time) >= windowStart` and drop the
   * first partial minute of every evaluation window. See the constant's
   * doc for details.
   *
   * Map-column pitfall: @clickhouse/client's parameterized queries
   * return 0 rows when a GROUP BY references the nested `attributes`
   * Map column directly (the reason the in-process JS path existed).
   * This statement therefore never selects or groups by the Map itself:
   * every requested key is extracted as a scalar
   * `attributes[{key:String}]` expression aliased to its own named
   * column, and the GROUP BY references only those scalar aliases. The
   * `attributes[...]` subscript with a bound String parameter is the
   * same construct the WHERE generator has used safely all along.
   */
  public toPerSeriesAggregateStatement(input: {
    query: Query<Metric>;
    aggregationType: AggregationType;
    groupByAttributeKeys: Array<string>;
    limit: number;
  }): { statement: Statement; columns: Array<string> } {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const aggregationExpression: string =
      MetricService.getPerSeriesAggregationExpression(input.aggregationType);

    const whereStatement: Statement = this.statementGenerator.toWhereStatement(
      input.query,
    );

    const attributeAliases: Array<string> = input.groupByAttributeKeys.map(
      (_key: string, index: number) => {
        return `${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}${index}`;
      },
    );

    const statement: Statement = SQL``;

    statement.append(
      `SELECT ${aggregationExpression} AS value, toStartOfMinute(time) AS ${PER_SERIES_BUCKET_TIME_ALIAS}`,
    );

    for (const [index, attributeKey] of input.groupByAttributeKeys.entries()) {
      statement
        .append(
          SQL`, attributes[${{
            value: attributeKey,
            type: TableColumnType.Text,
          }}]`,
        )
        .append(` AS ${attributeAliases[index]}`);
    }

    statement.append(
      ` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `,
    );
    statement.append(whereStatement);
    statement.append(this.getRetentionReadFilter());

    statement.append(SQL` GROUP BY `).append(PER_SERIES_BUCKET_TIME_ALIAS);
    for (const alias of attributeAliases) {
      statement.append(`, ${alias}`);
    }

    /*
     * Newest buckets first so if the row cap ever bites, the most recent
     * data (what the monitor actually evaluates) survives. The LIMIT
     * also makes ClickHouse report rows_before_limit_at_least — exact
     * for GROUP BY queries — which powers truncation telemetry.
     */
    statement
      .append(SQL` ORDER BY `)
      .append(`${PER_SERIES_BUCKET_TIME_ALIAS} DESC`);

    statement.append(
      SQL` LIMIT ${{
        value: Number(input.limit),
        type: TableColumnType.Number,
      }} `,
    );

    /*
     * 45s execution cap in THROW mode (no timeout_overflow_mode —
     * ClickHouse's default 'throw' applies). Unlike the raw fetch this
     * replaced (bounded by its 10k-row LIMIT), this query scans every
     * raw row in the window before GROUP BY, so an unbounded run would
     * hold the worker until the client's ~58s request timeout while
     * leaving the query burning ClickHouse resources — matching
     * toCountStatement's rationale for the same cap. 'break' would be
     * wrong here: a partial result silently drops series from monitor
     * evaluation, whereas throwing trips the caller's capped fallback
     * (which reports its own truncation loudly).
     */
    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: 45,
        additionalSettings: {
          optimize_aggregation_in_order: 1,
          optimize_move_to_prewhere: 1,
          max_threads: 4,
        },
      }),
    );

    logger.debug(`${this.model.tableName} Per-Series Aggregate Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return {
      statement,
      columns: ["value", PER_SERIES_BUCKET_TIME_ALIAS, ...attributeAliases],
    };
  }

  /**
   * Adapt raw JSON rows from the per-series aggregation statement into
   * the AggregatedResult shape the legacy in-process path produced:
   * `{ timestamp, value, attributes }` where `attributes` carries the
   * requested group-by keys (missing keys canonicalize to "" — the same
   * value ClickHouse's Map subscript yields for absent keys, and the
   * same value MetricSeriesFingerprint uses for missing labels, so
   * series fingerprints stay stable across both paths).
   */
  public static toPerSeriesAggregatedResult(input: {
    items: Array<JSONObject>;
    groupByAttributeKeys: Array<string>;
  }): AggregatedResult {
    const rows: Array<AggregatedModel> = [];

    for (const item of input.items) {
      const rawTime: unknown = item[PER_SERIES_BUCKET_TIME_ALIAS];
      if (!rawTime || typeof rawTime !== "string") {
        continue;
      }

      let rawValue: unknown = item["value"];
      if (typeof rawValue === "string") {
        // UInt64 aggregates (count) serialize as strings in JSON output.
        rawValue = Number.parseFloat(rawValue);
      }
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
        // No usable numeric value for this bucket — same as the JS path
        // which skipped buckets with no finite samples.
        continue;
      }

      const attributes: JSONObject = {};
      for (const [
        index,
        attributeKey,
      ] of input.groupByAttributeKeys.entries()) {
        const attributeValue: unknown =
          item[`${PER_SERIES_ATTRIBUTE_ALIAS_PREFIX}${index}`];
        attributes[attributeKey] =
          attributeValue === undefined || attributeValue === null
            ? ""
            : String(attributeValue);
      }

      rows.push({
        timestamp: OneUptimeDate.fromString(rawTime),
        value: rawValue,
        attributes: attributes as AggregatedModel[string],
      });
    }

    return { data: rows };
  }

  /**
   * Per-series aggregation entirely in ClickHouse: GROUP BY the
   * requested attribute keys (extracted as scalar columns — see
   * toPerSeriesAggregateStatement for the Map-column rationale) over
   * minute buckets within whatever time window `query.time` scopes,
   * applying the requested aggregation.
   *
   * Replaces the raw-row fetch that telemetry monitors with group-by
   * keys used to run: that path was capped at LIMIT_PER_PROJECT raw
   * samples sorted time-DESC, so at fleet/cluster scale later-sorted
   * series silently vanished from evaluation. Here the cap applies to
   * aggregated rows (series × minutes) instead of raw samples, and any
   * truncation is reported back exactly via `droppedRowCount`.
   */
  public async aggregateByAttributeSeries(input: {
    query: Query<Metric>;
    aggregationType: AggregationType;
    groupByAttributeKeys: Array<string>;
    limit?: number | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<MetricPerSeriesAggregationResult> {
    const groupByAttributeKeys: Array<string> = (
      input.groupByAttributeKeys || []
    ).filter((key: string) => {
      return Boolean(key);
    });

    if (groupByAttributeKeys.length === 0) {
      throw new BadDataException(
        "aggregateByAttributeSeries requires at least one group-by attribute key",
      );
    }

    const limit: number = input.limit || PER_SERIES_AGGREGATION_MAX_ROWS;

    const permissionResult: CheckReadPermissionType<Metric> =
      await ModelPermission.checkReadPermission(
        this.modelType,
        input.query,
        {
          time: true,
          value: true,
          attributes: true,
        } as Select<Metric>,
        input.props,
      );

    const { statement } = this.toPerSeriesAggregateStatement({
      query: permissionResult.query,
      aggregationType: input.aggregationType,
      groupByAttributeKeys: groupByAttributeKeys,
      limit: limit,
    });

    const dbResult: ResultSet<"JSON"> = await this.executeQuery(statement);
    const responseJSON: ResponseJSON<JSONObject> =
      await dbResult.json<JSONObject>();
    const items: Array<JSONObject> = responseJSON.data
      ? responseJSON.data
      : [];

    const result: AggregatedResult = MetricService.toPerSeriesAggregatedResult(
      {
        items: items,
        groupByAttributeKeys: groupByAttributeKeys,
      },
    );

    /*
     * ClickHouse reports rows_before_limit_at_least whenever the query
     * carries a LIMIT; for GROUP BY queries it is the EXACT pre-LIMIT
     * row count, which makes truncation quantifiable rather than
     * silent.
     */
    const totalRowCount: number =
      typeof responseJSON.rows_before_limit_at_least === "number"
        ? responseJSON.rows_before_limit_at_least
        : items.length;
    const droppedRowCount: number = Math.max(0, totalRowCount - items.length);

    return {
      result: result,
      truncated: droppedRowCount > 0,
      droppedRowCount: droppedRowCount,
    };
  }

  private formatDateTime(d: Date): string {
    /*
     * ClickHouse's DateTime parser accepts 'YYYY-MM-DD HH:MM:SS'.
     * toISOString gives 'YYYY-MM-DDTHH:MM:SS.sssZ'; trim the milliseconds
     * and the trailing 'Z' and replace 'T' with a space.
     */
    return new Date(d).toISOString().replace("T", " ").substring(0, 19);
  }
}

export default new MetricService();
