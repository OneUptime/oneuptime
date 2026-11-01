import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import MetricBaselineHourly from "../../Models/AnalyticsModels/MetricBaselineHourly";
import logger, { LogAttributes } from "../Utils/Logger";
import MetricHourBaseline, {
  METRIC_ROUNDING_SHARE,
  MetricBaselineDayRow,
  MetricHourReading,
} from "../Utils/Monitor/MetricHourBaseline";
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
   * a single telemetry service.
   *
   * `judgedAt` is the earliest moment judged, now when absent. An hour
   * read just after midnight is of yesterday, and its own day is not today.
   */
  public async getBaseline(input: {
    projectId: ObjectID | string;
    metricName: string;
    primaryEntityId?: ObjectID | string | undefined;
    hourOfWeek: number;
    judgedAt?: Date | undefined;
    windowDays?: number | undefined;
    minSamples?: number | undefined;
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

    const primaryEntityIdClause: string = input.primaryEntityId
      ? `AND primaryEntityId = '${this.escapeString(
          input.primaryEntityId instanceof ObjectID
            ? input.primaryEntityId.toString()
            : input.primaryEntityId,
        )}'`
      : "";

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
        AND hourOfWeek = ${hour}
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
    primaryEntityId?: ObjectID | string | undefined;
  }): Promise<{ totalSamples: number; oldestDay: Date | null }> {
    const projectIdStr: string = this.escapeString(
      input.projectId instanceof ObjectID
        ? input.projectId.toString()
        : input.projectId,
    );
    const metricNameStr: string = this.escapeString(input.metricName);

    const primaryEntityIdClause: string = input.primaryEntityId
      ? `AND primaryEntityId = '${this.escapeString(
          input.primaryEntityId instanceof ObjectID
            ? input.primaryEntityId.toString()
            : input.primaryEntityId,
        )}'`
      : "";

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
    primaryEntityId?: ObjectID | string | undefined;
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

    const primaryEntityIdClause: string = input.primaryEntityId
      ? `AND primaryEntityId = '${this.escapeString(
          input.primaryEntityId instanceof ObjectID
            ? input.primaryEntityId.toString()
            : input.primaryEntityId,
        )}'`
      : "";

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
     * it starts, and each still reads the same weeks: one of a cell's hours
     * falls in any seven days.
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
        AND hourOfWeek IN (${Array.from(hoursInBand).join(", ")})
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
      const hour: number = this.toNumber(row.hourOfWeek);
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
   * Compute hour-of-week 0..167 for a Date the same way the MV does:
   * `(toDayOfWeek(time, 1) - 1) * 24 + toHour(time)` with ISO week
   * numbering (Monday = 1, Sunday = 7). Pure function — kept here so
   * the eval-time anomaly check and the band query agree.
   */
  public static computeHourOfWeek(date: Date): number {
    // JS getDay(): Sun=0..Sat=6. Convert to ISO 1..7 (Mon..Sun).
    const jsDow: number = date.getDay();
    const isoDow: number = jsDow === 0 ? 7 : jsDow;
    const hour: number = date.getHours();
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
        AND hourOfWeek IN (${data.hoursOfWeek.join(", ")})
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
          hourOfWeek: this.toNumber(row["hourOfWeek"]),
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
