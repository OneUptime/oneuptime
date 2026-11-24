import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "../../../Models/AnalyticsModels/Metric";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { predicateToQueryValue } from "../../../Types/Telemetry/TelemetrySearchQuery";
import {
  formatSloMetricQueryProblem,
  getSloMetricQueryProblem,
  ParsedSloMetricSearch,
  parseSloMetricSearch,
  SloMetricAttributeTerm,
  SloMetricKind,
  SloMetricQueryConfig,
  SloMetricQueryProblem,
} from "../../../Utils/Slo/SloMetricSli";
import { SLO_RELEASE_CHECK_VERSION_ATTRIBUTE } from "../../../Utils/Slo/SloReleaseCheck";
import {
  listRequestStepStarts,
  SLO_REQUEST_STEP_MILLISECONDS,
  SloRequestCountingRange,
  SloRequestCounts,
} from "../../../Utils/Slo/SloRequestSli";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import MetricService from "../../Services/MetricService";
import Query from "../../Types/AnalyticsDatabase/Query";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/*
 * A METRIC SLO'S GOOD AND TOTAL EVENTS, FROM ITS SERVICES' METRIC (#8445).
 *
 * The metric's points are read into series - a service, a full attribute
 * set, a temporality and a start time - and each series is turned into what
 * it added in each 5-minute step, the way Prometheus' increase() reads a
 * counter (LlmMetricUsageReader reads token counters the same way):
 *
 *   - a CUMULATIVE series' points are running totals: each point adds what
 *     it grew by since the one before it, and a point lower than the one
 *     before it is a restart from zero, so all of it is new. Its first
 *     point counts from zero only when its series started in the read
 *     range; otherwise it is the baseline the next point grows from.
 *   - a DELTA series' points are each what was added since the export
 *     before, so each point adds itself.
 *
 * A point's growth counts in the step its time falls in. The points are
 * read from SLO_METRIC_LOOKBACK_MINUTES before the range, only so the
 * range's first points have a baseline: what they added is all that is
 * counted.
 *
 * Each point is a triple - its time, its total and its good part - so the
 * two kinds share the counting:
 *
 *   - Counter (an OpenTelemetry Sum): the total is its value, and the good
 *     part is its value on a series that matches the good condition, else 0.
 *   - Histogram: the total is its count of observations, and the good part
 *     the counts of its buckets whose upper bound is at or under the value
 *     (the last bucket, which has none, never is).
 *
 * Only the SLO's services' points are read (the table is sorted by
 * project, name, service and time, so that is the first thing it reads),
 * only of the metric's own type: a counter's Sum points or a histogram's
 * Histogram points. A gauge, a summary or an exponential histogram of the
 * same name counts nothing.
 */

// How far before a range its points are read, as baselines.
export const SLO_METRIC_LOOKBACK_MINUTES: number = 30;

// How long one count of a metric's points may run before it is stopped.
export const SLO_METRIC_COUNT_TIME_LIMIT_SECONDS: number = 45;

/*
 * A bucket's upper bound read as at or under the value when it is within
 * this share of it: 0.3 stored and read back as 0.30000000000000004 is 0.3.
 */
const BOUND_TOLERANCE: number = 1e-9;

const TABLE_NAME: string = AnalyticsTableName.Metric;

const IS_CUMULATIVE_SQL: string = `ifNull(aggregationTemporality, '') = '${AggregationTemporality.Cumulative}'`;

type StepCounts = Map<number, SloRequestCounts>;

const toCount: (value: unknown) => number = (value: unknown): number => {
  const parsed: number =
    typeof value === "number" ? value : parseFloat(String(value ?? ""));

  return isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export default class SloMetricCounting {
  /*
   * The configuration the counting reads, or a BadDataException that says
   * what is wrong with it: a stored configuration OneUptime cannot count
   * with is never read as one that counts nothing.
   */
  public static getCountableConfig(
    config: SloMetricQueryConfig | null | undefined,
  ): SloMetricQueryConfig {
    const problem: SloMetricQueryProblem | null = getSloMetricQueryProblem(
      config || null,
    );

    if (problem || !config) {
      throw new BadDataException(
        problem
          ? formatSloMetricQueryProblem(problem)
          : "This SLO has no metric to count.",
      );
    }

    return config;
  }

  /*
   * Every point's growth in [from, to) as `increase`: a tuple of its time,
   * its total and its good part, one row each. The SELECT the counts are
   * summed from.
   */
  public static buildIncreasesStatement(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    config: SloMetricQueryConfig;
    range: SloRequestCountingRange;
    serviceVersion?: string | null | undefined;
  }): Statement {
    const config: SloMetricQueryConfig = SloMetricCounting.getCountableConfig(
      data.config,
    );
    const readFrom: Date = new Date(
      data.range.from.getTime() - SLO_METRIC_LOOKBACK_MINUTES * 60 * 1000,
    );

    const statement: Statement = new Statement();

    /*
     * The growth of each series: a cumulative series' steps between its
     * points (and its first point when it started in the read range), or a
     * delta series' points themselves.
     */
    statement.append(
      "SELECT arrayJoin(if(isCumulative, arrayConcat(arraySlice([seriesPoints[1]], 1, startedInRead), " +
        "arrayMap((current, previous) -> if(current.2 >= previous.2, " +
        "(current.1, current.2 - previous.2, greatest(current.3 - previous.3, 0)), " +
        "(current.1, greatest(current.2, 0), greatest(current.3, 0))), " +
        "arrayPopFront(seriesPoints), arrayPopBack(seriesPoints))), seriesPoints)) AS increase FROM (",
    );

    // Each series' points in time order, as (time, total, good part).
    statement.append("SELECT arraySort(groupArray((time, ");

    if (config.kind === SloMetricKind.Counter) {
      statement.append("toFloat64(ifNull(value, 0)), if(");
      SloMetricCounting.appendPredicate(
        statement,
        parseSloMetricSearch(config.goodFilter),
      );
      statement.append(", toFloat64(ifNull(value, 0)), 0)");
    } else {
      const bound: number =
        (config.goodAtOrUnder as number) * (1 + BOUND_TOLERANCE);

      statement.append(
        "toFloat64(ifNull(count, 0)), arraySum(arrayMap((bucketCount, bucketIndex) -> " +
          "if(bucketIndex <= length(explicitBounds) AND toFloat64(explicitBounds[bucketIndex]) <= ",
      );
      statement.append(SQL`${{ type: TableColumnType.Decimal, value: bound }}`);
      statement.append(
        ", toFloat64(bucketCount), 0), bucketCounts, arrayEnumerate(bucketCounts)))",
      );
    }

    statement.append(
      `))) AS seriesPoints, ${IS_CUMULATIVE_SQL} AS isCumulative, `,
    );
    statement.append(
      SQL`toUInt8(ifNull(min(startTime) >= ${{
        type: TableColumnType.DateTime64,
        value: readFrom,
      }}, 0)) AS startedInRead`,
    );

    statement.append(
      SQL` FROM ${TABLE_NAME} WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }} AND name = ${{
        type: TableColumnType.Text,
        value: config.metricName,
      }} AND primaryEntityId IN (${{
        type: TableColumnType.ObjectID,
        value: new Includes(data.serviceIds),
      }}) AND time >= ${{
        type: TableColumnType.DateTime64,
        value: readFrom,
      }} AND time < ${{
        type: TableColumnType.DateTime64,
        value: data.range.to,
      }} AND retentionDate >= now() AND metricPointType = ${{
        type: TableColumnType.Text,
        value:
          config.kind === SloMetricKind.Counter
            ? MetricPointType.Sum
            : MetricPointType.Histogram,
      }}`,
    );

    for (const term of parseSloMetricSearch(config.filter).terms) {
      statement.append(SloMetricCounting.toTermStatement(term));
    }

    if (data.serviceVersion) {
      statement.append(
        SQL` AND attributes[${{
          type: TableColumnType.Text,
          value: SLO_RELEASE_CHECK_VERSION_ATTRIBUTE,
        }}] = ${{ type: TableColumnType.Text, value: data.serviceVersion }}`,
      );
    }

    /*
     * One group per series: its service, its attribute set, its
     * temporality and its start time, which a restart that says so (a new
     * start time) changes.
     */
    statement.append(
      " GROUP BY primaryEntityId, aggregationTemporality, cityHash64(mapKeys(attributes), mapValues(attributes)), ifNull(startTimeUnixNano, 0))",
    );

    return statement;
  }

  /*
   * The good and total events of every step in the range. A step with no
   * events is left out here and filled with zeros by countRange.
   */
  public static buildCountStatement(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    config: SloMetricQueryConfig;
    range: SloRequestCountingRange;
  }): Statement {
    const stepSeconds: number = SLO_REQUEST_STEP_MILLISECONDS / 1000;

    const statement: Statement = SQL`SELECT intDiv(toUnixTimestamp(increase.1), ${{
      type: TableColumnType.Number,
      value: stepSeconds,
    }}) * ${{
      type: TableColumnType.Number,
      value: stepSeconds,
    }} AS stepStart, sum(greatest(increase.2, 0)) AS totalCount, sum(greatest(increase.3, 0)) AS goodCount FROM (`;

    statement.append(SloMetricCounting.buildIncreasesStatement(data));
    SloMetricCounting.appendRangeAndSettings(statement, data.range, {
      groupByStep: true,
    });

    return statement;
  }

  /*
   * The good and total events of one range, in one sum: what the release
   * check reads over its last few minutes. With a service version, only
   * the points of that release: the `resource.service.version` its
   * metric carries.
   */
  public static buildRecentCountStatement(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    config: SloMetricQueryConfig;
    range: SloRequestCountingRange;
    serviceVersion?: string | null | undefined;
  }): Statement {
    const statement: Statement = new Statement();

    statement.append(
      "SELECT sum(greatest(increase.2, 0)) AS totalCount, sum(greatest(increase.3, 0)) AS goodCount FROM (",
    );
    statement.append(SloMetricCounting.buildIncreasesStatement(data));
    SloMetricCounting.appendRangeAndSettings(statement, data.range, {
      groupByStep: false,
    });

    return statement;
  }

  public static async countRange(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    config: SloMetricQueryConfig;
    range: SloRequestCountingRange;
  }): Promise<StepCounts> {
    const counts: StepCounts = new Map<number, SloRequestCounts>();

    for (const stepStart of listRequestStepStarts(data.range)) {
      counts.set(stepStart.getTime(), { goodCount: 0, totalCount: 0 });
    }

    if (counts.size === 0 || data.serviceIds.length === 0) {
      return counts;
    }

    const rows: Array<JSONObject> = await SloMetricCounting.readRows(
      SloMetricCounting.buildCountStatement(data),
    );

    for (const row of rows) {
      const stepStartInMilliseconds: number =
        Number(row["stepStart"] ?? NaN) * 1000;

      if (!counts.has(stepStartInMilliseconds)) {
        // A point outside the range cannot be in it; never invent a step.
        continue;
      }

      counts.set(stepStartInMilliseconds, SloMetricCounting.toCounts(row));
    }

    return counts;
  }

  public static async countRecent(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    config: SloMetricQueryConfig;
    range: SloRequestCountingRange;
    serviceVersion?: string | null | undefined;
  }): Promise<SloRequestCounts> {
    if (data.serviceIds.length === 0) {
      return { goodCount: 0, totalCount: 0 };
    }

    const rows: Array<JSONObject> = await SloMetricCounting.readRows(
      SloMetricCounting.buildRecentCountStatement(data),
    );

    return rows[0]
      ? SloMetricCounting.toCounts(rows[0])
      : { goodCount: 0, totalCount: 0 };
  }

  // A row's counts: never more good events than events, never fewer than none.
  public static toCounts(row: JSONObject): SloRequestCounts {
    const totalCount: number = toCount(row["totalCount"]);

    return {
      goodCount: Math.min(totalCount, toCount(row["goodCount"])),
      totalCount: totalCount,
    };
  }

  /*
   * A boolean of every term of a search - `(1 = 1 AND ...)`, true for no
   * terms - written as the WHERE fragments the metric table's statement
   * generator builds, so each value is a typed parameter.
   */
  public static appendPredicate(
    statement: Statement,
    search: ParsedSloMetricSearch,
  ): void {
    statement.append("(1 = 1");

    for (const term of search.terms) {
      statement.append(SloMetricCounting.toTermStatement(term));
    }

    statement.append(")");
  }

  private static toTermStatement(term: SloMetricAttributeTerm): Statement {
    const query: Query<Metric> = {
      attributes: {
        [term.key]: predicateToQueryValue(term.predicate),
      },
    } as unknown as Query<Metric>;

    return SQL` `.append(
      MetricService.statementGenerator.toWhereStatement(query),
    );
  }

  private static appendRangeAndSettings(
    statement: Statement,
    range: SloRequestCountingRange,
    options: { groupByStep: boolean },
  ): void {
    statement.append(
      SQL`) WHERE increase.1 >= ${{
        type: TableColumnType.DateTime64,
        value: range.from,
      }} AND increase.1 < ${{
        type: TableColumnType.DateTime64,
        value: range.to,
      }}`,
    );

    if (options.groupByStep) {
      statement.append(" GROUP BY stepStart");
    }

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: SLO_METRIC_COUNT_TIME_LIMIT_SECONDS,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );
  }

  /*
   * The kind of point ("Sum", "Histogram", "Gauge"...) the metric's newest
   * point of the SLO's services is, in [from, to): what an SLO that counted
   * nothing says it waits for (#10027) - a gauge, which every cloud metric
   * is, has no events, and a counter counted as a histogram none of a
   * histogram's. Any kind, so the newest of whichever was sent.
   */
  public static buildNewestPointTypeStatement(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    metricName: string;
    from: Date;
    to: Date;
  }): Statement {
    return SQL`SELECT metricPointType FROM ${TABLE_NAME} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: data.projectId,
    }} AND name = ${{
      type: TableColumnType.Text,
      value: data.metricName,
    }} AND primaryEntityId IN (${{
      type: TableColumnType.ObjectID,
      value: new Includes(data.serviceIds),
    }}) AND time >= ${{
      type: TableColumnType.DateTime64,
      value: data.from,
    }} AND time < ${{
      type: TableColumnType.DateTime64,
      value: data.to,
    }} AND retentionDate >= now() ORDER BY time DESC LIMIT 1`;
  }

  public static async getNewestPointType(data: {
    projectId: ObjectID;
    serviceIds: Array<ObjectID>;
    metricName: string;
    from: Date;
    to: Date;
  }): Promise<string | null> {
    if (data.serviceIds.length === 0 || !data.metricName.trim()) {
      return null;
    }

    const rows: Array<JSONObject> = await SloMetricCounting.readRows(
      SloMetricCounting.buildNewestPointTypeStatement(data),
    );
    const pointType: unknown = rows[0]?.["metricPointType"];

    return typeof pointType === "string" && pointType ? pointType : null;
  }

  private static async readRows(
    statement: Statement,
  ): Promise<Array<JSONObject>> {
    const result: Results = await MetricService.executeQuery(statement);

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return response.data || [];
  }
}
