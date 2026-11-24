import { Statement } from "./Statement";

/*
 * A CLASSIC HISTOGRAM'S PERCENTILES, FROM ITS `_bucket` SERIES.
 *
 * A Prometheus classic histogram arrives as series, not as one histogram
 * point: `latency_bucket{le="0.1"}`, `{le="0.5"}`, ... `{le="+Inf"}`, each
 * a cumulative count of the observations up to its bound, beside
 * `latency_count` and `latency_sum`. Prometheus remote write stores them
 * that way (OneUptime's PrometheusRemoteWrite), and cannot do otherwise:
 * a sender shards its series over parallel requests, so one histogram's
 * buckets reach OneUptime in different requests, often at different
 * servers.
 *
 * So the histogram is put back together where it is read. For a percentile
 * of a metric whose name ends in `_bucket` (a sum or a gauge, the metric's
 * point type says; MetricService decides), the rows of one series at one
 * time - one scrape - are grouped into one histogram: the series is the
 * resource and every attribute but `le`, and `le` is each bucket's bound.
 * Its buckets, sorted by bound, are counted apart (each cumulative count
 * less the one below it) and fanned out into (midpoint, count) samples
 * exactly as an OpenTelemetry histogram point's explicit buckets are
 * (MetricService's fanout): the first bucket at half its bound, the +Inf
 * one at one and a half times the last finite bound, every other between
 * its two bounds. The same histogram sent either way charts the same
 * percentile.
 *
 * The group is a scrape, never a chart interval, so series that use
 * different bounds are each counted against their own. A row whose `le`
 * is not a number is left out, and a scrape holding nothing but +Inf has
 * no bound to place its observations at and gives no sample.
 */

// The column the grouped buckets are read from: (bound, cumulative count).
export const CLASSIC_HISTOGRAM_BUCKETS_COLUMN: string = "__classic_buckets";

// A metric name that is a classic histogram's buckets: `<family>_bucket`.
export function isClassicHistogramBucketName(name: string): boolean {
  return name.length > "_bucket".length && name.endsWith("_bucket");
}

/*
 * The (midpoint, count) samples of one grouped scrape, as an
 * Array(Tuple(Float64, Float64)) - the shape MetricService's fanout gives
 * quantileExactWeighted, which ignores nothing but rounds each count to a
 * whole one and holds a negative difference (a series that reset between
 * buckets) at zero.
 */
export function getClassicHistogramFanoutExpression(): string {
  const b: string = CLASSIC_HISTOGRAM_BUCKETS_COLUMN;

  return `
      if(
        empty(${b}) OR isInfinite(${b}[1].1),
        CAST([], 'Array(Tuple(Float64, Float64))'),
        arrayMap(
          i -> tuple(
            multiIf(
              i = 1, ${b}[1].1 / 2.0,
              isInfinite(${b}[i].1), ${b}[i - 1].1 * 1.5,
              (${b}[i - 1].1 + ${b}[i].1) / 2.0
            ),
            ${b}[i].2 - if(i = 1, 0.0, ${b}[i - 1].2)
          ),
          arrayEnumerate(${b})
        )
      )
    `;
}

/*
 * Appends the subquery the percentile reads instead of the table:
 *
 *   (SELECT <time>, <columns>, __classic_attributes AS attributes,
 *           __classic_buckets
 *    FROM (SELECT <time>, <columns>,
 *                 mapSort(mapFilter((k, v) -> k != 'le', attributes))
 *                   AS __classic_attributes,
 *                 arraySort(b -> b.1, groupArray(tuple(<le>, <value>)))
 *                   AS __classic_buckets
 *          FROM <table> WHERE TRUE <filters> AND <le is a number>
 *          GROUP BY primaryEntityId, timeUnixNano, <time>, <columns>,
 *                   __classic_attributes))
 *
 * One row a series and time, whose `attributes` are the series' own
 * (without `le`, so a grouped or sampled read sees the series' map) and
 * whose buckets the fanout reads. `columns` are the model columns the
 * percentile groups by, each the same in every bucket of a series;
 * `appendFilters` writes the caller's raw-table conditions after
 * `WHERE TRUE` (the query's, retention, a Top-K restriction).
 */
export function appendClassicHistogramBucketSource(data: {
  statement: Statement;
  table: string;
  timestampColumn: string;
  groupByColumns: ReadonlyArray<string>;
  appendFilters: (statement: Statement) => void;
}): void {
  const statement: Statement = data.statement;

  // The whole map is the series' own, below; the rest ride along as they are.
  const columns: Array<string> = [];

  for (const column of [data.timestampColumn, ...data.groupByColumns]) {
    if (column !== "attributes" && !columns.includes(column)) {
      columns.push(column);
    }
  }

  const groupBy: Array<string> = ["primaryEntityId", "timeUnixNano"];

  for (const column of columns) {
    if (!groupBy.includes(column)) {
      groupBy.push(column);
    }
  }

  groupBy.push("__classic_attributes");

  statement.append(
    `(SELECT ${columns.join(", ")}, __classic_attributes AS attributes, ${CLASSIC_HISTOGRAM_BUCKETS_COLUMN} FROM (SELECT ${columns.join(", ")}, mapSort(mapFilter((k, v) -> k != 'le', attributes)) AS __classic_attributes, arraySort(b -> b.1, groupArray(tuple(toFloat64OrZero(attributes['le']), toFloat64(coalesce(value, 0))))) AS ${CLASSIC_HISTOGRAM_BUCKETS_COLUMN} FROM ${data.table} WHERE TRUE `,
  );
  data.appendFilters(statement);
  statement.append(
    ` AND NOT isNaN(ifNull(toFloat64OrNull(attributes['le']), nan)) GROUP BY ${groupBy.join(", ")}))`,
  );
}
