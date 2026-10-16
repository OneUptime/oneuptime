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
  // How long before the end of the window the newest reading's span ended.
  sinceNewestReadingMs: number | null;
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

    const leadingGapMs: number = oldestMs - input.windowStartMs;

    let shortfall: WindowCoverageShortfall | null = null;

    if (sinceNewestReadingMs > allowedGapMs) {
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

    if (gaps.length === 0) {
      return null;
    }

    gaps.sort((a: number, b: number) => {
      return a - b;
    });

    return gaps[Math.floor((gaps.length - 1) / 2)]!;
  }
}
