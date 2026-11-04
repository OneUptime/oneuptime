/*
 * Why a window's readings do not cover it.
 */
export enum WindowCoverageShortfall {
  // The window holds no reading at all.
  NoReadings = "NoReadings",
  // The newest reading is too old: the readings stopped part way through.
  Stale = "Stale",
  // Two readings are further apart than the cadence allows.
  Hole = "Hole",
  // The oldest reading is too far after the start of the window.
  StartsLate = "StartsLate",
}

export interface WindowCoverageInput {
  windowStartMs: number;
  windowEndMs: number;
  // When each reading was taken. Any order; unreadable times are dropped.
  readingTimesMs: Array<number>;
  // How far apart consecutive readings are expected to be.
  intervalMs: number;
  /*
   * How long one reading stands for, from its own time on. 0 for a reading
   * that is an instant (a probe's check); the bucket width for a data point
   * that sums up a bucket of time (a metric's per-minute value), whose time
   * is the start of its bucket.
   */
  readingSpanMs?: number | undefined;
  /*
   * Whether a hole between two readings breaks coverage, as well as a late
   * first reading or a stale newest one.
   */
  holesBreakCoverage?: boolean | undefined;
  /*
   * What the newest reading must be close enough to: the end of the window
   * when left out. Readings that all arrive late by design (a Metrics
   * monitor reading CloudWatch) are measured against the newest data there
   * is instead, since none of them can be any fresher. Never later than the
   * end of the window.
   */
  freshAsOfMs?: number | undefined;
  /*
   * When the readings arrived, when that is known: how long nothing new had
   * arrived, and how often readings arrive. Readings stamped with the time
   * they measure can be old by that time and still keep arriving - a source
   * that is late by design, a collector whose clock runs behind - and such a
   * series is late, not stopped. With this, the newest reading goes stale
   * only once nothing has arrived for longer than the cadence allows,
   * however old its own time is, and the window counts as far as the
   * readings reach. freshAsOfMs is not read then.
   */
  arrival?: WindowCoverageArrival | undefined;
}

export interface WindowCoverageArrival {
  // How long before the end of the window nothing new had arrived.
  sinceNewestArrivalMs: number;
  /*
   * How often readings arrive, when that is coarser than how often they are
   * taken: a source that delivers five readings at once every five minutes.
   * Null when unknown.
   */
  arrivalIntervalMs?: number | null | undefined;
}

export interface WindowCoverageResult {
  isCovered: boolean;
  // Null when covered. When several apply, the most recent one is named.
  shortfall: WindowCoverageShortfall | null;
  // The longest stretch without a reading that still counts as covered.
  allowedGapMs: number;
  /*
   * The newest unbroken run of readings - followed back from the newest
   * reading until a hole wider than allowedGapMs, or the start of the
   * window - as times clipped to the window. Null without readings.
   */
  runStartMs: number | null;
  runEndMs: number | null;
  // The hole the run starts after, when one cut it.
  holeBeforeRunMs: number | null;
  /*
   * How long before the end of the window the newest reading's span ended -
   * by the window's end, whatever the reading was judged fresh against.
   */
  sinceNewestReadingMs: number | null;
  /*
   * How long nothing new had arrived, when the arrivals were known (input
   * .arrival), and the longest it may be before the readings count as
   * stale. Null when they were not known.
   */
  sinceNewestArrivalMs: number | null;
  allowedArrivalGapMs: number | null;
}

/**
 * The one rule behind "All Values over the last N minutes": whether the
 * readings a window holds actually cover it.
 *
 * Array.every() is true of a single reading, so a window holding one bad
 * reading - a monitor that has only just started, a series that only just
 * appeared - used to satisfy "every value over the last 15 minutes". A
 * window is only covered when its readings reach from its start to its end:
 * the oldest one close enough to the start, the newest one close enough to
 * the end and - when holes count - no two of them too far apart.
 *
 * "Close enough" is measured against the readings' own cadence: one and a
 * half reading intervals. A window that starts mid-cycle legitimately has
 * its first reading up to one interval in; the extra half absorbs jitter,
 * and the delay between a reading being taken and being readable, so a
 * series does not flip between covered and not covered on adjacent checks.
 * Between two readings it bridges exactly one missing reading.
 *
 * Measured in time, not in a count of readings, so several sources writing
 * into one series, or a reading landing a moment outside the window, change
 * nothing.
 *
 * Probe monitors' over-time filters (EvaluateOverTime) judge their two edges
 * with it; metric monitors (MetricWindowCoverage) judge holes as well.
 */
export default class WindowCoverage {
  /*
   * Multiple of the reading interval that either end of the window - or,
   * when holes count, the time between two readings - may go without a
   * reading and still count as covered.
   */
  public static readonly TOLERANCE_FACTOR: number = 1.5;

  public static judge(input: WindowCoverageInput): WindowCoverageResult {
    const allowedGapMs: number =
      Math.max(0, input.intervalMs) * WindowCoverage.TOLERANCE_FACTOR;
    const spanMs: number = Math.max(0, input.readingSpanMs || 0);

    const times: Array<number> = input.readingTimesMs
      .filter((time: number) => {
        return Number.isFinite(time);
      })
      .sort((a: number, b: number) => {
        return a - b;
      });

    if (times.length === 0) {
      return {
        isCovered: false,
        shortfall: WindowCoverageShortfall.NoReadings,
        allowedGapMs: allowedGapMs,
        runStartMs: null,
        runEndMs: null,
        holeBeforeRunMs: null,
        sinceNewestReadingMs: null,
        sinceNewestArrivalMs: null,
        allowedArrivalGapMs: null,
      };
    }

    const oldestMs: number = times[0]!;
    const newestMs: number = times[times.length - 1]!;

    /*
     * Follow the run back from the newest reading. Only holes count here,
     * so the run always ends at the newest reading - and it stops at the
     * start of the window: a hole before the window (or before where a read
     * cut at its row limit becomes complete) says nothing about it.
     */
    let runStartMs: number = newestMs;
    let holeBeforeRunMs: number | null = null;

    for (let index: number = times.length - 2; index >= 0; index--) {
      if (runStartMs <= input.windowStartMs) {
        break;
      }

      const holeMs: number = times[index + 1]! - (times[index]! + spanMs);

      if (input.holesBreakCoverage && holeMs > allowedGapMs) {
        holeBeforeRunMs = holeMs;
        break;
      }

      runStartMs = times[index]!;
    }

    const sinceNewestReadingMs: number = Math.max(
      0,
      input.windowEndMs - (newestMs + spanMs),
    );

    const freshAsOfMs: number =
      typeof input.freshAsOfMs === "number" &&
      Number.isFinite(input.freshAsOfMs)
        ? Math.min(input.freshAsOfMs, input.windowEndMs)
        : input.windowEndMs;

    const staleForMs: number = Math.max(0, freshAsOfMs - (newestMs + spanMs));

    /*
     * Known arrivals decide freshness on their own: stale once nothing has
     * arrived for one and a half times how often readings come - or arrive,
     * when they arrive in batches less often than they are taken.
     */
    const arrival: WindowCoverageArrival | null =
      input.arrival &&
      typeof input.arrival.sinceNewestArrivalMs === "number" &&
      Number.isFinite(input.arrival.sinceNewestArrivalMs)
        ? input.arrival
        : null;

    const sinceNewestArrivalMs: number | null = arrival
      ? Math.max(0, arrival.sinceNewestArrivalMs)
      : null;

    const arrivalIntervalMs: number =
      arrival &&
      typeof arrival.arrivalIntervalMs === "number" &&
      Number.isFinite(arrival.arrivalIntervalMs) &&
      arrival.arrivalIntervalMs > 0
        ? arrival.arrivalIntervalMs
        : 0;

    const allowedArrivalGapMs: number | null = arrival
      ? Math.max(Math.max(0, input.intervalMs), arrivalIntervalMs) *
        WindowCoverage.TOLERANCE_FACTOR
      : null;

    const isStale: boolean =
      sinceNewestArrivalMs !== null && allowedArrivalGapMs !== null
        ? sinceNewestArrivalMs > allowedArrivalGapMs
        : staleForMs > allowedGapMs;

    const leadingGapMs: number = oldestMs - input.windowStartMs;

    let shortfall: WindowCoverageShortfall | null = null;

    if (isStale) {
      shortfall = WindowCoverageShortfall.Stale;
    } else if (holeBeforeRunMs !== null) {
      shortfall = WindowCoverageShortfall.Hole;
    } else if (leadingGapMs > allowedGapMs) {
      shortfall = WindowCoverageShortfall.StartsLate;
    }

    return {
      isCovered: shortfall === null,
      shortfall: shortfall,
      allowedGapMs: allowedGapMs,
      runStartMs: Math.min(
        Math.max(runStartMs, input.windowStartMs),
        input.windowEndMs,
      ),
      runEndMs: Math.min(
        Math.max(newestMs + spanMs, input.windowStartMs),
        input.windowEndMs,
      ),
      holeBeforeRunMs: holeBeforeRunMs,
      sinceNewestReadingMs: sinceNewestReadingMs,
      sinceNewestArrivalMs: sinceNewestArrivalMs,
      allowedArrivalGapMs: allowedArrivalGapMs,
    };
  }

  /*
   * The lower median of the gaps between consecutive readings: what the
   * cadence is most of the time, so the gaps that are not stand out.
   * Readings taken at the same moment say nothing of the cadence and are
   * left out. Null without two readings apart.
   */
  public static getTypicalIntervalMs(
    readingTimesMs: Array<number>,
  ): number | null {
    return WindowCoverage.getTypicalGapMs(
      WindowCoverage.getGapsMs(readingTimesMs),
    );
  }

  /*
   * The gaps between consecutive readings, oldest first. Readings taken at
   * the same moment say nothing of the cadence and are left out, and so
   * are unreadable times.
   */
  public static getGapsMs(readingTimesMs: Array<number>): Array<number> {
    const times: Array<number> = readingTimesMs
      .filter((time: number) => {
        return Number.isFinite(time);
      })
      .sort((a: number, b: number) => {
        return a - b;
      });

    const gaps: Array<number> = [];

    for (let index: number = 1; index < times.length; index++) {
      const gapMs: number = times[index]! - times[index - 1]!;

      if (gapMs > 0) {
        gaps.push(gapMs);
      }
    }

    return gaps;
  }

  /*
   * The lower median of some gaps - of one series, or of several series
   * pooled. The lower one, so a hole and a beat cannot tie it upwards: of
   * two gaps, it is the shorter. Null without a gap.
   */
  public static getTypicalGapMs(gapsMs: Array<number>): number | null {
    const gaps: Array<number> = gapsMs
      .filter((gapMs: number) => {
        return Number.isFinite(gapMs) && gapMs > 0;
      })
      .sort((a: number, b: number) => {
        return a - b;
      });

    if (gaps.length === 0) {
      return null;
    }

    return gaps[Math.floor((gaps.length - 1) / 2)]!;
  }
}
