/*
 * Uptime percentage over a NetworkSiteStatusTimeline window.
 *
 * Every row whose status is not flagged operational counts as downtime.
 * Rows are clamped to the window, an open row (endsAt null) extends to the
 * window end, and overlapping down rows are merged so no second is counted
 * twice. Time not covered by any row counts as up - the timeline only gains
 * rows once a rollup has run, and absence of evidence is not an outage.
 */

// One timeline row, denormalized with its status row's priority and flag.
export interface SiteStatusTimelineRow {
  monitorStatusId: string;
  startsAt: Date;
  endsAt: Date | null;
  priority: number;
  isOperationalState: boolean;
}

interface TimeInterval {
  startInMs: number;
  endInMs: number;
}

export class SiteUptimeUtil {
  /*
   * Percent of [windowStart, windowEnd) the site was NOT in a
   * non-operational status. Returns 100 for an empty or inverted window.
   * The result is exact (not rounded) and clamped to 0..100.
   */
  public static calculateUptimePercent(
    rows: Array<SiteStatusTimelineRow>,
    windowStart: Date,
    windowEnd: Date,
  ): number {
    const windowStartInMs: number = windowStart.getTime();
    const windowEndInMs: number = windowEnd.getTime();
    const windowInMs: number = windowEndInMs - windowStartInMs;

    if (!Number.isFinite(windowInMs) || windowInMs <= 0) {
      return 100;
    }

    const downIntervals: Array<TimeInterval> = [];

    for (const row of rows) {
      if (row.isOperationalState) {
        continue;
      }

      const rowStartInMs: number = new Date(row.startsAt).getTime();
      const rowEndInMs: number = row.endsAt
        ? new Date(row.endsAt).getTime()
        : windowEndInMs;

      if (!Number.isFinite(rowStartInMs) || !Number.isFinite(rowEndInMs)) {
        continue;
      }

      const clampedStartInMs: number = Math.max(rowStartInMs, windowStartInMs);
      const clampedEndInMs: number = Math.min(rowEndInMs, windowEndInMs);

      if (clampedEndInMs <= clampedStartInMs) {
        continue;
      }

      downIntervals.push({
        startInMs: clampedStartInMs,
        endInMs: clampedEndInMs,
      });
    }

    const downInMs: number = SiteUptimeUtil.totalCoveredMs(downIntervals);

    const uptimePercent: number = ((windowInMs - downInMs) / windowInMs) * 100;
    return Math.min(100, Math.max(0, uptimePercent));
  }

  // Sum of interval lengths after merging overlaps.
  private static totalCoveredMs(intervals: Array<TimeInterval>): number {
    if (intervals.length === 0) {
      return 0;
    }

    const sorted: Array<TimeInterval> = [...intervals].sort(
      (a: TimeInterval, b: TimeInterval) => {
        return a.startInMs - b.startInMs;
      },
    );

    let totalInMs: number = 0;
    let currentStartInMs: number = sorted[0]!.startInMs;
    let currentEndInMs: number = sorted[0]!.endInMs;

    for (let i: number = 1; i < sorted.length; i++) {
      const interval: TimeInterval = sorted[i]!;
      if (interval.startInMs <= currentEndInMs) {
        currentEndInMs = Math.max(currentEndInMs, interval.endInMs);
      } else {
        totalInMs += currentEndInMs - currentStartInMs;
        currentStartInMs = interval.startInMs;
        currentEndInMs = interval.endInMs;
      }
    }

    totalInMs += currentEndInMs - currentStartInMs;
    return totalInMs;
  }
}

export default SiteUptimeUtil;
