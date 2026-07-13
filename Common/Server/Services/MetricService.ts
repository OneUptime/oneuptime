import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import { ResponseJSON, ResultSet } from "@clickhouse/client";
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
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import { keyForHost } from "../../Utils/Telemetry/EntityKey";
import ObjectID from "../../Types/ObjectID";
import logger, { LogAttributes } from "../Utils/Logger";

/*
 * Metric point types whose rows carry a pre-aggregated distribution
 * (count/sum/min/max + buckets) instead of a single observation. For
 * these rows the `value` column holds the datapoint's SUM of all
 * observations in the export interval (see OtelMetricsIngestService's
 * buildMetricRow: value = asInt ?? asDouble ?? sum), so aggregating
 * `value` directly produces sum-scale numbers — e.g. "Avg of
 * http.client.request.duration" would return ~110s for a service whose
 * true mean latency is 0.586s at ~188 requests per export interval.
 */
const DISTRIBUTION_POINT_TYPES: ReadonlyArray<string> = [
  "Histogram",
  "ExponentialHistogram",
  "Summary",
];

const MAX_GROUP_BY_ATTRIBUTE_KEYS: number = 10;
const MAX_GROUP_BY_ATTRIBUTE_KEY_LENGTH: number = 256;

const POINT_TYPE_CACHE_TTL_MS: number = 10 * 60 * 1000;
const POINT_TYPE_CACHE_MAX_ENTRIES: number = 5000;

export class MetricService extends AnalyticsDatabaseService<Metric> {
  /*
   * (projectId|metricName) -> metricPointType, resolved lazily on the
   * aggregate path so scalar aggregations of distribution metrics can
   * skip the MVs (whose states collapse `value` — the histogram sum)
   * and use the count-weighted expressions instead. Bounded + TTL'd so
   * a tenant churning metric names can't grow it without limit.
   */
  private metricPointTypeCache: Map<
    string,
    { pointType: string | null; expiresAt: number }
  > = new Map();

  /*
   * Point-type hint per aggregateBy call. toAggregateStatement is a
   * synchronous override, so the async lookup happens in aggregateBy
   * and is handed over keyed on the (shared) aggregateBy object.
   */
  private pointTypeHintByAggregate: WeakMap<
    AggregateBy<Metric>,
    string | null
  > = new WeakMap();

  private inFlightPointTypeLookups: Map<string, Promise<string | null>> =
    new Map();

  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: Metric, database: clickhouseDatabase });
  }

  public override async aggregateBy(
    aggregateBy: AggregateBy<Metric>,
  ): Promise<AggregatedResult> {
    /*
     * Only scalar aggregations over `value` need the point type — the
     * percentile path is already distribution-aware via the bucket
     * fanout, and MV routing is the only decision the hint drives.
     * Grouped queries (model-column or attribute-key) never route to
     * the MVs, so the lookup would be dead weight there.
     */
    if (
      !isPercentileAggregation(aggregateBy.aggregationType) &&
      aggregateBy.aggregateColumnName.toString() === "value" &&
      (!aggregateBy.groupBy || Object.keys(aggregateBy.groupBy).length === 0) &&
      (!aggregateBy.groupByAttributeKeys ||
        aggregateBy.groupByAttributeKeys.length === 0)
    ) {
      const pointType: string | null =
        await this.resolveMetricPointType(aggregateBy);
      this.pointTypeHintByAggregate.set(aggregateBy, pointType);
    }

    return super.aggregateBy(aggregateBy);
  }

  private async resolveMetricPointType(
    aggregateBy: AggregateBy<Metric>,
  ): Promise<string | null> {
    const metricName: string | null = this.getExactMetricNameFromQuery(
      aggregateBy.query,
    );
    if (!metricName) {
      return null;
    }

    const queryRecord: Record<string, unknown> =
      (aggregateBy.query as unknown as Record<string, unknown>) || {};
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

    const cacheKey: string = `${projectId}|${metricName}`;
    const cached: { pointType: string | null; expiresAt: number } | undefined =
      this.metricPointTypeCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.pointType;
    }

    /*
     * Coalesce concurrent misses: a dashboard refresh fires many
     * aggregates for the same metric at once; without this every one
     * of them would issue the same lookup before any could populate
     * the cache.
     */
    const inFlight: Promise<string | null> | undefined =
      this.inFlightPointTypeLookups.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const lookup: Promise<string | null> = this.lookupMetricPointType(
      aggregateBy,
      projectId,
      metricName,
    )
      .then((pointType: string | null) => {
        this.evictExpiredPointTypeCacheEntries();
        this.metricPointTypeCache.set(cacheKey, {
          pointType,
          expiresAt: Date.now() + POINT_TYPE_CACHE_TTL_MS,
        });
        return pointType;
      })
      .finally(() => {
        this.inFlightPointTypeLookups.delete(cacheKey);
      });

    this.inFlightPointTypeLookups.set(cacheKey, lookup);
    return lookup;
  }

  private async lookupMetricPointType(
    aggregateBy: AggregateBy<Metric>,
    projectId: string,
    metricName: string,
  ): Promise<string | null> {
    try {
      if (!this.database) {
        this.useDefaultDatabase();
      }
      const databaseName: string =
        this.database.getDatasourceOptions().database!;

      const statement: Statement = SQL`SELECT metricPointType FROM `;
      statement.append(`${databaseName}.${this.model.tableName}`);
      statement.append(
        SQL` WHERE projectId = ${{
          value: projectId,
          type: TableColumnType.ObjectID,
        }} AND name = ${{
          value: metricName,
          type: TableColumnType.Text,
        }} AND isNotNull(metricPointType)`,
      );

      /*
       * Bound the lookup to the aggregation's own window so ClickHouse
       * can prune daily partitions (the table partitions on
       * toYYYYMMDD(time)); without this the LIMIT 1 seek could touch
       * every partition in retention for a metric with all-null point
       * types. The point type is stable per metric name, so any window
       * that has data answers correctly.
       */
      if (aggregateBy.startTimestamp && aggregateBy.endTimestamp) {
        statement.append(
          ` AND time >= toDateTime('${this.formatDateTime(
            aggregateBy.startTimestamp,
          )}') AND time <= toDateTime('${this.formatDateTime(
            aggregateBy.endTimestamp,
          )}')`,
        );
      }

      statement.append(SQL` LIMIT 1`);

      const dbResult: ResultSet<"JSON"> = await this.executeQuery(statement);
      const responseJSON: ResponseJSON<JSONObject> =
        await dbResult.json<JSONObject>();
      const row: JSONObject | undefined = (responseJSON.data || [])[0];
      const rawPointType: unknown = row ? row["metricPointType"] : undefined;
      return typeof rawPointType === "string" ? rawPointType : null;
    } catch (err) {
      /*
       * Lookup failures must not fail the aggregation — fall back to
       * the (possibly MV-served) scalar path, which is today's
       * behavior for unknown point types.
       */
      logger.debug("Metric point type lookup failed");
      logger.debug(err);
      return null;
    }
  }

  private evictExpiredPointTypeCacheEntries(): void {
    if (this.metricPointTypeCache.size < POINT_TYPE_CACHE_MAX_ENTRIES) {
      return;
    }
    const now: number = Date.now();
    for (const [key, entry] of this.metricPointTypeCache) {
      if (entry.expiresAt <= now) {
        this.metricPointTypeCache.delete(key);
      }
    }
    /*
     * Still full after dropping expired entries: evict oldest-inserted
     * until under the cap (Map preserves insertion order). Never
     * clear() — that would stampede every active dashboard into
     * re-issuing its lookup at once.
     */
    while (this.metricPointTypeCache.size >= POINT_TYPE_CACHE_MAX_ENTRIES) {
      const oldestKey: string | undefined = this.metricPointTypeCache
        .keys()
        .next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.metricPointTypeCache.delete(oldestKey);
    }
  }

  private isDistributionMetricAggregate(
    aggregateBy: AggregateBy<Metric>,
  ): boolean {
    const pointType: string | null | undefined =
      this.pointTypeHintByAggregate.get(aggregateBy);
    return Boolean(pointType && DISTRIBUTION_POINT_TYPES.includes(pointType));
  }

  /**
   * Validated, deduplicated attribute keys to group the aggregation by.
   * Keys are bound as query parameters wherever they reach SQL, so this
   * is shape validation (not injection defense): drop non-strings and
   * empties, cap key length and count.
   */
  private getSanitizedGroupByAttributeKeys(
    aggregateBy: AggregateBy<Metric>,
  ): Array<string> {
    const keys: Array<string> = [];
    for (const rawKey of aggregateBy.groupByAttributeKeys || []) {
      if (typeof rawKey !== "string") {
        continue;
      }
      const key: string = rawKey.trim();
      if (
        !key ||
        key.length > MAX_GROUP_BY_ATTRIBUTE_KEY_LENGTH ||
        keys.includes(key)
      ) {
        continue;
      }
      keys.push(key);
    }

    if (keys.length > MAX_GROUP_BY_ATTRIBUTE_KEYS) {
      throw new BadDataException(
        `A maximum of ${MAX_GROUP_BY_ATTRIBUTE_KEYS} group-by attribute keys is supported.`,
      );
    }

    return keys;
  }

  /**
   * Appends `, attributes[{key}] AS __attr_grp_<i>` for every group-by
   * attribute key. Used in the (inner) SELECT so the outer/main query
   * can group on and re-project the extracted values.
   */
  private appendAttributeGroupExtractionColumns(
    statement: Statement,
    attributeGroupKeys: Array<string>,
  ): void {
    attributeGroupKeys.forEach((key: string, index: number) => {
      statement.append(`, `);
      statement.append(
        SQL`attributes[${{ value: key, type: TableColumnType.Text }}]`,
      );
      statement.append(` AS __attr_grp_${index}`);
    });
  }

  /**
   * Appends `, map({key0}, __attr_grp_0, ...) AS attributes` so grouped
   * rows return exactly the selected keys as an attributes map — the
   * same shape series splitters already read (`row.attributes[key]`).
   */
  private appendAttributeGroupMapColumn(
    statement: Statement,
    attributeGroupKeys: Array<string>,
  ): void {
    if (attributeGroupKeys.length === 0) {
      return;
    }
    statement.append(`, map(`);
    attributeGroupKeys.forEach((key: string, index: number) => {
      if (index > 0) {
        statement.append(`, `);
      }
      statement.append(SQL`${{ value: key, type: TableColumnType.Text }}`);
      statement.append(`, __attr_grp_${index}`);
    });
    statement.append(`) AS attributes`);
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

    const attributeGroupKeys: Array<string> =
      this.getSanitizedGroupByAttributeKeys(aggregateBy);

    if (!isPercentileAggregation(aggregateBy.aggregationType)) {
      /*
       * Try the per-host MV first — host detail pages are the
       * dominant attribute-filtered path and the per-host MV is
       * the only one that can serve them. If it doesn't apply
       * (no host filter, or extra attrs/groupBy), fall through
       * to the project/primaryEntityId MV, then to the base table.
       *
       * Distribution metrics (histograms/summaries) must skip the
       * MVs entirely: their states collapse `value`, which for
       * distribution rows is the datapoint SUM — merging those can
       * only ever produce sum-scale results. The base-table builder
       * below weights by the datapoint `count` instead.
       */
      if (
        attributeGroupKeys.length === 0 &&
        !this.isDistributionMetricAggregate(aggregateBy)
      ) {
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
      }

      if (
        aggregateBy.aggregateColumnName.toString() === "value" &&
        aggregateBy.aggregationTimestampColumnName.toString() === "time"
      ) {
        return this.buildScalarAggregateStatement(
          aggregateBy,
          attributeGroupKeys,
        );
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
    const resolvedInterval: AggregationInterval =
      AggregateUtil.getAggregationInterval({
        startDate: aggregateBy.startTimestamp!,
        endDate: aggregateBy.endTimestamp!,
        aggregationInterval: aggregateBy.aggregationInterval,
      });
    const bucketByTime: boolean =
      !AggregateUtil.isTotalAggregation(resolvedInterval);

    /*
     * Group-by columns from the caller need to be carried through the
     * inner subquery so the outer GROUP BY can reference them. Only
     * columns that exist on the model are accepted (matches the base
     * generator's safety net). A whole-map `attributes` group-by is
     * dropped when key-scoped grouping is requested — keeping both
     * would fragment the series again and collide with the
     * `map(...) AS attributes` projection.
     */
    const groupByKeys: Array<string> = [];
    if (aggregateBy.groupBy) {
      for (const key of Object.keys(aggregateBy.groupBy)) {
        if (!this.model.getTableColumn(key)) {
          continue;
        }
        if (key === "attributes" && attributeGroupKeys.length > 0) {
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
      `SELECT quantileExactWeighted(${percentileLevel})(__pcl_pair.1, toUInt64(greatest(0, round(__pcl_pair.2)))) as ${aggregationColumn}, ${AggregateUtil.buildBucketTimestampSelect(resolvedInterval, aggregationTimestampColumn)}`,
    );

    for (const key of groupByKeys) {
      statement.append(`, ${key}`);
    }

    /*
     * Attribute-key grouping: the inner subquery extracts each selected
     * key into `__attr_grp_<i>`; the outer query groups on those and
     * folds them back into a per-row `attributes` map so the result
     * shape matches what series splitters read. Grouping happens on the
     * individual keys — NOT the whole attributes map, which would
     * fragment the quantile into one near-constant series per unique
     * attribute combination.
     */
    this.appendAttributeGroupMapColumn(statement, attributeGroupKeys);

    statement.append(SQL` FROM (`);
    statement.append(`SELECT ${innerSelectClause}`);
    this.appendAttributeGroupExtractionColumns(statement, attributeGroupKeys);
    statement.append(
      ` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `,
    );
    statement.append(whereStatement);
    statement.append(this.getRetentionReadFilter());
    statement.append(SQL`) `);

    /*
     * `None` collapses the window into one row per group: the timestamp
     * becomes an aggregate (`min(...)`) and drops out of GROUP BY, and
     * when nothing else is grouped the clause is omitted entirely.
     */
    const percentileGroupByTerms: Array<string> = [];
    if (bucketByTime) {
      percentileGroupByTerms.push(aggregationTimestampColumn);
    }
    for (const key of groupByKeys) {
      percentileGroupByTerms.push(key);
    }
    attributeGroupKeys.forEach((_key: string, index: number) => {
      percentileGroupByTerms.push(`__attr_grp_${index}`);
    });
    if (percentileGroupByTerms.length > 0) {
      statement
        .append(SQL` GROUP BY `)
        .append(percentileGroupByTerms.join(", "));
    } else {
      /*
       * Group-less None: suppress the single phantom row an empty window
       * would otherwise return (min(time) → 1970 epoch). Only reachable
       * under None — a bucketed query always groups by the time column.
       */
      statement.append(SQL` HAVING count() > 0`);
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
      ...(attributeGroupKeys.length > 0 ? ["attributes"] : []),
    ];

    logger.debug(`${this.model.tableName} Percentile Aggregate Statement`, {
      tableName: this.model.tableName,
    } as LogAttributes);
    logger.debug(statement, {
      tableName: this.model.tableName,
    } as LogAttributes);

    return { statement, columns };
  }

  /**
   * Distribution-aware per-bucket expression for scalar aggregations
   * over `value`. Distribution rows (histogram/summary — identified by
   * a non-null `count`) carry the datapoint's observation total in
   * `sum` (mirrored into `value` at ingest) and the observation count
   * in `count`, so:
   *
   *   Avg   -> sum(sum) / sum(count)   (count-weighted mean of
   *            observations, not the mean of per-export-interval sums)
   *   Sum   -> sum(sum)                (total of all observations)
   *   Count -> sum(count)              (number of observations, not
   *            the number of export intervals)
   *   Min   -> min(min), falling back to the datapoint mean when the
   *            optional OTLP min is absent
   *   Max   -> max(max), same fallback
   *
   * Scalar rows (Sum/Gauge points — `count` is null) degrade to the
   * plain value semantics these aggregations always had: each row is
   * one observation of `value` with weight 1.
   */
  private getDistributionAwareAggregationExpression(
    aggregationType: AggregationType,
    column: string,
  ): string {
    const distRowCondition: string = `isNotNull(count) AND isNotNull(coalesce(sum, ${column}))`;
    const observationTotalExpression: string = `sum(multiIf(${distRowCondition}, toFloat64(coalesce(sum, ${column})), isNotNull(${column}), toFloat64(${column}), 0))`;
    const observationCountExpression: string = `sum(multiIf(${distRowCondition}, toFloat64(count), isNotNull(${column}), 1, 0))`;
    const datapointMeanExpression: string = `toFloat64(coalesce(sum, ${column})) / toFloat64(count)`;

    switch (aggregationType) {
      case AggregationType.Sum:
        return observationTotalExpression;
      case AggregationType.Count:
        return observationCountExpression;
      case AggregationType.Avg:
        return `if(${observationCountExpression} = 0, 0, ${observationTotalExpression} / ${observationCountExpression})`;
      case AggregationType.Min:
        return `min(multiIf(isNotNull(min), toFloat64(min), ${distRowCondition} AND count > 0, ${datapointMeanExpression}, isNotNull(${column}), toFloat64(${column}), NULL))`;
      case AggregationType.Max:
        return `max(multiIf(isNotNull(max), toFloat64(max), ${distRowCondition} AND count > 0, ${datapointMeanExpression}, isNotNull(${column}), toFloat64(${column}), NULL))`;
      default:
        return `${aggregationType.toLocaleLowerCase()}(${column})`;
    }
  }

  /**
   * Base-table statement for non-percentile aggregations over `value`,
   * used whenever the MV fast paths don't apply (attribute filters,
   * group-by, or a distribution metric). Compared to the generic
   * statement in AnalyticsDatabaseService this adds:
   *
   *   - distribution-aware aggregation expressions (see
   *     getDistributionAwareAggregationExpression), and
   *   - grouping by individual attribute keys via
   *     `attributes['<key>']` (aliased and re-projected as a compact
   *     `attributes` map), which GroupBy<Metric> cannot express since
   *     it only references whole model columns.
   *
   * Model-column group-bys (including the legacy whole-map
   * `groupBy: { attributes: true }` used by the infra pages) are
   * carried through unchanged, appended as raw identifiers exactly
   * like the percentile path does.
   */
  private buildScalarAggregateStatement(
    aggregateBy: AggregateBy<Metric>,
    attributeGroupKeys: Array<string>,
  ): { statement: Statement; columns: Array<string> } {
    if (!this.database) {
      this.useDefaultDatabase();
    }

    const databaseName: string = this.database.getDatasourceOptions().database!;

    const aggregationColumn: string =
      aggregateBy.aggregateColumnName.toString();
    const aggregationTimestampColumn: string =
      aggregateBy.aggregationTimestampColumnName.toString();
    const resolvedInterval: AggregationInterval =
      AggregateUtil.getAggregationInterval({
        startDate: aggregateBy.startTimestamp!,
        endDate: aggregateBy.endTimestamp!,
        aggregationInterval: aggregateBy.aggregationInterval,
      });
    const bucketByTime: boolean =
      !AggregateUtil.isTotalAggregation(resolvedInterval);

    const groupByKeys: Array<string> = [];
    if (aggregateBy.groupBy) {
      for (const key of Object.keys(aggregateBy.groupBy)) {
        if (!this.model.getTableColumn(key)) {
          continue;
        }
        /*
         * Key-scoped grouping supersedes a whole-map `attributes`
         * group-by: keeping both would fragment the series again AND
         * collide with the `map(...) AS attributes` projection below.
         */
        if (key === "attributes" && attributeGroupKeys.length > 0) {
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

    const aggregationExpression: string =
      this.getDistributionAwareAggregationExpression(
        aggregateBy.aggregationType,
        aggregationColumn,
      );

    const statement: Statement = SQL``;

    statement.append(
      `SELECT ${aggregationExpression} as ${aggregationColumn}, ${AggregateUtil.buildBucketTimestampSelect(resolvedInterval, aggregationTimestampColumn)}`,
    );
    for (const key of groupByKeys) {
      statement.append(`, ${key}`);
    }
    this.appendAttributeGroupMapColumn(statement, attributeGroupKeys);

    if (attributeGroupKeys.length > 0) {
      /*
       * Subquery form: extract the selected keys into `__attr_grp_<i>`
       * one level down so the outer `map(...) AS attributes` alias can
       * never shadow (or cycle with) the real `attributes` column the
       * extraction and WHERE filters read. Mirrors the percentile path.
       */
      const innerColumns: Array<string> = [
        aggregationTimestampColumn,
        "value",
        "sum",
        "count",
        "min",
        "max",
      ];
      for (const key of groupByKeys) {
        if (!innerColumns.includes(key)) {
          innerColumns.push(key);
        }
      }

      statement.append(SQL` FROM (`);
      statement.append(`SELECT ${innerColumns.join(", ")}`);
      this.appendAttributeGroupExtractionColumns(statement, attributeGroupKeys);
      statement.append(
        ` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `,
      );
      statement.append(whereStatement);
      statement.append(this.getRetentionReadFilter());
      statement.append(SQL`) `);
    } else {
      statement.append(
        ` FROM ${databaseName}.${this.model.tableName} WHERE TRUE `,
      );
      statement.append(whereStatement);
      statement.append(this.getRetentionReadFilter());
    }

    /*
     * `None` drops the time bucket from GROUP BY (it becomes an
     * aggregate `min(...)`), leaving one row per group — or a single
     * global row when nothing else is grouped, in which case the GROUP
     * BY clause is omitted entirely.
     */
    const scalarGroupByTerms: Array<string> = [];
    if (bucketByTime) {
      scalarGroupByTerms.push(aggregationTimestampColumn);
    }
    for (const key of groupByKeys) {
      scalarGroupByTerms.push(key);
    }
    attributeGroupKeys.forEach((_key: string, index: number) => {
      scalarGroupByTerms.push(`__attr_grp_${index}`);
    });
    if (scalarGroupByTerms.length > 0) {
      statement.append(SQL` GROUP BY `).append(scalarGroupByTerms.join(", "));
    } else {
      /*
       * Group-less None: suppress the single phantom row an empty window
       * would otherwise return (min(time) → 1970 epoch). Only reachable
       * under None — a bucketed query always groups by the time column.
       */
      statement.append(SQL` HAVING count() > 0`);
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
      ...(attributeGroupKeys.length > 0 ? ["attributes"] : []),
    ];

    logger.debug(`${this.model.tableName} Scalar Aggregate Statement`, {
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

    /*
     * Mirror the base builder's None handling: the SELECT above (shared
     * toAggregateSelectStatement) already emits `min(time)` for a `None`
     * interval, so the time column must NOT appear in GROUP BY — grouping
     * by an aggregate alias is a ClickHouse error. Omit the clause
     * entirely when nothing else is grouped.
     */
    const mutableResolvedInterval: AggregationInterval =
      AggregateUtil.getAggregationInterval({
        startDate: aggregateBy.startTimestamp!,
        endDate: aggregateBy.endTimestamp!,
        aggregationInterval: aggregateBy.aggregationInterval,
      });
    const mutableBucketByTime: boolean = !AggregateUtil.isTotalAggregation(
      mutableResolvedInterval,
    );
    const mutableHasGroupBy: boolean = Boolean(
      aggregateBy.groupBy && Object.keys(aggregateBy.groupBy).length > 0,
    );

    if (mutableBucketByTime) {
      statement
        .append(SQL` GROUP BY `)
        .append(`${aggregateBy.aggregationTimestampColumnName.toString()}`);
      if (mutableHasGroupBy) {
        statement
          .append(SQL` , `)
          .append(
            this.statementGenerator.toGroupByStatement(aggregateBy.groupBy!),
          );
      }
    } else if (mutableHasGroupBy) {
      statement
        .append(SQL` GROUP BY `)
        .append(
          this.statementGenerator.toGroupByStatement(aggregateBy.groupBy!),
        );
    }

    /*
     * Group-less None: suppress the single phantom row an empty window
     * would otherwise return (min(time) → 1970 epoch). No-op for bucketed
     * or grouped queries.
     */
    if (!mutableBucketByTime && !mutableHasGroupBy) {
      statement.append(SQL` HAVING count() > 0`);
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
    if (
      aggregateBy.groupByAttributeKeys &&
      aggregateBy.groupByAttributeKeys.length > 0
    ) {
      return false;
    }

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
      aggregationInterval: aggregateBy.aggregationInterval,
    });
    /*
     * The MV is bucketed at 1 minute, so every time-bucketed interval
     * (Minute / Hour / Day / Week / Month / Year) is >= MV resolution and
     * acceptable — the honored interval flows into the date_trunc below.
     * `None` (whole-window, no bucketing) is the one exception: fall back
     * to the raw-table builder, which knows how to collapse the window.
     */
    if (AggregateUtil.isTotalAggregation(interval)) {
      return null;
    }

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

    if (
      aggregateBy.groupByAttributeKeys &&
      aggregateBy.groupByAttributeKeys.length > 0
    ) {
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

    if (
      aggregateBy.groupByAttributeKeys &&
      aggregateBy.groupByAttributeKeys.length > 0
    ) {
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
      aggregationInterval: aggregateBy.aggregationInterval,
    });
    /*
     * `None` (whole-window, no bucketing) is not served by this
     * time-bucketed per-host MV — fall back to the raw-table builder.
     * Every other interval is >= the MV's 1-minute resolution and flows
     * into the date_trunc below.
     */
    if (AggregateUtil.isTotalAggregation(interval)) {
      return null;
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
