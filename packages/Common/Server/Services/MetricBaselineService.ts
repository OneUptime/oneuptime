import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricBaselineHourly from "../../Models/AnalyticsModels/MetricBaselineHourly";
import { AggregateUtil } from "../Types/AnalyticsDatabase/AggregateBy";
import {
  getDistributionAwareAggregationExpression,
  isDistributionPointType,
} from "../Utils/AnalyticsDatabase/DistributionAggregation";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import logger, { LogAttributes } from "../Utils/Logger";
import MetricHourBaseline, {
  METRIC_ROUNDING_SHARE,
  MetricBaselineDayRow,
  MetricBaselineSource,
  MetricDataPointCell,
  MetricDataPointDayRow,
  MetricHourReading,
} from "../Utils/Monitor/MetricHourBaseline";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AggregationInterval from "../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType, {
  isPercentileAggregation,
} from "../../Types/BaseDatabase/AggregationType";
import {
  ANOMALY_SIGMA_BY_SENSITIVITY,
  ANOMALY_WINDOW_DAYS_OPTIONS,
  AnomalyDetectionSensitivity,
  DEFAULT_ANOMALY_WINDOW_DAYS,
} from "../../Types/Monitor/CriteriaFilter";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";

/**
 * Result of a baseline lookup for a single (metric, service, hour-of-week)
 * cell over the last N days. Returned as plain numbers so callers can do
 * mean ± k*sigma comparisons without re-deriving them.
 */
export interface BaselineSummary {
  /** Raw samples of the earlier days the baseline was read from. */
  sampleCount: number;
  mean: number;
  /**
   * The spread the band is built on: what those samples measured, and how far
   * this hour's level can land from theirs (MetricHourBaseline).
   */
  stddev: number;
  /** Median (robust center) — used by the MedianMad method. */
  median: number;
  /** 95th percentile observed in the window (informational). */
  p95: number;
  minObserved: number;
  maxObserved: number;
  /**
   * Median absolute deviation × 1.4826 → σ-equivalent for a Gaussian.
   * Computed in app code from a follow-up median-of-deviations query.
   * Optional in v1 since the default method is MeanStddev.
   */
  mad?: number | undefined;
  /**
   * Whether this row can be trusted: two earlier weeks of this hour, and
   * `minSamples` samples counting the hour's own. Callers should refuse to
   * evaluate against an unreliable baseline (cold-start behavior).
   */
  isReliable: boolean;
  /**
   * Every earlier sample held one value and this hour's own have left it.
   * Such a baseline has no spread, and a data point off that value is outside
   * it by any measure (`getBand`).
   */
  leftFlatHistory?: boolean | undefined;
  /** Window the baseline was computed over (days). */
  windowDays: number;
  hourOfWeek: number;
}

/*
 * What a monitor's query makes of a metric. Without one, a baseline is the
 * hourly rollup's cell of raw samples. With one, it is read from wherever the
 * query's data points are (MetricHourBaseline.getSource).
 */
export interface MetricBaselineQuery {
  aggregationType: AggregationType;
  // It filters or groups by anything but the service.
  isNarrowedByAttributes: boolean;
  // How long one of its data points is.
  interval: AggregationInterval;
}

// One service's rows, or several's: what a monitor names, in place of them all.
export type MetricBaselineEntity =
  | ObjectID
  | string
  | Array<ObjectID | string>
  | undefined;

export interface BandPoint {
  time: Date;
  mean: number;
  expectedHigh: number;
  expectedLow: number;
}

export interface BaselineBand {
  expectedHigh: number;
  expectedLow: number;
}

/**
 * One (metric, entity) cell's finalized mean/sample-count for one of the
 * two week-over-week drift windows. The AI MetricDrift detector
 * joins the "recent" and "prior" rows in JS (the join stays app-side so
 * the drift decision is a pure, unit-testable function).
 */
export interface MetricDriftWindowRow {
  name: string;
  primaryEntityId: string;
  mean: number;
  sampleCount: number;
  window: "recent" | "prior";
}

/**
 * Read-side service for the `MetricBaselineHourly` MV target table.
 *
 * The table itself is declared by the {@link MetricBaselineHourly}
 * model and created either by app startup auto-create or by the
 * `AddMetricBaselineHourlyMV` data migration (whichever runs first —
 * both are idempotent). Rows are populated by the attached MV; this
 * service only reads.
 *
 * Callers use this service through:
 *   - `getBaseline(...)`     — single (metric, hour-of-week) cell.
 *   - `getCoverage(...)`     — total samples & oldest day for a metric.
 *   - `getBandSeries(...)`   — chart band data over a time window.
 *   - `computeHourOfWeek()`  — pure helper kept here so the eval-time
 *                              and MV-write-time formulas stay aligned.
 */
export class MetricBaselineService extends AnalyticsDatabaseService<MetricBaselineHourly> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: MetricBaselineHourly, database: clickhouseDatabase });
  }

  // The longest a read of a metric's own rows may take: it fails, not thins out.
  private static readonly DATA_POINT_READ_MAX_EXECUTION_SECONDS: number = 45;

  /**
   * Default minimum samples per (hour-of-week) cell to call a baseline
   * reliable, the hour's own included. Below this, callers treat the
   * baseline as cold-start.
   */
  public static readonly DEFAULT_MIN_SAMPLES: number = 5;
  /**
   * Default rolling-window length in days when the criterion does not
   * specify one. 14 days is the smallest window that gives ≥ 2 samples
   * per (hour-of-week) bucket for typical projects, which combined with
   * the `min_samples` reliability gate yields baselines that don't fire
   * on every weekly traffic cycle.
   */
  public static readonly DEFAULT_WINDOW_DAYS: number =
    DEFAULT_ANOMALY_WINDOW_DAYS;
  /**
   * Hard upper bound on the rolling window. Locked to the MV target
   * table's TTL — querying further back would just hit empty space
   * because the rows are already gone. Bump this in lockstep with the
   * `MetricBaselineHourly` model's `ttlExpression` and any matching
   * ALTER-TTL migration; otherwise the read-side will silently truncate
   * caller intent.
   */
  public static readonly MAX_WINDOW_DAYS: number = 90;
  /**
   * Window options exposed by the criterion form. Constrained to a
   * small set so the UI stays a dropdown and so we don't have to TTL
   * the table for every conceivable value. Adding a longer option
   * requires bumping `MAX_WINDOW_DAYS` and the table TTL together.
   */
  public static readonly WINDOW_DAYS_OPTIONS: ReadonlyArray<number> =
    ANOMALY_WINDOW_DAYS_OPTIONS;
  /**
   * Hard cap on rows returned per drift window. Params travel in the
   * ClickHouse HTTP URI and the detector joins both windows in JS, so an
   * unbounded GROUP BY over a high-cardinality tenant would be both a
   * memory and a transfer problem. Ranked by sampleCount so the busiest
   * (most statistically trustworthy) cells always make the cut.
   */
  public static readonly DRIFT_MAX_ROWS_PER_WINDOW: number = 500;

  /**
   * Fetch the rolling-window baseline for one (metric, [entity],
   * hour-of-week) cell. Aggregates the AggregateFunction states across
   * the `windowDays` days before `judgedAt`, so what is being judged is
   * never part of what it is judged against (MetricHourBaseline). Returns
   * null when no data exists.
   *
   * `primaryEntityId` is optional: when omitted, baselines are
   * aggregated across every primaryEntityId that ingested the metric in
   * the window. Useful for monitor criteria whose query isn't scoped to
   * a telemetry service. A monitor that names several is read across
   * those.
   *
   * `judgedAt` is the earliest moment judged, now when absent. An hour
   * read just after midnight is of yesterday, and its own day is not today.
   *
   * `query` is what a monitor's query makes of the metric. A query whose
   * data points no table holds has no baseline, and gets null.
   */
  public async getBaseline(input: {
    projectId: ObjectID | string;
    metricName: string;
    primaryEntityId?: MetricBaselineEntity;
    hourOfWeek: number;
    judgedAt?: Date | undefined;
    windowDays?: number | undefined;
    minSamples?: number | undefined;
    query?: MetricBaselineQuery | undefined;
  }): Promise<BaselineSummary | null> {
    const windowDays: number = Math.min(
      input.windowDays || MetricBaselineService.DEFAULT_WINDOW_DAYS,
      MetricBaselineService.MAX_WINDOW_DAYS,
    );
    const minSamples: number =
      input.minSamples || MetricBaselineService.DEFAULT_MIN_SAMPLES;

    const projectIdStr: string = this.escapeString(
      input.projectId instanceof ObjectID
        ? input.projectId.toString()
        : input.projectId,
    );
    const metricNameStr: string = this.escapeString(input.metricName);
    const hour: number = Math.max(
      0,
      Math.min(167, Math.floor(input.hourOfWeek)),
    );
    const judgedDay: string = MetricHourBaseline.toDayText(
      input.judgedAt || OneUptimeDate.getCurrentDate(),
    );

    const primaryEntityIdClause: string = this.getEntityClause(
      input.primaryEntityId,
    );

    const source: MetricBaselineSource | null = input.query
      ? await this.getSource({
          query: input.query,
          projectIdStr,
          metricNameStr,
          hourOfWeek: hour,
          judgedDay,
        })
      : MetricBaselineSource.Samples;

    if (!source) {
      return null;
    }

    if (input.query && source !== MetricBaselineSource.Samples) {
      return await this.getDataPointBaseline({
        source,
        query: input.query,
        projectIdStr,
        metricNameStr,
        primaryEntityIdClause,
        hourOfWeek: hour,
        judgedDay,
        windowDays,
        minSamples,
      });
    }

    const sql: string = `
      SELECT
        countMerge(sampleCountState)                AS sampleCount,
        avgMerge(meanState)                         AS mean,
        stddevPopMerge(stddevState)                 AS stddev,
        quantileBFloat16Merge(0.5)(medianState)     AS median,
        quantileBFloat16Merge(0.95)(p95State)       AS p95,
        minMerge(minObsState)                       AS minObserved,
        maxMerge(maxObsState)                       AS maxObserved
      FROM MetricBaselineHourly
      WHERE projectId = '${projectIdStr}'
        AND name = '${metricNameStr}'
        ${primaryEntityIdClause}
        AND hourOfWeek = ${MetricHourBaseline.toStoredHour(hour)}
        ${this.getEarlierDaysClause({ judgedDay, windowDays })}
    `;

    const [resultSet, dayRows]: [
      {
        json: () => Promise<{
          data: Array<Record<string, number | string>>;
        }>;
      },
      Array<MetricBaselineDayRow>,
    ] = await Promise.all([
      this.executeQuery(sql) as unknown as Promise<{
        json: () => Promise<{
          data: Array<Record<string, number | string>>;
        }>;
      }>,
      this.getDayRows({
        projectIdStr,
        metricNameStr,
        primaryEntityIdClause,
        hoursOfWeek: MetricHourBaseline.getHoursOfDay(hour),
        judgedDay,
        windowDays,
      }),
    ]);

    const parsed: { data: Array<Record<string, number | string>> } =
      await resultSet.json();

    const row: Record<string, number | string> | undefined = parsed.data[0];
    if (!row) {
      return null;
    }

    const sampleCount: number = this.toNumber(row["sampleCount"]);
    if (!Number.isFinite(sampleCount) || sampleCount === 0) {
      return null;
    }

    const reading: MetricHourReading = MetricHourBaseline.read({
      rows: dayRows,
      hourOfWeek: hour,
      judgedDay,
      stddev: this.toNumber(row["stddev"]),
      windowDays,
      minSamples,
    });

    const summary: BaselineSummary = {
      sampleCount,
      mean: this.toNumber(row["mean"]),
      stddev: reading.stddev,
      median: this.toNumber(row["median"]),
      p95: this.toNumber(row["p95"]),
      minObserved: this.toNumber(row["minObserved"]),
      maxObserved: this.toNumber(row["maxObserved"]),
      isReliable: reading.isReliable,
      ...(reading.leftFlatHistory ? { leftFlatHistory: true } : {}),
      windowDays,
      hourOfWeek: hour,
    };

    logger.debug("MetricBaselineService.getBaseline", {
      projectId: projectIdStr,
      metricName: metricNameStr,
      hourOfWeek: hour,
      sampleCount,
      isReliable: summary.isReliable,
    } as LogAttributes);

    return summary;
  }

  /**
   * Coverage probe: how much baseline data we have for a (metric,
   * entity) pair. Used by the form UI to show "Learning — N days of
   * data, baseline ready in M days".
   */
  public async getCoverage(input: {
    projectId: ObjectID | string;
    metricName: string;
    primaryEntityId?: MetricBaselineEntity;
  }): Promise<{ totalSamples: number; oldestDay: Date | null }> {
    const projectIdStr: string = this.escapeString(
      input.projectId instanceof ObjectID
        ? input.projectId.toString()
        : input.projectId,
    );
    const metricNameStr: string = this.escapeString(input.metricName);

    const primaryEntityIdClause: string = this.getEntityClause(
      input.primaryEntityId,
    );

    const sql: string = `
      SELECT
        countMerge(sampleCountState) AS totalSamples,
        toString(min(day))           AS oldestDay
      FROM MetricBaselineHourly
      WHERE projectId = '${projectIdStr}'
        AND name = '${metricNameStr}'
        ${primaryEntityIdClause}
        AND day >= today() - INTERVAL ${MetricBaselineService.MAX_WINDOW_DAYS} DAY
    `;

    const resultSet: {
      json: () => Promise<{
        data: Array<{ totalSamples: number | string; oldestDay: string }>;
      }>;
    } = (await this.executeQuery(sql)) as unknown as {
      json: () => Promise<{
        data: Array<{ totalSamples: number | string; oldestDay: string }>;
      }>;
    };

    const parsed: {
      data: Array<{ totalSamples: number | string; oldestDay: string }>;
    } = await resultSet.json();
    const row:
      | { totalSamples: number | string; oldestDay: string }
      | undefined = parsed.data[0];
    if (!row) {
      return { totalSamples: 0, oldestDay: null };
    }

    const totalSamples: number = this.toNumber(row["totalSamples"]);
    const oldestDayParsed: Date = new Date(row["oldestDay"] || "");
    const oldestDay: Date | null = isNaN(oldestDayParsed.getTime())
      ? null
      : oldestDayParsed;
    return { totalSamples, oldestDay };
  }

  /**
   * Week-over-week drift feed for the AI MetricDrift detector: the
   * finalized mean + sample count per (metric name, entity) cell for two
   * adjacent 7-day windows — "recent" (last 7 days including today) and
   * "prior" (the 7 days before that). Two GROUP BY finalization queries
   * over the MetricBaselineHourly states (same *Merge idiom as
   * getBaseline); the recent/prior JOIN deliberately happens in the
   * caller's pure decision function, not in SQL, so it is unit-testable.
   * Each window is capped at `limitPerWindow` rows (≤
   * DRIFT_MAX_ROWS_PER_WINDOW) ranked by sampleCount descending.
   */
  public async getWeekOverWeekDrift(data: {
    projectId: ObjectID;
    limitPerWindow: number;
  }): Promise<Array<MetricDriftWindowRow>> {
    const projectIdStr: string = this.escapeString(data.projectId.toString());
    const limit: number = Math.max(
      1,
      Math.min(
        Math.floor(data.limitPerWindow),
        MetricBaselineService.DRIFT_MAX_ROWS_PER_WINDOW,
      ),
    );

    const windows: Array<{ window: "recent" | "prior"; dayFilter: string }> = [
      {
        window: "recent",
        dayFilter: "day >= today() - INTERVAL 7 DAY",
      },
      {
        window: "prior",
        dayFilter:
          "day BETWEEN today() - INTERVAL 14 DAY AND today() - INTERVAL 8 DAY",
      },
    ];

    const out: Array<MetricDriftWindowRow> = [];

    for (const windowSpec of windows) {
      const sql: string = `
        SELECT
          name,
          primaryEntityId,
          avgMerge(meanState)          AS mean,
          countMerge(sampleCountState) AS sampleCount
        FROM MetricBaselineHourly
        WHERE projectId = '${projectIdStr}'
          AND ${windowSpec.dayFilter}
        GROUP BY name, primaryEntityId
        ORDER BY sampleCount DESC
        LIMIT ${limit}
      `;

      const resultSet: {
        json: () => Promise<{
          data: Array<{
            name: string;
            primaryEntityId: string;
            mean: number | string;
            sampleCount: number | string;
          }>;
        }>;
      } = (await this.executeQuery(sql)) as unknown as {
        json: () => Promise<{
          data: Array<{
            name: string;
            primaryEntityId: string;
            mean: number | string;
            sampleCount: number | string;
          }>;
        }>;
      };

      const parsed: {
        data: Array<{
          name: string;
          primaryEntityId: string;
          mean: number | string;
          sampleCount: number | string;
        }>;
      } = await resultSet.json();

      for (const row of parsed.data) {
        out.push({
          name: String(row.name || ""),
          primaryEntityId: String(row.primaryEntityId || ""),
          mean: this.toNumber(row.mean),
          sampleCount: this.toNumber(row.sampleCount),
          window: windowSpec.window,
        });
      }
    }

    logger.debug("MetricBaselineService.getWeekOverWeekDrift", {
      projectId: projectIdStr,
      rowCount: out.length,
    } as LogAttributes);

    return out;
  }

  /**
   * Build a series of (time, mean, expectedHigh, expectedLow) points
   * spanning [startTime, endTime] in `intervalMinutes` steps. Each
   * point's expected band is the same-hour-of-week baseline computed
   * from the rolling window before `startTime`, as a monitor judges it.
   * Powers the shaded "expected range" band on metric explorer charts.
   */
  public async getBandSeries(input: {
    projectId: ObjectID | string;
    metricName: string;
    primaryEntityId?: MetricBaselineEntity;
    startTime: Date;
    endTime: Date;
    intervalMinutes: number;
    sigmaCount: number;
    windowDays?: number | undefined;
    minSamples?: number | undefined;
  }): Promise<Array<BandPoint>> {
    const windowDays: number = Math.min(
      input.windowDays || MetricBaselineService.DEFAULT_WINDOW_DAYS,
      MetricBaselineService.MAX_WINDOW_DAYS,
    );
    const minSamples: number =
      input.minSamples || MetricBaselineService.DEFAULT_MIN_SAMPLES;

    const projectIdStr: string = this.escapeString(
      input.projectId instanceof ObjectID
        ? input.projectId.toString()
        : input.projectId,
    );
    const metricNameStr: string = this.escapeString(input.metricName);

    const primaryEntityIdClause: string = this.getEntityClause(
      input.primaryEntityId,
    );

    const points: Array<Date> = [];
    const stepMs: number = Math.max(1, input.intervalMinutes) * 60_000;
    const startMs: number = input.startTime.getTime();
    const endMs: number = input.endTime.getTime();

    for (let t: number = startMs; t <= endMs; t += stepMs) {
      points.push(new Date(t));
    }

    if (points.length === 0) {
      return [];
    }

    const hoursInBand: Set<number> = new Set<number>(
      points.map((point: Date): number => {
        return MetricBaselineService.computeHourOfWeek(point);
      }),
    );

    /*
     * Every hour of a band shorter than a week is judged by the days before
     * the band starts. Those hold the same weeks each hour would read from
     * its own day: an hour of the week falls once in any seven days.
     */
    const judgedDay: string = MetricHourBaseline.toDayText(input.startTime);

    const sql: string = `
      SELECT
        hourOfWeek,
        countMerge(sampleCountState) AS sampleCount,
        avgMerge(meanState)          AS mean,
        stddevPopMerge(stddevState)  AS stddev
      FROM MetricBaselineHourly
      WHERE projectId = '${projectIdStr}'
        AND name = '${metricNameStr}'
        ${primaryEntityIdClause}
        AND hourOfWeek IN (${this.getStoredHours(Array.from(hoursInBand))})
        ${this.getEarlierDaysClause({ judgedDay, windowDays })}
      GROUP BY hourOfWeek
    `;

    const [resultSet, dayRows]: [
      {
        json: () => Promise<{
          data: Array<{
            hourOfWeek: number | string;
            sampleCount: number | string;
            mean: number | string;
            stddev: number | string;
          }>;
        }>;
      },
      Array<MetricBaselineDayRow>,
    ] = await Promise.all([
      this.executeQuery(sql) as unknown as Promise<{
        json: () => Promise<{
          data: Array<{
            hourOfWeek: number | string;
            sampleCount: number | string;
            mean: number | string;
            stddev: number | string;
          }>;
        }>;
      }>,
      this.getDayRows({
        projectIdStr,
        metricNameStr,
        primaryEntityIdClause,
        hoursOfWeek: Array.from(
          new Set<number>(
            Array.from(hoursInBand).flatMap((hour: number): Array<number> => {
              return MetricHourBaseline.getHoursOfDay(hour);
            }),
          ),
        ),
        judgedDay,
        windowDays,
      }),
    ]);

    const parsed: {
      data: Array<{
        hourOfWeek: number | string;
        sampleCount: number | string;
        mean: number | string;
        stddev: number | string;
      }>;
    } = await resultSet.json();

    const byHour: Map<number, { mean: number; stddev: number }> = new Map();
    for (const row of parsed.data) {
      const hour: number = MetricHourBaseline.fromStoredHour(
        this.toNumber(row.hourOfWeek),
      );
      const hoursOfDay: Array<number> = MetricHourBaseline.getHoursOfDay(hour);
      const reading: MetricHourReading = MetricHourBaseline.read({
        rows: dayRows.filter((dayRow: MetricBaselineDayRow): boolean => {
          return hoursOfDay.includes(dayRow.hourOfWeek);
        }),
        hourOfWeek: hour,
        judgedDay,
        stddev: this.toNumber(row.stddev),
        windowDays,
        minSamples,
      });
      if (!reading.isReliable) {
        continue;
      }
      byHour.set(hour, {
        mean: this.toNumber(row.mean),
        stddev: reading.stddev,
      });
    }

    const out: Array<BandPoint> = [];

    for (const point of points) {
      const hour: number = MetricBaselineService.computeHourOfWeek(point);
      const baseline: { mean: number; stddev: number } | undefined =
        byHour.get(hour);
      if (!baseline) {
        continue;
      }
      const half: number = input.sigmaCount * baseline.stddev;
      out.push({
        time: point,
        mean: baseline.mean,
        expectedHigh: baseline.mean + half,
        expectedLow: baseline.mean - half,
      });
    }

    return out;
  }

  /**
   * Compute hour-of-week 0..167 for a Date, with Monday 00:00 as 0.
   * Pure function — kept here so the eval-time anomaly check and the
   * band query agree. It is not the number the metric rollup stores,
   * which is a day behind: MetricHourBaseline.toStoredHour.
   *
   * In UTC, whatever zone this process or the ClickHouse server runs in.
   * Ingest writes a time as UTC text without a zone, which ClickHouse
   * reads and hands back in the same zone, so `toHour(time)` is the hour
   * of that text on any server. Local time here only ever agreed with it
   * by this process also being in UTC.
   */
  public static computeHourOfWeek(date: Date): number {
    // JS getUTCDay(): Sun=0..Sat=6. Convert to ISO 1..7 (Mon..Sun).
    const jsDow: number = date.getUTCDay();
    const isoDow: number = jsDow === 0 ? 7 : jsDow;
    const hour: number = date.getUTCHours();
    return (isoDow - 1) * 24 + hour;
  }

  /*
   * The range a baseline expects, or null when it cannot judge. A baseline
   * with no spread can only say that the metric has not moved, unless it has:
   * then the range is the one value it held, rounding apart.
   */
  public static getBand(data: {
    baseline: BaselineSummary;
    sigmaCount: number;
  }): BaselineBand | null {
    const { baseline, sigmaCount } = data;

    if (!Number.isFinite(baseline.stddev)) {
      return null;
    }

    if (baseline.stddev > 0) {
      return {
        expectedHigh: baseline.mean + sigmaCount * baseline.stddev,
        expectedLow: baseline.mean - sigmaCount * baseline.stddev,
      };
    }

    if (!baseline.leftFlatHistory) {
      return null;
    }

    const rounding: number = Math.abs(baseline.mean) * METRIC_ROUNDING_SHARE;

    return {
      expectedHigh: baseline.mean + rounding,
      expectedLow: baseline.mean - rounding,
    };
  }

  /**
   * Map sensitivity level to sigma multiplier. Tighter sensitivity =
   * lower sigma threshold = more alerts.
   */
  public static sigmaForSensitivity(
    sensitivity: "Low" | "Medium" | "High",
  ): number {
    return (
      ANOMALY_SIGMA_BY_SENSITIVITY[
        sensitivity as AnomalyDetectionSensitivity
      ] ?? ANOMALY_SIGMA_BY_SENSITIVITY[AnomalyDetectionSensitivity.Medium]
    );
  }

  // One service, or any of several. Naming none reads them all.
  private getEntityClause(primaryEntityId: MetricBaselineEntity): string {
    const entities: Array<ObjectID | string> = Array.isArray(primaryEntityId)
      ? primaryEntityId
      : primaryEntityId
        ? [primaryEntityId]
        : [];

    const quoted: Array<string> = entities.map(
      (entity: ObjectID | string): string => {
        return `'${this.escapeString(entity.toString())}'`;
      },
    );

    if (quoted.length === 0) {
      return "";
    }

    return quoted.length === 1
      ? `AND primaryEntityId = ${quoted[0]}`
      : `AND primaryEntityId IN (${quoted.join(", ")})`;
  }

  // Hours of the week, as the rollup's WHERE has to name them.
  private getStoredHours(hoursOfWeek: Array<number>): string {
    return hoursOfWeek
      .map((hour: number): number => {
        return MetricHourBaseline.toStoredHour(hour);
      })
      .join(", ");
  }

  private async getSource(data: {
    query: MetricBaselineQuery;
    projectIdStr: string;
    metricNameStr: string;
    hourOfWeek: number;
    judgedDay: string;
  }): Promise<MetricBaselineSource | null> {
    const { aggregationType, interval } = data.query;

    return MetricHourBaseline.getSource({
      isTotal:
        aggregationType === AggregationType.Sum ||
        aggregationType === AggregationType.Count,
      isPercentile: isPercentileAggregation(aggregationType),
      isDistribution: await this.isDistributionMetric(data),
      isNarrowedByAttributes: data.query.isNarrowedByAttributes,
      bucketInMinutes: MetricBaselineService.getBucketInMinutes(interval),
    });
  }

  /*
   * Whether a metric's rows are distributions, from one row of the hour
   * judged: a metric keeps its point type, and the data points being judged
   * are in that hour.
   */
  private async isDistributionMetric(data: {
    projectIdStr: string;
    metricNameStr: string;
    hourOfWeek: number;
    judgedDay: string;
  }): Promise<boolean> {
    const from: string = MetricHourBaseline.getHourStarts({
      hourOfWeek: data.hourOfWeek,
      judgedDay: data.judgedDay,
      windowDays: 0,
    })[0]!;

    const sql: string = `
      SELECT metricPointType
      FROM ${AnalyticsTableName.Metric}
      WHERE projectId = '${data.projectIdStr}'
        AND name = '${data.metricNameStr}'
        AND isNotNull(metricPointType)
        AND time >= toDateTime('${from}')
        AND time < toDateTime('${from}') + INTERVAL 1 HOUR
      LIMIT 1
    `;

    const resultSet: {
      json: () => Promise<{
        data: Array<Record<string, number | string>>;
      }>;
    } = (await this.executeQuery(sql)) as unknown as {
      json: () => Promise<{
        data: Array<Record<string, number | string>>;
      }>;
    };

    const parsed: { data: Array<Record<string, number | string>> } =
      await resultSet.json();

    return isDistributionPointType(parsed.data[0]?.["metricPointType"]);
  }

  private static getBucketInMinutes(interval: AggregationInterval): number {
    return AggregationIntervalUtil.getAggregationIntervalMs(interval) / 60_000;
  }

  /*
   * A query's baseline read from its own data points: the same read as a cell
   * of samples, of one sample per data point.
   */
  private async getDataPointBaseline(data: {
    source: MetricBaselineSource;
    query: MetricBaselineQuery;
    projectIdStr: string;
    metricNameStr: string;
    primaryEntityIdClause: string;
    hourOfWeek: number;
    judgedDay: string;
    windowDays: number;
    minSamples: number;
  }): Promise<BaselineSummary | null> {
    const rows: Array<MetricDataPointDayRow> =
      await this.getDataPointRows(data);

    const cell: MetricDataPointCell | null = MetricHourBaseline.fold({
      rows,
      hourOfWeek: data.hourOfWeek,
      judgedDay: data.judgedDay,
    });

    if (!cell) {
      return null;
    }

    const reading: MetricHourReading = MetricHourBaseline.read({
      rows,
      hourOfWeek: data.hourOfWeek,
      judgedDay: data.judgedDay,
      stddev: cell.stddev,
      windowDays: data.windowDays,
      // minSamples counts minutes, so a data point of five counts as five.
      minSamples: Math.ceil(
        data.minSamples /
          MetricBaselineService.getBucketInMinutes(data.query.interval),
      ),
    });

    return {
      ...cell,
      stddev: reading.stddev,
      isReliable: reading.isReliable,
      ...(reading.leftFlatHistory ? { leftFlatHistory: true } : {}),
      windowDays: data.windowDays,
      hourOfWeek: data.hourOfWeek,
    };
  }

  /*
   * A query's data points of the hour on every day from the start of the
   * baseline window on, the day judged included, one row a day: as getDayRows
   * reads the rollup. toDayOfWeek here is in its default mode, so these hours
   * are the code's own and not the rollup's. The hours are named one by one
   * so that the sort key skips the other 23 hours of a day of the metric's
   * rows.
   */
  private async getDataPointRows(data: {
    source: MetricBaselineSource;
    query: MetricBaselineQuery;
    projectIdStr: string;
    metricNameStr: string;
    primaryEntityIdClause: string;
    hourOfWeek: number;
    judgedDay: string;
    windowDays: number;
  }): Promise<Array<MetricDataPointDayRow>> {
    const isRollup: boolean = data.source === MetricBaselineSource.MinuteRollup;
    const timeColumn: string = isRollup ? "bucketTime" : "time";
    const table: string = isRollup
      ? AnalyticsTableName.MetricItemAggMV1m
      : AnalyticsTableName.Metric;
    const rollupPoint: string =
      data.query.aggregationType === AggregationType.Count
        ? "countMerge(valueCountState)"
        : "sumMerge(valueSumState)";
    const point: string = isRollup
      ? rollupPoint
      : getDistributionAwareAggregationExpression(
          data.query.aggregationType,
          "value",
        );

    const hours: string = MetricHourBaseline.getHourStarts({
      hourOfWeek: data.hourOfWeek,
      judgedDay: data.judgedDay,
      windowDays: data.windowDays,
    })
      .map((hourStart: string): string => {
        return `(${timeColumn} >= toDateTime('${hourStart}') AND ${timeColumn} < toDateTime('${hourStart}') + INTERVAL 1 HOUR)`;
      })
      .join(" OR ");

    const sql: string = `
      SELECT
        toString(toDate(pointTime)) AS rowDay,
        toUInt8((toDayOfWeek(pointTime) - 1) * 24 + toHour(pointTime)) AS hourOfWeek,
        count(point)                AS sampleCount,
        avg(point)                  AS mean,
        varPop(point)               AS variance,
        quantile(0.5)(point)        AS median,
        quantile(0.95)(point)       AS p95,
        min(point)                  AS minObserved,
        max(point)                  AS maxObserved
      FROM (
        SELECT
          ${AggregateUtil.buildBucketTimestampExpression(data.query.interval, timeColumn)} AS pointTime,
          ${point} AS point
        FROM ${table}
        WHERE projectId = '${data.projectIdStr}'
          AND name = '${data.metricNameStr}'
          ${data.primaryEntityIdClause}
          AND (${hours})
          AND retentionDate >= now()
        GROUP BY pointTime
      )
      GROUP BY rowDay, hourOfWeek
      ${getQuerySettings({
        maxExecutionTimeInSeconds:
          MetricBaselineService.DATA_POINT_READ_MAX_EXECUTION_SECONDS,
        timeoutOverflowMode: "throw",
      })}
    `;

    const resultSet: {
      json: () => Promise<{
        data: Array<Record<string, number | string>>;
      }>;
    } = (await this.executeQuery(sql)) as unknown as {
      json: () => Promise<{
        data: Array<Record<string, number | string>>;
      }>;
    };

    const parsed: { data: Array<Record<string, number | string>> } =
      await resultSet.json();

    return parsed.data.map(
      (row: Record<string, number | string>): MetricDataPointDayRow => {
        return {
          day: String(row["rowDay"]),
          hourOfWeek: this.toNumber(row["hourOfWeek"]),
          sampleCount: this.toNumber(row["sampleCount"]),
          mean: this.toNumber(row["mean"]),
          variance: this.toNumber(row["variance"]),
          median: this.toNumber(row["median"]),
          p95: this.toNumber(row["p95"]),
          minObserved: this.toNumber(row["minObserved"]),
          maxObserved: this.toNumber(row["maxObserved"]),
        };
      },
    );
  }

  // The days of the baseline window: the ones before the day judged.
  private getEarlierDaysClause(data: {
    judgedDay: string;
    windowDays: number;
  }): string {
    return `AND day >= toDate('${data.judgedDay}') - INTERVAL ${data.windowDays} DAY
        AND day < toDate('${data.judgedDay}')`;
  }

  /*
   * The hours asked for, one row a day, from the start of the baseline window
   * on, the day judged included: what MetricHourBaseline reads them for.
   */
  private async getDayRows(data: {
    projectIdStr: string;
    metricNameStr: string;
    primaryEntityIdClause: string;
    hoursOfWeek: Array<number>;
    judgedDay: string;
    windowDays: number;
  }): Promise<Array<MetricBaselineDayRow>> {
    const sql: string = `
      SELECT
        toString(toDate(day))        AS rowDay,
        hourOfWeek,
        countMerge(sampleCountState) AS sampleCount,
        avgMerge(meanState)          AS mean,
        minMerge(minObsState)        AS minObserved,
        maxMerge(maxObsState)        AS maxObserved
      FROM MetricBaselineHourly
      WHERE projectId = '${data.projectIdStr}'
        AND name = '${data.metricNameStr}'
        ${data.primaryEntityIdClause}
        AND hourOfWeek IN (${this.getStoredHours(data.hoursOfWeek)})
        AND day >= toDate('${data.judgedDay}') - INTERVAL ${data.windowDays} DAY
      GROUP BY rowDay, hourOfWeek
    `;

    const resultSet: {
      json: () => Promise<{
        data: Array<Record<string, number | string>>;
      }>;
    } = (await this.executeQuery(sql)) as unknown as {
      json: () => Promise<{
        data: Array<Record<string, number | string>>;
      }>;
    };

    const parsed: { data: Array<Record<string, number | string>> } =
      await resultSet.json();

    return parsed.data.map(
      (row: Record<string, number | string>): MetricBaselineDayRow => {
        return {
          day: String(row["rowDay"]),
          hourOfWeek: MetricHourBaseline.fromStoredHour(
            this.toNumber(row["hourOfWeek"]),
          ),
          sampleCount: this.toNumber(row["sampleCount"]),
          mean: this.toNumber(row["mean"]),
          minObserved: this.toNumber(row["minObserved"]),
          maxObserved: this.toNumber(row["maxObserved"]),
        };
      },
    );
  }

  private toNumber(v: number | string | undefined): number {
    if (typeof v === "number") {
      return v;
    }
    const n: number = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private escapeString(v: string): string {
    // ClickHouse string-literal escape for backslash and single quote.
    return v.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
}

export default new MetricBaselineService();
