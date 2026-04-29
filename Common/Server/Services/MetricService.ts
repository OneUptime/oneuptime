import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import Metric from "../../Models/AnalyticsModels/Metric";
import AggregateBy, {
  AggregateUtil,
} from "../Types/AnalyticsDatabase/AggregateBy";
import { SQL, Statement } from "../Utils/AnalyticsDatabase/Statement";
import {
  getPercentileLevel,
  isPercentileAggregation,
} from "../../Types/BaseDatabase/AggregationType";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import logger, { LogAttributes } from "../Utils/Logger";

export class MetricService extends AnalyticsDatabaseService<Metric> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Metric, database: clickhouseDatabase });
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
    if (!isPercentileAggregation(aggregateBy.aggregationType)) {
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
}

export default new MetricService();
