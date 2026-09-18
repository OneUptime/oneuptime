/*
 * Uptime percentage over a NetworkSiteStatusTimeline window.
 *
 * Every row whose status is not flagged operational counts as downtime.
 * Rows are clamped to the window, an open row (endsAt null) extends to the
 * window end, and overlapping down rows are merged so no second is counted
 * twice. Time not covered by any row counts as up - the timeline only gains
 * rows once a rollup has run, and absence of evidence is not an outage.
 *
 * Scheduled maintenance is subtracted from BOTH sides of the fraction. A
 * two-hour window inside a 24-hour day makes the day 22 hours long, and any
 * downtime inside those two hours is not counted at all. That is the only
 * arrangement where a planned outage neither drags the number down nor
 * silently inflates it: excluding the downtime but keeping the denominator
 * would report the maintenance as perfect uptime.
 */

// One timeline row, denormalized with its status row's priority and flag.
export interface SiteStatusTimelineRow {
  monitorStatusId: string;
  startsAt: Date;
  endsAt: Date | null;
  priority: number;
  isOperationalState: boolean;
}

/*
 * One scheduled maintenance window, already resolved to the interval that
 * should not count. `endsAt` null means "still running", and is clamped to
 * the end of whatever window is being measured.
 */
export interface SiteMaintenanceWindow {
  startsAt: Date;
  endsAt: Date | null;
}

export interface TimeInterval {
  startInMs: number;
  endInMs: number;
}

/*
 * One day's worth of the same calculation, for the daily strip.
 *
 * `uptimePercent` is null when the day has nothing to measure: either it
 * falls entirely inside a maintenance window, or it sits before the site's
 * timeline begins. Those two are not the same thing and the caller is told
 * which via `isFullyMaintained` / `hasTimelineCoverage`, because "we agreed
 * this was off" and "we were not watching yet" should not be drawn the same
 * way.
 */
export interface DailyUptimeEntry {
  dayStart: Date;
  dayEnd: Date;
  uptimePercent: number | null;
  downtimeInMs: number;
  maintenanceInMs: number;
  isFullyMaintained: boolean;
  hasTimelineCoverage: boolean;
}

/*
 * The same calculation as calculateUptimePercent, with the two facts a caller
 * needs in order to render it honestly.
 *
 * `measuredInMs` is zero when the whole period was inside a maintenance
 * window, or when the period itself was empty. The scalar function reports
 * 100 in that case — it has to return a number — and "100% uptime" on a site
 * that was switched off for the entire month is exactly the kind of
 * misreading this feature exists to remove. A caller with somewhere to put a
 * dash should read `measuredInMs` and print one.
 */
export interface SiteUptimeMeasurement {
  uptimePercent: number;
  /*
   * Length of the period after maintenance was subtracted. Zero means "no
   * evidence either way", NOT "perfect".
   */
  measuredInMs: number;
  // How much of the period was inside a maintenance window.
  maintenanceInMs: number;
  // Non-operational time that counted (i.e. outside every window).
  downtimeInMs: number;
}

const MS_IN_A_DAY: number = 24 * 60 * 60 * 1000;

export class SiteUptimeUtil {
  /*
   * Percent of [windowStart, windowEnd) - minus any maintenance - that the
   * site was NOT in a non-operational status. Returns 100 for an empty or
   * inverted window, and for a window entirely covered by maintenance (there
   * is no unplanned time left in which the site could have failed). The
   * result is exact (not rounded) and clamped to 0..100.
   */
  public static calculateUptimePercent(
    rows: Array<SiteStatusTimelineRow>,
    windowStart: Date,
    windowEnd: Date,
    maintenanceWindows?: Array<SiteMaintenanceWindow> | undefined,
  ): number {
    return SiteUptimeUtil.measureUptime(
      rows,
      windowStart,
      windowEnd,
      maintenanceWindows,
    ).uptimePercent;
  }

  /*
   * The same measurement, with the evidence behind it. Prefer this wherever
   * the UI can render a dash: `measuredInMs === 0` means the period was
   * entirely maintenance (or empty), and the 100 in `uptimePercent` is a
   * placeholder rather than a claim.
   */
  public static measureUptime(
    rows: Array<SiteStatusTimelineRow>,
    windowStart: Date,
    windowEnd: Date,
    maintenanceWindows?: Array<SiteMaintenanceWindow> | undefined,
  ): SiteUptimeMeasurement {
    const windowStartInMs: number = windowStart.getTime();
    const windowEndInMs: number = windowEnd.getTime();
    const windowInMs: number = windowEndInMs - windowStartInMs;

    if (!Number.isFinite(windowInMs) || windowInMs <= 0) {
      return {
        uptimePercent: 100,
        measuredInMs: 0,
        maintenanceInMs: 0,
        downtimeInMs: 0,
      };
    }

    const excluded: Array<TimeInterval> = SiteUptimeUtil.clampIntervals(
      (maintenanceWindows || []).map(
        (window: SiteMaintenanceWindow): TimeInterval => {
          return {
            startInMs: new Date(window.startsAt).getTime(),
            endInMs: window.endsAt
              ? new Date(window.endsAt).getTime()
              : windowEndInMs,
          };
        },
      ),
      windowStartInMs,
      windowEndInMs,
    );

    const excludedInMs: number = SiteUptimeUtil.totalCoveredMs(excluded);
    const measuredInMs: number = windowInMs - excludedInMs;

    if (measuredInMs <= 0) {
      return {
        uptimePercent: 100,
        measuredInMs: 0,
        maintenanceInMs: excludedInMs,
        downtimeInMs: 0,
      };
    }

    const downInMs: number = SiteUptimeUtil.downtimeInMs(
      rows,
      windowStartInMs,
      windowEndInMs,
      excluded,
    );

    const uptimePercent: number =
      ((measuredInMs - downInMs) / measuredInMs) * 100;

    return {
      uptimePercent: Math.min(100, Math.max(0, uptimePercent)),
      measuredInMs: measuredInMs,
      maintenanceInMs: excludedInMs,
      downtimeInMs: downInMs,
    };
  }

  /*
   * The same measurement cut into calendar-independent 24-hour buckets ending
   * at `endDate`, oldest first.
   *
   * Buckets are fixed 24-hour slices rather than local calendar days on
   * purpose: a site's devices, its viewers and the server can all be in
   * different time zones, and there is no single "day" they would agree on.
   * The strip's job is to find the bad day inside a good month, and a
   * rolling 24-hour slice does that without inventing a time zone.
   */
  public static calculateDailyUptime(data: {
    rows: Array<SiteStatusTimelineRow>;
    days: number;
    endDate: Date;
    maintenanceWindows?: Array<SiteMaintenanceWindow> | undefined;
  }): Array<DailyUptimeEntry> {
    const days: number = Math.floor(data.days);
    const endInMs: number = data.endDate.getTime();

    if (!Number.isFinite(endInMs) || days <= 0) {
      return [];
    }

    /*
     * When the timeline begins. Days entirely before it have no evidence
     * either way, and reporting them as 100% would draw a solid green month
     * for a site that was only attached yesterday.
     */
    const earliestRowStartInMs: number | null =
      SiteUptimeUtil.earliestRowStartInMs(data.rows);

    const entries: Array<DailyUptimeEntry> = [];

    for (let index: number = days - 1; index >= 0; index--) {
      const dayEndInMs: number = endInMs - index * MS_IN_A_DAY;
      const dayStartInMs: number = dayEndInMs - MS_IN_A_DAY;
      const dayStart: Date = new Date(dayStartInMs);
      const dayEnd: Date = new Date(dayEndInMs);

      const excluded: Array<TimeInterval> = SiteUptimeUtil.clampIntervals(
        (data.maintenanceWindows || []).map(
          (window: SiteMaintenanceWindow): TimeInterval => {
            return {
              startInMs: new Date(window.startsAt).getTime(),
              endInMs: window.endsAt
                ? new Date(window.endsAt).getTime()
                : dayEndInMs,
            };
          },
        ),
        dayStartInMs,
        dayEndInMs,
      );

      const maintenanceInMs: number = SiteUptimeUtil.totalCoveredMs(excluded);

      const hasTimelineCoverage: boolean =
        earliestRowStartInMs !== null && earliestRowStartInMs < dayEndInMs;

      /*
       * The day the timeline BEGINS is only partly evidenced. Measuring the
       * whole 24 hours would score the hours before the site was ever rolled
       * up as up — so a site attached at 23:00 that was dark for its first
       * hour would report 95.8% for a day it was down for all of the time
       * anyone was watching. Measure from the first row instead.
       */
      const measuredStartInMs: number =
        earliestRowStartInMs !== null
          ? Math.max(dayStartInMs, earliestRowStartInMs)
          : dayStartInMs;

      const coveredInMs: number = dayEndInMs - measuredStartInMs;
      const maintenanceInCoveredMs: number = SiteUptimeUtil.totalCoveredMs(
        SiteUptimeUtil.clampIntervals(excluded, measuredStartInMs, dayEndInMs),
      );
      const measuredInMs: number = coveredInMs - maintenanceInCoveredMs;
      const isFullyMaintained: boolean =
        maintenanceInMs >= MS_IN_A_DAY ||
        (hasTimelineCoverage && measuredInMs <= 0);

      const downtimeInMs: number = hasTimelineCoverage
        ? SiteUptimeUtil.downtimeInMs(
            data.rows,
            measuredStartInMs,
            dayEndInMs,
            excluded,
          )
        : 0;

      entries.push({
        dayStart: dayStart,
        dayEnd: dayEnd,
        uptimePercent:
          isFullyMaintained || !hasTimelineCoverage || measuredInMs <= 0
            ? null
            : Math.min(
                100,
                Math.max(
                  0,
                  ((measuredInMs - downtimeInMs) / measuredInMs) * 100,
                ),
              ),
        downtimeInMs: downtimeInMs,
        maintenanceInMs: maintenanceInMs,
        isFullyMaintained: isFullyMaintained,
        hasTimelineCoverage: hasTimelineCoverage,
      });
    }

    return entries;
  }

  /*
   * Start of the trailing `days` x 24h window ending at `endDate`.
   *
   * Deliberately millisecond arithmetic rather than a calendar subtraction.
   * The daily strip's buckets are fixed 24-hour slices, so a "Last 24 Hours"
   * figure computed with calendar days would silently span 23 or 25 hours on
   * the two days a year the clocks move, and disagree with the bar sitting
   * next to it.
   */
  public static trailingWindowStart(endDate: Date, days: number): Date {
    return new Date(endDate.getTime() - days * MS_IN_A_DAY);
  }

  /*
   * True when `at` falls inside one of the windows. Used to badge a site as
   * "under maintenance" beside a real-time status that still reads Down -
   * the status is deliberately not suppressed, so the badge is the only
   * thing telling a viewer the outage was planned.
   */
  public static isUnderMaintenanceAt(
    maintenanceWindows: Array<SiteMaintenanceWindow>,
    at: Date,
  ): boolean {
    const atInMs: number = at.getTime();

    for (const window of maintenanceWindows) {
      const startInMs: number = new Date(window.startsAt).getTime();
      const endInMs: number = window.endsAt
        ? new Date(window.endsAt).getTime()
        : Number.POSITIVE_INFINITY;

      if (!Number.isFinite(startInMs)) {
        continue;
      }

      if (atInMs >= startInMs && atInMs < endInMs) {
        return true;
      }
    }

    return false;
  }

  /*
   * Non-operational milliseconds inside [startInMs, endInMs), with the
   * excluded (maintenance) intervals removed. `excluded` must already be
   * clamped to the same window.
   */
  private static downtimeInMs(
    rows: Array<SiteStatusTimelineRow>,
    startInMs: number,
    endInMs: number,
    excluded: Array<TimeInterval>,
  ): number {
    const downIntervals: Array<TimeInterval> = [];

    for (const row of rows) {
      if (row.isOperationalState) {
        continue;
      }

      const rowStartInMs: number = new Date(row.startsAt).getTime();
      const rowEndInMs: number = row.endsAt
        ? new Date(row.endsAt).getTime()
        : endInMs;

      if (!Number.isFinite(rowStartInMs) || !Number.isFinite(rowEndInMs)) {
        continue;
      }

      downIntervals.push({ startInMs: rowStartInMs, endInMs: rowEndInMs });
    }

    const clamped: Array<TimeInterval> = SiteUptimeUtil.clampIntervals(
      downIntervals,
      startInMs,
      endInMs,
    );

    return SiteUptimeUtil.totalCoveredMs(
      SiteUptimeUtil.subtractIntervals(clamped, excluded),
    );
  }

  private static earliestRowStartInMs(
    rows: Array<SiteStatusTimelineRow>,
  ): number | null {
    let earliest: number | null = null;

    for (const row of rows) {
      const startInMs: number = new Date(row.startsAt).getTime();
      if (!Number.isFinite(startInMs)) {
        continue;
      }
      if (earliest === null || startInMs < earliest) {
        earliest = startInMs;
      }
    }

    return earliest;
  }

  // Clamp to the window and drop anything that survives as empty or invalid.
  private static clampIntervals(
    intervals: Array<TimeInterval>,
    windowStartInMs: number,
    windowEndInMs: number,
  ): Array<TimeInterval> {
    const clamped: Array<TimeInterval> = [];

    for (const interval of intervals) {
      if (
        !Number.isFinite(interval.startInMs) ||
        !Number.isFinite(interval.endInMs)
      ) {
        continue;
      }

      const startInMs: number = Math.max(interval.startInMs, windowStartInMs);
      const endInMs: number = Math.min(interval.endInMs, windowEndInMs);

      if (endInMs <= startInMs) {
        continue;
      }

      clamped.push({ startInMs: startInMs, endInMs: endInMs });
    }

    return clamped;
  }

  /*
   * `intervals` minus `holes`. Both are treated as sets of instants, so the
   * result is what is left of the first after every hole has been punched
   * out of it. Neither input has to be sorted or disjoint.
   */
  public static subtractIntervals(
    intervals: Array<TimeInterval>,
    holes: Array<TimeInterval>,
  ): Array<TimeInterval> {
    if (holes.length === 0) {
      return intervals;
    }

    const mergedHoles: Array<TimeInterval> = SiteUptimeUtil.merge(holes);
    const result: Array<TimeInterval> = [];

    for (const interval of intervals) {
      let cursorInMs: number = interval.startInMs;

      for (const hole of mergedHoles) {
        if (hole.endInMs <= cursorInMs) {
          continue;
        }
        if (hole.startInMs >= interval.endInMs) {
          break;
        }
        if (hole.startInMs > cursorInMs) {
          result.push({ startInMs: cursorInMs, endInMs: hole.startInMs });
        }
        cursorInMs = Math.max(cursorInMs, hole.endInMs);
        if (cursorInMs >= interval.endInMs) {
          break;
        }
      }

      if (cursorInMs < interval.endInMs) {
        result.push({ startInMs: cursorInMs, endInMs: interval.endInMs });
      }
    }

    return result;
  }

  // Sum of interval lengths after merging overlaps.
  private static totalCoveredMs(intervals: Array<TimeInterval>): number {
    let totalInMs: number = 0;

    for (const interval of SiteUptimeUtil.merge(intervals)) {
      totalInMs += interval.endInMs - interval.startInMs;
    }

    return totalInMs;
  }

  // Sorted, non-overlapping copy of the input.
  private static merge(intervals: Array<TimeInterval>): Array<TimeInterval> {
    if (intervals.length === 0) {
      return [];
    }

    const sorted: Array<TimeInterval> = [...intervals].sort(
      (a: TimeInterval, b: TimeInterval) => {
        return a.startInMs - b.startInMs;
      },
    );

    const merged: Array<TimeInterval> = [];
    let currentStartInMs: number = sorted[0]!.startInMs;
    let currentEndInMs: number = sorted[0]!.endInMs;

    for (let i: number = 1; i < sorted.length; i++) {
      const interval: TimeInterval = sorted[i]!;
      if (interval.startInMs <= currentEndInMs) {
        currentEndInMs = Math.max(currentEndInMs, interval.endInMs);
      } else {
        merged.push({
          startInMs: currentStartInMs,
          endInMs: currentEndInMs,
        });
        currentStartInMs = interval.startInMs;
        currentEndInMs = interval.endInMs;
      }
    }

    merged.push({ startInMs: currentStartInMs, endInMs: currentEndInMs });
    return merged;
  }
}

export default SiteUptimeUtil;
