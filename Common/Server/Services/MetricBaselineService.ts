import MetricService from "./MetricService";
import logger, { LogAttributes } from "../Utils/Logger";
import ObjectID from "../../Types/ObjectID";

/**
 * Result of a baseline lookup for a single (metric, service, hour-of-week)
 * cell over the last N days. Returned as plain numbers so callers can do
 * mean ± k*sigma comparisons without re-deriving them.
 */
export interface BaselineSummary {
  /** Total raw samples that contributed to the baseline window. */
  sampleCount: number;
  mean: number;
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
   * Whether this row meets the minimum sample threshold to be trusted.
   * Driven by `minSamples`; callers should refuse to evaluate against an
   * unreliable baseline (cold-start behavior).
   */
  isReliable: boolean;
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

export class MetricBaselineService {
  /**
   * Default minimum samples per (hour-of-week) cell to call a baseline
   * reliable. Below this, callers treat the baseline as cold-start.
   */
  public static readonly DEFAULT_MIN_SAMPLES: number = 5;
  public static readonly DEFAULT_WINDOW_DAYS: number = 14;
  public static readonly MAX_WINDOW_DAYS: number = 28;

  /**
   * Fetch the rolling-window baseline for one (metric, [service],
   * hour-of-week) cell. Aggregates the AggregateFunction states across
   * the last `windowDays` days. Returns null when no data exists.
   *
   * `serviceId` is optional: when omitted, baselines are aggregated
   * across every serviceId that ingested the metric in the window.
   * Useful for monitor criteria whose query isn't scoped to a single
   * telemetry service.
   */
  public async getBaseline(input: {
    projectId: ObjectID | string;
    metricName: string;
    serviceId?: ObjectID | string | undefined;
    hourOfWeek: number;
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

    const serviceIdClause: string = input.serviceId
      ? `AND serviceId = '${this.escapeString(
          input.serviceId instanceof ObjectID
            ? input.serviceId.toString()
            : input.serviceId,
        )}'`
      : "";

    const sql: string = `
      SELECT
        countMerge(sampleCountState)         AS sampleCount,
        avgMerge(meanState)                  AS mean,
        stddevPopMerge(stddevState)          AS stddev,
        quantileMerge(0.5)(medianState)      AS median,
        quantileMerge(0.95)(p95State)        AS p95,
        minMerge(minObsState)                AS minObserved,
        maxMerge(maxObsState)                AS maxObserved
      FROM MetricBaselineHourly
      WHERE projectId = '${projectIdStr}'
        AND name = '${metricNameStr}'
        ${serviceIdClause}
        AND hourOfWeek = ${hour}
        AND day >= today() - INTERVAL ${windowDays} DAY
    `;

    const resultSet: {
      json: () => Promise<{
        data: Array<{
          sampleCount: number | string;
          mean: number | string;
          stddev: number | string;
          median: number | string;
          p95: number | string;
          minObserved: number | string;
          maxObserved: number | string;
        }>;
      }>;
    } = (await MetricService.executeQuery(sql)) as unknown as {
      json: () => Promise<{
        data: Array<{
          sampleCount: number | string;
          mean: number | string;
          stddev: number | string;
          median: number | string;
          p95: number | string;
          minObserved: number | string;
          maxObserved: number | string;
        }>;
      }>;
    };

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

    const summary: BaselineSummary = {
      sampleCount,
      mean: this.toNumber(row["mean"]),
      stddev: this.toNumber(row["stddev"]),
      median: this.toNumber(row["median"]),
      p95: this.toNumber(row["p95"]),
      minObserved: this.toNumber(row["minObserved"]),
      maxObserved: this.toNumber(row["maxObserved"]),
      isReliable: sampleCount >= minSamples,
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
   * service) pair. Used by the form UI to show "Learning — N days of
   * data, baseline ready in M days".
   */
  public async getCoverage(input: {
    projectId: ObjectID | string;
    metricName: string;
    serviceId?: ObjectID | string | undefined;
  }): Promise<{ totalSamples: number; oldestDay: Date | null }> {
    const projectIdStr: string = this.escapeString(
      input.projectId instanceof ObjectID
        ? input.projectId.toString()
        : input.projectId,
    );
    const metricNameStr: string = this.escapeString(input.metricName);

    const serviceIdClause: string = input.serviceId
      ? `AND serviceId = '${this.escapeString(
          input.serviceId instanceof ObjectID
            ? input.serviceId.toString()
            : input.serviceId,
        )}'`
      : "";

    const sql: string = `
      SELECT
        countMerge(sampleCountState) AS totalSamples,
        toString(min(day))           AS oldestDay
      FROM MetricBaselineHourly
      WHERE projectId = '${projectIdStr}'
        AND name = '${metricNameStr}'
        ${serviceIdClause}
        AND day >= today() - INTERVAL ${MetricBaselineService.MAX_WINDOW_DAYS} DAY
    `;

    const resultSet: {
      json: () => Promise<{
        data: Array<{ totalSamples: number | string; oldestDay: string }>;
      }>;
    } = (await MetricService.executeQuery(sql)) as unknown as {
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
   * Build a series of (time, mean, expectedHigh, expectedLow) points
   * spanning [startTime, endTime] in `intervalMinutes` steps. Each
   * point's expected band is the same-hour-of-week baseline computed
   * from the rolling window. Powers the shaded "expected range" band
   * on metric explorer charts.
   */
  public async getBandSeries(input: {
    projectId: ObjectID | string;
    metricName: string;
    serviceId?: ObjectID | string | undefined;
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

    const serviceIdClause: string = input.serviceId
      ? `AND serviceId = '${this.escapeString(
          input.serviceId instanceof ObjectID
            ? input.serviceId.toString()
            : input.serviceId,
        )}'`
      : "";

    const sql: string = `
      SELECT
        hourOfWeek,
        countMerge(sampleCountState) AS sampleCount,
        avgMerge(meanState)          AS mean,
        stddevPopMerge(stddevState)  AS stddev
      FROM MetricBaselineHourly
      WHERE projectId = '${projectIdStr}'
        AND name = '${metricNameStr}'
        ${serviceIdClause}
        AND day >= today() - INTERVAL ${windowDays} DAY
      GROUP BY hourOfWeek
    `;

    const resultSet: {
      json: () => Promise<{
        data: Array<{
          hourOfWeek: number | string;
          sampleCount: number | string;
          mean: number | string;
          stddev: number | string;
        }>;
      }>;
    } = (await MetricService.executeQuery(sql)) as unknown as {
      json: () => Promise<{
        data: Array<{
          hourOfWeek: number | string;
          sampleCount: number | string;
          mean: number | string;
          stddev: number | string;
        }>;
      }>;
    };

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
      const samples: number = this.toNumber(row.sampleCount);
      if (samples < minSamples) {
        continue;
      }
      byHour.set(hour, {
        mean: this.toNumber(row.mean),
        stddev: this.toNumber(row.stddev),
      });
    }

    const out: Array<BandPoint> = [];
    const stepMs: number = Math.max(1, input.intervalMinutes) * 60_000;
    const startMs: number = input.startTime.getTime();
    const endMs: number = input.endTime.getTime();

    for (let t: number = startMs; t <= endMs; t += stepMs) {
      const point: Date = new Date(t);
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

  /**
   * Map sensitivity level to sigma multiplier. Tighter sensitivity =
   * lower sigma threshold = more alerts.
   */
  public static sigmaForSensitivity(
    sensitivity: "Low" | "Medium" | "High",
  ): number {
    switch (sensitivity) {
      case "Low":
        return 4;
      case "High":
        return 2;
      case "Medium":
      default:
        return 3;
    }
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
