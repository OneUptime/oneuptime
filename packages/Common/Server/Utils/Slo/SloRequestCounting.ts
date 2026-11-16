import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import {
  SLO_REQUEST_STEP_MILLISECONDS,
  SloRequestCountingPlan,
  SloRequestCountingRange,
  SloRequestCountSeries,
  SloRequestCounts,
  getCountedWindowStart,
  listRequestStepStarts,
  planRequestCounting,
} from "../../../Utils/Slo/SloRequestSli";
import { SLO_RELEASE_CHECK_VERSION_ATTRIBUTE } from "../../../Utils/Slo/SloReleaseCheck";
import {
  DbJSONResponse,
  Results,
} from "../../Services/AnalyticsDatabaseService";
import SloHistoryService, {
  SloHistoryRow,
} from "../../Services/SloHistoryService";
import SpanService from "../../Services/SpanService";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { getQuerySettings } from "../AnalyticsDatabase/QuerySettingsHelper";
import logger, { LogAttributes } from "../Logger";
import crypto from "crypto";

/*
 * COUNTING A REQUEST SLO'S REQUESTS - the server half of
 * Utils/Slo/SloRequestSli, which says what is counted and when.
 *
 * Each evaluation of a Request Success or Request Latency SLO:
 *
 *   1. plans which 5-minute steps to count (planRequestCounting),
 *   2. counts the good and total requests of each step from the spans of the
 *      SLO's services (one GROUP BY over the newest steps, then a few older
 *      pieces while time allows),
 *   3. keeps those counts in SloHistory, one "good.count" and one
 *      "total.count" row per step - zeros included, so a step counted again
 *      after the SLO's services changed replaces what was there,
 *   4. sums every window the evaluation needs (the compliance window, the
 *      current burn rate's hour, each burn rate rule's two windows).
 *
 * Step 4 reads the steps counted on earlier evaluations from SloHistory,
 * and adds the steps this evaluation just counted from memory: SloHistory
 * takes its rows as an asynchronous insert, so a row written a moment ago is
 * not always readable yet, and the newest steps are exactly the ones a burn
 * rate's short window needs.
 */

// How long one count of spans may run before it is stopped.
export const SLO_REQUEST_COUNT_TIME_LIMIT_SECONDS: number = 45;

/*
 * Older pieces are counted until this much time has gone on them in one
 * evaluation: the worker measures every SLO in turn, so a busy project's
 * history is filled in over several evaluations rather than in one long one.
 */
export const SLO_REQUEST_BACKFILL_TIME_BUDGET_MILLISECONDS: number = 5000;

export interface SloRequestCountingConfig {
  sliType: SliType;
  serviceIds: Array<ObjectID>;
  // Request Latency only.
  latencyThresholdInMilliseconds?: number | undefined | null;
}

// What an evaluation counted, and the sums it needs.
export interface SloRequestMeasurement {
  firstAccumulatedBucketStartAt: Date;
  lastAccumulatedBucketEndAt: Date;
  fingerprint: string;
  isRestart: boolean;
  // One per window start asked for, each summed up to lastAccumulatedBucketEndAt.
  windowCounts: Array<SloRequestCounts>;
}

type StepCounts = Map<number, SloRequestCounts>;

export default class SloRequestCounting {
  /*
   * What the counts are counted for. A Request Success SLO's latency
   * threshold plays no part, so editing it does not start the counting again.
   */
  public static getFingerprint(config: SloRequestCountingConfig): string {
    const serviceIds: Array<string> = Array.from(
      new Set(
        config.serviceIds.map((serviceId: ObjectID): string => {
          return serviceId.toString();
        }),
      ),
    ).sort();

    const threshold: number | null =
      config.sliType === SliType.RequestLatency
        ? Number(config.latencyThresholdInMilliseconds) || null
        : null;

    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          version: 1,
          sliType: config.sliType,
          serviceIds: serviceIds,
          latencyThresholdInMilliseconds: threshold,
        }),
      )
      .digest("hex");
  }

  /*
   * The good and total requests of every step in the range, from the spans
   * (appendRequestFilters says which, appendBadCount which are bad). A step
   * with no requests is left out here and filled with zeros by countRange.
   */
  public static buildCountStatement(data: {
    projectId: ObjectID;
    config: SloRequestCountingConfig;
    range: SloRequestCountingRange;
  }): Statement {
    const stepSeconds: number = SLO_REQUEST_STEP_MILLISECONDS / 1000;

    const statement: Statement = SQL`
      SELECT
        intDiv(toUnixTimestamp(startTime), ${{
          type: TableColumnType.Number,
          value: stepSeconds,
        }}) * ${{
          type: TableColumnType.Number,
          value: stepSeconds,
        }} AS stepStart,
        count() AS totalCount,
    `;

    SloRequestCounting.appendBadCount(statement, data.config);
    SloRequestCounting.appendRequestFilters(statement, {
      projectId: data.projectId,
      config: data.config,
      range: data.range,
      serviceVersion: null,
    });

    statement.append(" GROUP BY stepStart");

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: SLO_REQUEST_COUNT_TIME_LIMIT_SECONDS,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  /*
   * The good and total requests of one range, in one count: what the release
   * check reads over its last few minutes, from the spans as they are now -
   * a check during a rollout cannot wait for steps to settle. With a
   * service version, only the requests of that release: the
   * `resource.service.version` its spans carry (the canary's).
   */
  public static buildRecentCountStatement(data: {
    projectId: ObjectID;
    config: SloRequestCountingConfig;
    range: SloRequestCountingRange;
    serviceVersion?: string | null | undefined;
  }): Statement {
    const statement: Statement = SQL`SELECT count() AS totalCount, `;

    SloRequestCounting.appendBadCount(statement, data.config);
    SloRequestCounting.appendRequestFilters(statement, {
      projectId: data.projectId,
      config: data.config,
      range: data.range,
      serviceVersion: data.serviceVersion || null,
    });

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: SLO_REQUEST_COUNT_TIME_LIMIT_SECONDS,
        timeoutOverflowMode: "throw",
        boundScanMemory: true,
      }),
    );

    return statement;
  }

  public static async countRecentRequests(data: {
    projectId: ObjectID;
    config: SloRequestCountingConfig;
    range: SloRequestCountingRange;
    serviceVersion?: string | null | undefined;
  }): Promise<SloRequestCounts> {
    const result: Results = await SpanService.executeQuery(
      SloRequestCounting.buildRecentCountStatement(data),
    );

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const row: JSONObject | undefined = rows[0];

    const totalCount: number = toCount(row?.["totalCount"]);
    const badCount: number = Math.min(totalCount, toCount(row?.["badCount"]));

    return {
      goodCount: totalCount - badCount,
      totalCount: totalCount,
    };
  }

  /*
   * A request is bad when its status is Error (Request Success), or when it
   * took longer than the threshold (Request Latency). `statusCode = 2` is
   * false for a span with no status, so an Unset span counts as good, as
   * OpenTelemetry means it to.
   */
  private static appendBadCount(
    statement: Statement,
    config: SloRequestCountingConfig,
  ): void {
    if (config.sliType === SliType.RequestLatency) {
      statement.append(
        SQL`countIf(durationUnixNano > ${{
          type: TableColumnType.LongNumber,
          value: SloRequestCounting.getThresholdInNanoseconds(config),
        }}) AS badCount`,
      );
      return;
    }

    statement.append(
      SQL`countIf(statusCode = ${{
        type: TableColumnType.Number,
        value: SpanStatus.Error,
      }}) AS badCount`,
    );
  }

  /*
   * Which spans are the SLO's requests: entry spans of its services (the
   * requests the traces list shows by default), in the range, still within
   * their retention - and, for a release check, of one version.
   */
  private static appendRequestFilters(
    statement: Statement,
    data: {
      projectId: ObjectID;
      config: SloRequestCountingConfig;
      range: SloRequestCountingRange;
      serviceVersion: string | null;
    },
  ): void {
    statement.append(
      SQL`
      FROM ${AnalyticsTableName.Span}
      WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: data.projectId,
      }}
        AND startTime >= ${{
          type: TableColumnType.DateTime64,
          value: data.range.from,
        }}
        AND startTime < ${{
          type: TableColumnType.DateTime64,
          value: data.range.to,
        }}
        AND isEntrySpan = 1
        AND primaryEntityId IN (${{
          type: TableColumnType.ObjectID,
          value: new Includes(
            data.config.serviceIds.map((serviceId: ObjectID): string => {
              return serviceId.toString();
            }),
          ),
        }})
        AND retentionDate >= now()`,
    );

    if (data.serviceVersion) {
      statement.append(
        SQL`
        AND attributes[${{
          type: TableColumnType.Text,
          value: SLO_RELEASE_CHECK_VERSION_ATTRIBUTE,
        }}] = ${{
          type: TableColumnType.Text,
          value: data.serviceVersion,
        }}`,
      );
    }
  }

  public static async countRange(data: {
    projectId: ObjectID;
    config: SloRequestCountingConfig;
    range: SloRequestCountingRange;
  }): Promise<StepCounts> {
    const counts: StepCounts = new Map<number, SloRequestCounts>();

    for (const stepStart of listRequestStepStarts(data.range)) {
      counts.set(stepStart.getTime(), { goodCount: 0, totalCount: 0 });
    }

    if (counts.size === 0) {
      return counts;
    }

    const result: Results = await SpanService.executeQuery(
      SloRequestCounting.buildCountStatement(data),
    );

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];

    for (const row of rows) {
      const stepStartInMilliseconds: number =
        Number(row["stepStart"] ?? NaN) * 1000;

      if (!counts.has(stepStartInMilliseconds)) {
        // A span outside the range cannot be in it; never invent a step.
        continue;
      }

      const totalCount: number = toCount(row["totalCount"]);
      const badCount: number = Math.min(totalCount, toCount(row["badCount"]));

      counts.set(stepStartInMilliseconds, {
        goodCount: totalCount - badCount,
        totalCount: totalCount,
      });
    }

    return counts;
  }

  public static toHistoryRows(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    counts: StepCounts;
  }): Array<SloHistoryRow> {
    const rows: Array<SloHistoryRow> = [];

    const stepStarts: Array<number> = Array.from(data.counts.keys()).sort(
      (a: number, b: number): number => {
        return a - b;
      },
    );

    for (const stepStart of stepStarts) {
      const counts: SloRequestCounts = data.counts.get(stepStart)!;

      rows.push(
        {
          projectId: data.projectId,
          sloId: data.sloId,
          metricName: SloRequestCountSeries.Good,
          bucketStart: new Date(stepStart),
          value: counts.goodCount,
        },
        {
          projectId: data.projectId,
          sloId: data.sloId,
          metricName: SloRequestCountSeries.Total,
          bucketStart: new Date(stepStart),
          value: counts.totalCount,
        },
      );
    }

    return rows;
  }

  /*
   * The sums of the counted steps from SloHistory for each window start, up
   * to `readTo`, leaving out the ranges this evaluation counted itself. A step
   * counted twice (counted again later, or a retried write) reads its newest
   * counts; a step missing one of its two rows is left out rather than read
   * as all good or all bad.
   */
  public static buildWindowSumsStatement(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    windowStarts: Array<Date>;
    readFrom: Date;
    readTo: Date;
    excludedRanges: Array<SloRequestCountingRange>;
  }): Statement {
    const statement: Statement = SQL`SELECT `;

    data.windowStarts.forEach((windowStart: Date, index: number): void => {
      statement.append(index === 0 ? "" : ", ");
      statement.append(
        SQL`sumIf(good, bucketStart >= ${{
          type: TableColumnType.Date,
          value: windowStart,
        }}) AS `,
      );
      statement.append(`good${index}`);
      statement.append(
        SQL`, sumIf(total, bucketStart >= ${{
          type: TableColumnType.Date,
          value: windowStart,
        }}) AS `,
      );
      statement.append(`total${index}`);
    });

    SloRequestCounting.appendCountedSteps(statement, {
      projectId: data.projectId,
      sloId: data.sloId,
      readFrom: data.readFrom,
      readTo: data.readTo,
      excludedRanges: data.excludedRanges,
    });

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: SLO_REQUEST_COUNT_TIME_LIMIT_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }

  /*
   * The counted steps' sums over each range [from, to) - an SLO's monthly
   * report reads one per month - from SloHistory, as
   * buildWindowSumsStatement reads a window: the newest counts of every
   * step that has both. The caller keeps each range inside what the
   * current counting covers (firstAccumulatedBucketStartAt to
   * lastAccumulatedBucketEndAt).
   */
  public static buildRangeSumsStatement(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    ranges: Array<SloRequestCountingRange>;
  }): Statement {
    const statement: Statement = SQL`SELECT `;

    // A fresh condition for each sum: a statement's parameters are its own.
    const inRange: (range: SloRequestCountingRange) => Statement = (
      range: SloRequestCountingRange,
    ): Statement => {
      return SQL`bucketStart >= ${{
        type: TableColumnType.Date,
        value: range.from,
      }} AND bucketStart < ${{
        type: TableColumnType.Date,
        value: range.to,
      }}`;
    };

    data.ranges.forEach(
      (range: SloRequestCountingRange, index: number): void => {
        statement.append(index === 0 ? "sumIf(good, " : ", sumIf(good, ");
        statement.append(inRange(range));
        statement.append(`) AS good${index}, sumIf(total, `);
        statement.append(inRange(range));
        statement.append(`) AS total${index}`);
      },
    );

    const { readFrom, readTo } = SloRequestCounting.getReadSpan(data.ranges);

    SloRequestCounting.appendCountedSteps(statement, {
      projectId: data.projectId,
      sloId: data.sloId,
      readFrom: readFrom,
      readTo: readTo,
      excludedRanges: [],
    });

    statement.append(
      getQuerySettings({
        maxExecutionTimeInSeconds: SLO_REQUEST_COUNT_TIME_LIMIT_SECONDS,
        timeoutOverflowMode: "throw",
      }),
    );

    return statement;
  }

  /*
   * One sum per range, in the ranges' order. A range that holds no time
   * sums to zero, and when none does nothing is read at all.
   */
  public static async readRangeSums(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    ranges: Array<SloRequestCountingRange>;
  }): Promise<Array<SloRequestCounts>> {
    const empty: Array<SloRequestCounts> = data.ranges.map(
      (): SloRequestCounts => {
        return { goodCount: 0, totalCount: 0 };
      },
    );

    const ranges: Array<SloRequestCountingRange> = data.ranges.filter(
      (range: SloRequestCountingRange): boolean => {
        return range.from.getTime() < range.to.getTime();
      },
    );

    if (ranges.length === 0) {
      return empty;
    }

    const result: Results = await SloHistoryService.executeQuery(
      SloRequestCounting.buildRangeSumsStatement({
        projectId: data.projectId,
        sloId: data.sloId,
        ranges: ranges,
      }),
    );

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const row: JSONObject | undefined = (response.data || [])[0];

    if (!row) {
      return empty;
    }

    let readIndex: number = 0;

    return data.ranges.map((range: SloRequestCountingRange) => {
      if (range.from.getTime() >= range.to.getTime()) {
        return { goodCount: 0, totalCount: 0 };
      }

      const index: number = readIndex++;

      return {
        goodCount: toCount(row[`good${index}`]),
        totalCount: toCount(row[`total${index}`]),
      };
    });
  }

  // The earliest start and the latest end of the ranges.
  private static getReadSpan(ranges: Array<SloRequestCountingRange>): {
    readFrom: Date;
    readTo: Date;
  } {
    let readFrom: number = Infinity;
    let readTo: number = -Infinity;

    for (const range of ranges) {
      readFrom = Math.min(readFrom, range.from.getTime());
      readTo = Math.max(readTo, range.to.getTime());
    }

    return { readFrom: new Date(readFrom), readTo: new Date(readTo) };
  }

  /*
   * FROM the counted steps of [readFrom, readTo), less the excluded ranges:
   * each step's newest good and total counts (argMax by version, so a step
   * counted again reads its latest counts), and only the steps that have
   * both rows - a step missing one is left out rather than read as all good
   * or all bad.
   */
  private static appendCountedSteps(
    statement: Statement,
    data: {
      projectId: ObjectID;
      sloId: ObjectID;
      readFrom: Date;
      readTo: Date;
      excludedRanges: Array<SloRequestCountingRange>;
    },
  ): void {
    statement.append(
      SQL`
      FROM (
        SELECT
          bucketStart,
          argMaxIf(value, version, metricName = ${{
            type: TableColumnType.Text,
            value: SloRequestCountSeries.Good,
          }}) AS good,
          argMaxIf(value, version, metricName = ${{
            type: TableColumnType.Text,
            value: SloRequestCountSeries.Total,
          }}) AS total
        FROM ${AnalyticsTableName.SloHistory}
        WHERE projectId = ${{
          type: TableColumnType.ObjectID,
          value: data.projectId,
        }}
          AND sloId = ${{
            type: TableColumnType.ObjectID,
            value: data.sloId,
          }}
          AND metricName IN (${{
            type: TableColumnType.Text,
            value: SloRequestCountSeries.Good,
          }}, ${{
            type: TableColumnType.Text,
            value: SloRequestCountSeries.Total,
          }})
          AND bucketStart >= ${{
            type: TableColumnType.Date,
            value: data.readFrom,
          }}
          AND bucketStart < ${{
            type: TableColumnType.Date,
            value: data.readTo,
          }}`,
    );

    for (const range of data.excludedRanges) {
      statement.append(
        SQL`
          AND NOT (bucketStart >= ${{
            type: TableColumnType.Date,
            value: range.from,
          }} AND bucketStart < ${{
            type: TableColumnType.Date,
            value: range.to,
          }})`,
      );
    }

    statement.append(
      SQL`
        GROUP BY bucketStart
        HAVING countIf(metricName = ${{
          type: TableColumnType.Text,
          value: SloRequestCountSeries.Good,
        }}) > 0 AND countIf(metricName = ${{
          type: TableColumnType.Text,
          value: SloRequestCountSeries.Total,
        }}) > 0
      )`,
    );
  }

  public static async readWindowSums(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    windowStarts: Array<Date>;
    readFrom: Date;
    readTo: Date;
    excludedRanges: Array<SloRequestCountingRange>;
  }): Promise<Array<SloRequestCounts>> {
    const empty: Array<SloRequestCounts> = data.windowStarts.map(
      (): SloRequestCounts => {
        return { goodCount: 0, totalCount: 0 };
      },
    );

    if (
      data.windowStarts.length === 0 ||
      data.readFrom.getTime() >= data.readTo.getTime() ||
      SloRequestCounting.isCoveredBy({
        from: data.readFrom,
        to: data.readTo,
        ranges: data.excludedRanges,
      })
    ) {
      return empty;
    }

    const result: Results = await SloHistoryService.executeQuery(
      SloRequestCounting.buildWindowSumsStatement(data),
    );

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const rows: Array<JSONObject> = response.data || [];
    const row: JSONObject | undefined = rows[0];

    if (!row) {
      return empty;
    }

    return data.windowStarts.map((_start: Date, index: number) => {
      return {
        goodCount: toCount(row[`good${index}`]),
        totalCount: toCount(row[`total${index}`]),
      };
    });
  }

  /*
   * One evaluation's counting, start to finish: plan, count, keep, sum.
   *
   * Counting the newest steps, keeping the counts and reading the sums throw:
   * without them the evaluation has nothing true to say, so the sweep logs it
   * and the SLO is measured again on its next cadence, its cursors where they
   * were. Counting an older piece does not: the counts then cover a little
   * less of the window until the next evaluation counts it.
   */
  public static async measure(data: {
    projectId: ObjectID;
    sloId: ObjectID;
    config: SloRequestCountingConfig;
    now: Date;
    neededFrom: Date;
    firstAccumulatedBucketStartAt?: Date | undefined | null;
    lastAccumulatedBucketEndAt?: Date | undefined | null;
    fingerprint?: string | undefined | null;
    windowStarts: Array<Date>;
  }): Promise<SloRequestMeasurement> {
    const fingerprint: string = SloRequestCounting.getFingerprint(data.config);

    const plan: SloRequestCountingPlan = planRequestCounting({
      now: data.now,
      neededFrom: data.neededFrom,
      firstAccumulatedBucketStartAt: data.firstAccumulatedBucketStartAt,
      lastAccumulatedBucketEndAt: data.lastAccumulatedBucketEndAt,
      isSameCounting: data.fingerprint === fingerprint,
    });

    const counted: StepCounts = new Map<number, SloRequestCounts>();
    const countedRanges: Array<SloRequestCountingRange> = [];

    if (plan.forward) {
      SloRequestCounting.mergeInto(
        counted,
        await SloRequestCounting.countRange({
          projectId: data.projectId,
          config: data.config,
          range: plan.forward,
        }),
      );
      countedRanges.push(plan.forward);
    }

    let first: Date = plan.firstAccumulatedBucketStartAt;
    const backfillStartedAt: number = Date.now();

    for (const piece of plan.backfill) {
      if (
        Date.now() - backfillStartedAt >=
        SLO_REQUEST_BACKFILL_TIME_BUDGET_MILLISECONDS
      ) {
        break;
      }

      try {
        SloRequestCounting.mergeInto(
          counted,
          await SloRequestCounting.countRange({
            projectId: data.projectId,
            config: data.config,
            range: piece,
          }),
        );
        countedRanges.push(piece);
        first = piece.from;
      } catch (err) {
        logger.error(
          `SloRequestCounting - Could not count the requests of SLO ${data.sloId.toString()} from ${piece.from.toISOString()} to ${piece.to.toISOString()}; the next evaluation counts them: ${err}`,
          {
            projectId: data.projectId.toString(),
            sloId: data.sloId.toString(),
          } as LogAttributes,
        );
        break;
      }
    }

    if (counted.size > 0) {
      await SloHistoryService.insertHistoryRows(
        SloRequestCounting.toHistoryRows({
          projectId: data.projectId,
          sloId: data.sloId,
          counts: counted,
        }),
      );
    }

    const last: Date = plan.lastAccumulatedBucketEndAt;

    const windowStarts: Array<Date> = data.windowStarts.map(
      (windowStart: Date): Date => {
        return getCountedWindowStart({
          windowStart: windowStart,
          firstAccumulatedBucketStartAt: first,
        });
      },
    );

    const readFrom: Date = windowStarts.reduce(
      (earliest: Date, windowStart: Date): Date => {
        return windowStart.getTime() < earliest.getTime()
          ? windowStart
          : earliest;
      },
      last,
    );

    const savedSums: Array<SloRequestCounts> =
      await SloRequestCounting.readWindowSums({
        projectId: data.projectId,
        sloId: data.sloId,
        windowStarts: windowStarts,
        readFrom: readFrom,
        readTo: last,
        excludedRanges: countedRanges,
      });

    const windowCounts: Array<SloRequestCounts> = windowStarts.map(
      (windowStart: Date, index: number): SloRequestCounts => {
        const counts: SloRequestCounts = {
          goodCount: savedSums[index]?.goodCount || 0,
          totalCount: savedSums[index]?.totalCount || 0,
        };

        for (const [stepStart, stepCounts] of counted) {
          if (
            stepStart >= windowStart.getTime() &&
            stepStart < last.getTime()
          ) {
            counts.goodCount += stepCounts.goodCount;
            counts.totalCount += stepCounts.totalCount;
          }
        }

        return counts;
      },
    );

    return {
      firstAccumulatedBucketStartAt: first,
      lastAccumulatedBucketEndAt: last,
      fingerprint: fingerprint,
      isRestart: plan.isRestart,
      windowCounts: windowCounts,
    };
  }

  // Whether the ranges together cover all of [from, to).
  public static isCoveredBy(data: {
    from: Date;
    to: Date;
    ranges: Array<SloRequestCountingRange>;
  }): boolean {
    const sorted: Array<SloRequestCountingRange> = [...data.ranges].sort(
      (a: SloRequestCountingRange, b: SloRequestCountingRange): number => {
        return a.from.getTime() - b.from.getTime();
      },
    );

    let coveredUntil: number = data.from.getTime();

    for (const range of sorted) {
      if (range.from.getTime() > coveredUntil) {
        return false;
      }

      coveredUntil = Math.max(coveredUntil, range.to.getTime());

      if (coveredUntil >= data.to.getTime()) {
        return true;
      }
    }

    return coveredUntil >= data.to.getTime();
  }

  private static mergeInto(target: StepCounts, source: StepCounts): void {
    for (const [stepStart, counts] of source) {
      target.set(stepStart, counts);
    }
  }

  private static getThresholdInNanoseconds(
    config: SloRequestCountingConfig,
  ): number {
    return Math.round(Number(config.latencyThresholdInMilliseconds) * 1000000);
  }
}

// A count read from ClickHouse may arrive as a string (a quoted UInt64).
const toCount: (value: unknown) => number = (value: unknown): number => {
  const parsed: number =
    typeof value === "number" ? value : parseFloat(String(value ?? ""));

  return isFinite(parsed) && parsed > 0 ? parsed : 0;
};
