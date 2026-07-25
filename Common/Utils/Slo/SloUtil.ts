import OneUptimeDate, { Moment } from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import SloMultiMonitorMode from "../../Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloStatus from "../../Types/ServiceLevelObjective/SloStatus";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import UptimeUtil, { UptimeWindow } from "../Uptime/UptimeUtil";
import MonitorEvent from "../Uptime/MonitorEvent";

/**
 * A half-open-ish downtime interval [startDate, endDate]. Intervals produced by this
 * util are already clipped to the reporting window and capped at "now".
 */
export interface DowntimeInterval {
  startDate: Date;
  endDate: Date;
}

/**
 * One monitor's status timeline rows. Rows for other monitors that leak into the
 * `timelines` array are ignored (they are filtered by `monitorId`).
 */
export interface MonitorTimelineSet {
  monitorId: ObjectID;
  timelines: Array<MonitorStatusTimeline>;
}

export interface TimeSliResult {
  /** Seconds counted against the SLO (downtime seconds). UNROUNDED. */
  badSeconds: number;
  /** Denominator seconds. 0 means "no data at all" (and sliPercentage is 100). */
  totalSeconds: number;
  /** UNROUNDED. Round only at render time via SloUtil.roundForDisplay. */
  sliPercentage: number;
}

export interface ErrorBudgetResult {
  /** allowedBadFraction * totalSeconds. */
  budgetTotalSeconds: number;
  /** Bad seconds consumed so far. */
  budgetConsumedSeconds: number;
  /**
   * SIGNED: negative when the SLO is over budget ("-40 min over budget" is
   * operationally useful). Clamp in the UI only, never here.
   */
  budgetRemainingSeconds: number;
  /** Signed, uncapped below 0, capped at 100. UNROUNDED. */
  budgetRemainingPercentage: number;
}

export interface CalendarMonthWindow {
  /** Start of the calendar month containing `at`, in the SLO's timezone. */
  startDate: Date;
  /** EXCLUSIVE end: the first instant of the next calendar month. */
  endDate: Date;
  /**
   * Real elapsed seconds in the FULL calendar period (fixed at period start -
   * NOT elapsed time, or a 1-minute blip at 00:10 on the 1st reads as instant
   * budget exhaustion). This is the budget denominator for calendar windows.
   * DST months in non-UTC timezones are 3600s shorter/longer - real seconds,
   * on purpose.
   */
  totalSecondsInFullPeriod: number;
}

/**
 * SLO / error budget math. Isomorphic (no server imports) so it is shared by the
 * worker, the dashboard, and later the status page - exactly like UptimeUtil.
 *
 * Design notes (see SLO design doc paragraph 3.1 / 5):
 *
 * - Multi-monitor downtime must NOT be computed by feeding several monitors into
 *   UptimeUtil.getNonOverlappingMonitorEvents: its priority flatten lets a
 *   better-status event that merely ends later truncate a concurrent worse-status
 *   event (Monitor A Offline 10:00-11:00 + Monitor B Operational 10:30-12:00
 *   silently loses 30 minutes of downtime). That flatten was built for rendering
 *   one status-page bar, not cross-monitor budget math. This util therefore works
 *   per monitor (getMonitorEventsForId is per-monitor and correct) and combines
 *   monitors with explicit semantics (SloMultiMonitorMode).
 *
 * - Every comparison against a threshold uses UNROUNDED values. Round only at
 *   render time (roundForDisplay floors - fine for display, wrong for
 *   classification).
 */
export default class SloUtil {
  /**
   * Extracts the downtime intervals of a SINGLE monitor inside the window.
   * Uses UptimeUtil.getMonitorEventsForId, which is per-monitor: it clips events
   * to the window, caps them at "now" and imputes an end for open
   * (endsAt = null) rows. Events whose status is not in `downtimeStatuses` are
   * dropped.
   */
  public static getDowntimeIntervalsForMonitor(
    monitorId: ObjectID,
    timelines: Array<MonitorStatusTimeline>,
    downtimeStatuses: Array<MonitorStatus>,
    window: UptimeWindow,
  ): Array<DowntimeInterval> {
    const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
      monitorId,
      timelines,
      window,
    );

    const intervals: Array<DowntimeInterval> = [];

    for (const event of events) {
      const isDowntimeEvent: boolean = Boolean(
        downtimeStatuses.find((status: MonitorStatus) => {
          return status.id?.toString() === event.eventStatusId.toString();
        }),
      );

      if (isDowntimeEvent) {
        intervals.push({
          startDate: event.startDate,
          endDate: event.endDate,
        });
      }
    }

    return intervals;
  }

  /**
   * The EARLIEST event start across the attached monitors inside `window`, or
   * null when no monitor has an event that overlaps the window at all.
   *
   * Uses the SAME UptimeUtil.getMonitorEventsForId clipping path the SLI
   * denominator uses, so the answer has identical semantics to the clamp inside
   * computeTimeSli: because events are clipped to the window, the returned date
   * is always >= window.startDate, i.e. it is "how far back this window can
   * actually see data".
   *
   * This exists for callers that must distinguish "the metric is fine" from
   * "we have not observed enough history to judge it yet" - most importantly the
   * burn-rate evaluator, whose FIXED-LENGTH long window would otherwise silently
   * collapse to the data age (see EvaluateSlos.evaluateBurnRateRule).
   */
  public static getEarliestEventStartDate(
    perMonitorTimelines: Array<MonitorTimelineSet>,
    window: UptimeWindow,
  ): Date | null {
    let earliestEventStart: Date | null = null;

    for (const monitor of perMonitorTimelines) {
      const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
        monitor.monitorId,
        monitor.timelines,
        window,
      );

      for (const event of events) {
        if (
          !earliestEventStart ||
          event.startDate.getTime() < earliestEventStart.getTime()
        ) {
          earliestEventStart = event.startDate;
        }
      }
    }

    return earliestEventStart;
  }

  /**
   * Merges overlapping and adjacent intervals into a disjoint, sorted set.
   * Millisecond-precise (raw timestamps, not second-granularity moment
   * comparisons) so the merged length agrees with
   * OneUptimeDate.getSecondsBetweenDates.
   */
  public static mergeIntervals(
    intervals: Array<DowntimeInterval>,
  ): Array<DowntimeInterval> {
    const sorted: Array<DowntimeInterval> = [...intervals].sort(
      (a: DowntimeInterval, b: DowntimeInterval) => {
        return a.startDate.getTime() - b.startDate.getTime();
      },
    );

    const merged: Array<DowntimeInterval> = [];

    for (const interval of sorted) {
      // skip empty / inverted intervals.
      if (interval.endDate.getTime() <= interval.startDate.getTime()) {
        continue;
      }

      const last: DowntimeInterval | undefined = merged[merged.length - 1];

      // overlapping OR adjacent (start === last end) -> extend the last interval.
      if (last && interval.startDate.getTime() <= last.endDate.getTime()) {
        if (interval.endDate.getTime() > last.endDate.getTime()) {
          last.endDate = interval.endDate;
        }
        continue;
      }

      merged.push({
        startDate: interval.startDate,
        endDate: interval.endDate,
      });
    }

    return merged;
  }

  /**
   * Union downtime across monitors: per monitor, extract its down intervals from
   * its OWN event list, then take the interval union across monitors and sum the
   * seconds. This is the AnyDown numerator.
   *
   * The correctness case this exists for: Monitor A Offline 10:00-11:00 while
   * Monitor B is Operational 10:30-12:00 must yield 3600 seconds of downtime,
   * NOT 1800 - which is what the cross-monitor priority flatten in
   * UptimeUtil.getNonOverlappingMonitorEvents produces.
   */
  public static getUnionDowntimeSeconds(
    perMonitor: Array<MonitorTimelineSet>,
    downtimeStatuses: Array<MonitorStatus>,
    window: UptimeWindow,
  ): number {
    const allIntervals: Array<DowntimeInterval> = [];

    for (const monitor of perMonitor) {
      allIntervals.push(
        ...this.getDowntimeIntervalsForMonitor(
          monitor.monitorId,
          monitor.timelines,
          downtimeStatuses,
          window,
        ),
      );
    }

    const merged: Array<DowntimeInterval> = this.mergeIntervals(allIntervals);

    let totalSeconds: number = 0;

    for (const interval of merged) {
      totalSeconds += OneUptimeDate.getSecondsBetweenDates(
        interval.startDate,
        interval.endDate,
      );
    }

    return totalSeconds;
  }

  /**
   * Time-based SLI over MonitorStatusTimeline data.
   *
   * Denominator rules:
   * - The window end is always clipped to "now" (a window reaching into the
   *   future must not inflate the denominator).
   * - AnyDown: the window start is clamped forward to the EARLIEST first event
   *   across the attached monitors, so a young SLO is measured from its first
   *   data point, not diluted by time before any monitor existed. The clamp uses
   *   the merged set's earliest event so that one old monitor anchors the window
   *   for the whole SLO.
   * - MonitorSecondsAverage: the clamp happens PER MONITOR (each monitor's own
   *   first event), mirroring UptimeUtil.getTotalDowntimeInSeconds - otherwise
   *   adding a young monitor dilutes the SLI.
   *
   * No data at all (no timeline rows for any monitor) => totalSeconds 0,
   * sliPercentage 100 - callers decide what "no data" means (the evaluator marks
   * such SLOs Misconfigured/Paused; it never treats them as healthy 100%).
   *
   * Rows exist but none overlap the window => the monitor was up for the whole
   * window as far as the window can tell: full-window denominator, 0 bad seconds
   * (same answer UptimeUtil gives - see the "orphaned row" production incident
   * test in UptimeUtil.test.ts).
   *
   * All values are UNROUNDED.
   */
  public static computeTimeSli(data: {
    perMonitorTimelines: Array<MonitorTimelineSet>;
    downtimeStatuses: Array<MonitorStatus>;
    window: UptimeWindow;
    mode: SloMultiMonitorMode;
  }): TimeSliResult {
    const { perMonitorTimelines, downtimeStatuses, window, mode } = data;

    const hasAnyTimelineRows: boolean = perMonitorTimelines.some(
      (monitor: MonitorTimelineSet) => {
        return monitor.timelines.length > 0;
      },
    );

    if (!hasAnyTimelineRows) {
      return {
        badSeconds: 0,
        totalSeconds: 0,
        sliPercentage: 100,
      };
    }

    if (mode === SloMultiMonitorMode.MonitorSecondsAverage) {
      return this.computeMonitorSecondsAverageSli({
        perMonitorTimelines,
        downtimeStatuses,
        window,
      });
    }

    return this.computeAnyDownSli({
      perMonitorTimelines,
      downtimeStatuses,
      window,
    });
  }

  private static computeAnyDownSli(data: {
    perMonitorTimelines: Array<MonitorTimelineSet>;
    downtimeStatuses: Array<MonitorStatus>;
    window: UptimeWindow;
  }): TimeSliResult {
    const { perMonitorTimelines, downtimeStatuses, window } = data;

    const windowEndDate: Date = OneUptimeDate.getLesserDate(
      window.endDate,
      OneUptimeDate.getCurrentDate(),
    );

    /*
     * Earliest first event across monitors. Events from getMonitorEventsForId are
     * already clipped to the window, so every start is >= window.startDate: the
     * clamp can only move the window start FORWARD (young SLO), never backward.
     */
    const earliestEventStart: Date | null = this.getEarliestEventStartDate(
      perMonitorTimelines,
      window,
    );

    /*
     * Rows exist but none clip into the window: as far as the window can tell the
     * monitors were up throughout - full-window denominator, zero bad seconds
     * (matches UptimeUtil's behaviour for the same input).
     */
    const windowStartDate: Date = earliestEventStart
      ? OneUptimeDate.getGreaterDate(window.startDate, earliestEventStart)
      : window.startDate;

    const totalSeconds: number = OneUptimeDate.getSecondsBetweenDates(
      windowStartDate,
      windowEndDate,
    );

    if (totalSeconds <= 0) {
      return {
        badSeconds: 0,
        totalSeconds: 0,
        sliPercentage: 100,
      };
    }

    const badSeconds: number = this.getUnionDowntimeSeconds(
      perMonitorTimelines,
      downtimeStatuses,
      window,
    );

    return {
      badSeconds,
      totalSeconds,
      sliPercentage: ((totalSeconds - badSeconds) / totalSeconds) * 100,
    };
  }

  private static computeMonitorSecondsAverageSli(data: {
    perMonitorTimelines: Array<MonitorTimelineSet>;
    downtimeStatuses: Array<MonitorStatus>;
    window: UptimeWindow;
  }): TimeSliResult {
    const { perMonitorTimelines, downtimeStatuses, window } = data;

    let badSeconds: number = 0;
    let totalSeconds: number = 0;

    for (const monitor of perMonitorTimelines) {
      /*
       * Guard against rows of other monitors leaking into this monitor's array -
       * getTotalDowntimeInSeconds does not filter by monitor id, and feeding it a
       * multi-monitor array would reintroduce the priority-flatten bug.
       */
      const ownTimelines: Array<MonitorStatusTimeline> =
        monitor.timelines.filter((timeline: MonitorStatusTimeline) => {
          return (
            timeline.monitorId?.toString() === monitor.monitorId.toString()
          );
        });

      /*
       * A monitor with no timeline rows at all has no data - skip it instead of
       * letting it contribute a full window of implied uptime.
       */
      if (ownTimelines.length === 0) {
        continue;
      }

      const {
        totalDowntimeInSeconds,
        totalSecondsInTimePeriod,
      }: { totalDowntimeInSeconds: number; totalSecondsInTimePeriod: number } =
        UptimeUtil.getTotalDowntimeInSeconds(
          ownTimelines,
          downtimeStatuses,
          window,
        );

      badSeconds += totalDowntimeInSeconds;
      totalSeconds += totalSecondsInTimePeriod;
    }

    if (totalSeconds <= 0) {
      return {
        badSeconds: 0,
        totalSeconds: 0,
        sliPercentage: 100,
      };
    }

    return {
      badSeconds,
      totalSeconds,
      sliPercentage: (1 - badSeconds / totalSeconds) * 100,
    };
  }

  /**
   * Error budget from an SLI measurement.
   *
   * Provide either `sliPercentage` or `badSeconds` (badSeconds wins when both are
   * given, since it is the exact number the SLI was derived from).
   *
   * budgetRemainingSeconds is SIGNED - negative when over budget. Never clamp it
   * here; clamp in the UI only. budgetRemainingPercentage is capped at 100 but
   * NOT floored at 0.
   */
  public static getErrorBudget(data: {
    sliPercentage?: number | undefined;
    badSeconds?: number | undefined;
    totalSeconds: number;
    targetPercentage: number;
  }): ErrorBudgetResult {
    const { sliPercentage, badSeconds, totalSeconds, targetPercentage } = data;

    this.validateTargetPercentage(targetPercentage);

    if (badSeconds === undefined && sliPercentage === undefined) {
      throw new BadDataException(
        "Either sliPercentage or badSeconds must be provided to compute the error budget.",
      );
    }

    // no elapsed window yet => nothing consumed, full budget remaining.
    if (totalSeconds === 0) {
      return {
        budgetTotalSeconds: 0,
        budgetConsumedSeconds: 0,
        budgetRemainingSeconds: 0,
        budgetRemainingPercentage: 100,
      };
    }

    const allowedBadFraction: number = 1 - targetPercentage / 100;

    const budgetTotalSeconds: number = allowedBadFraction * totalSeconds;

    const budgetConsumedSeconds: number =
      badSeconds !== undefined
        ? badSeconds
        : (1 - sliPercentage! / 100) * totalSeconds;

    const budgetRemainingSeconds: number =
      budgetTotalSeconds - budgetConsumedSeconds;

    const budgetRemainingPercentage: number = Math.min(
      100,
      (budgetRemainingSeconds / budgetTotalSeconds) * 100,
    );

    return {
      budgetTotalSeconds,
      budgetConsumedSeconds,
      budgetRemainingSeconds,
      budgetRemainingPercentage,
    };
  }

  /**
   * Burn rate: how many times faster than "exactly on target" the budget is being
   * consumed over the measured period. 1 = burning exactly the sustainable rate,
   * 14.4 = the canonical fast-burn page threshold for a 30-day window.
   *
   * Works identically for seconds (time-based SLIs) and event counts (event-based
   * SLIs) - pass bad/total counts in badSeconds/totalSeconds.
   *
   * totalSeconds === 0 (no data in the lookback) => 0: no evidence of burn -
   * callers skip burn rules on no-data windows.
   */
  public static computeBurnRate(data: {
    badSeconds: number;
    totalSeconds: number;
    targetPercentage: number;
  }): number {
    const { badSeconds, totalSeconds, targetPercentage } = data;

    this.validateTargetPercentage(targetPercentage);

    if (totalSeconds === 0) {
      return 0;
    }

    const allowedBadFraction: number = 1 - targetPercentage / 100;

    return badSeconds / totalSeconds / allowedBadFraction;
  }

  /**
   * Status from remaining budget, with hysteresis so rolling windows that
   * re-cross a boundary as bad seconds age out do not flap:
   *
   * - enter BudgetExhausted when remaining <= 0; exit only when remaining >= 2
   * - enter AtRisk when remaining <= atRiskThreshold; exit back to Healthy only
   *   when remaining >= atRiskThreshold + 5
   *
   * All comparisons use UNROUNDED percentages. This function never emits
   * Misconfigured or Paused - those are set by the caller (zero monitors /
   * all monitors paused) before any math runs.
   */
  public static computeSloStatus(data: {
    budgetRemainingPercentage: number;
    currentStatus: SloStatus;
    atRiskThresholdPercentage: number;
  }): SloStatus {
    const { budgetRemainingPercentage, currentStatus } = data;
    const threshold: number = data.atRiskThresholdPercentage;

    // enter exhausted.
    if (budgetRemainingPercentage <= 0) {
      return SloStatus.BudgetExhausted;
    }

    // hysteresis: stay exhausted until the budget has meaningfully recovered.
    if (
      currentStatus === SloStatus.BudgetExhausted &&
      budgetRemainingPercentage < 2
    ) {
      return SloStatus.BudgetExhausted;
    }

    // enter at risk.
    if (budgetRemainingPercentage <= threshold) {
      return SloStatus.AtRisk;
    }

    // hysteresis: stay at risk until comfortably above the threshold.
    if (
      currentStatus === SloStatus.AtRisk &&
      budgetRemainingPercentage < threshold + 5
    ) {
      return SloStatus.AtRisk;
    }

    return SloStatus.Healthy;
  }

  /**
   * The full calendar month containing `at`, resolved in the given IANA timezone
   * (default UTC - calendar boundaries are undefined without a zone). Timezone
   * support comes from moment-timezone, which OneUptimeDate already wraps.
   *
   * `endDate` is EXCLUSIVE (the first instant of the next month).
   * `totalSecondsInFullPeriod` is the real elapsed seconds of the whole month and
   * is the budget denominator for calendar windows - fixed at period start, NOT
   * elapsed time. Note the rollover consequence: on the 1st the budget silently
   * resets to full.
   */
  public static getCalendarMonthWindow(data: {
    timezone?: string | undefined;
    at: Date;
  }): CalendarMonthWindow {
    const timezone: string = data.timezone || "UTC";

    if (!Moment.tz.zone(timezone)) {
      throw new BadDataException(`Unknown timezone: ${timezone}`);
    }

    const startOfMonth: ReturnType<typeof Moment.tz> = Moment.tz(
      data.at,
      timezone,
    ).startOf("month");

    const startDate: Date = startOfMonth.toDate();
    const endDate: Date = startOfMonth.clone().add(1, "month").toDate();

    return {
      startDate,
      endDate,
      totalSecondsInFullPeriod: OneUptimeDate.getSecondsBetweenDates(
        startDate,
        endDate,
      ),
    };
  }

  /**
   * Display-only rounding (delegates to UptimeUtil.roundToPrecision, which
   * FLOORS). All status/threshold comparisons in this util use unrounded values;
   * use this at render time only - never before classification.
   */
  public static roundForDisplay(
    value: number,
    precision: UptimePrecision,
  ): number {
    return UptimeUtil.roundToPrecision({
      number: value,
      precision,
    });
  }

  private static validateTargetPercentage(targetPercentage: number): void {
    /*
     * target >= 100 makes allowedBadFraction 0 (or negative): every budget
     * formula divides by zero and NaN propagates everywhere. target <= 0 is
     * meaningless.
     */
    if (targetPercentage >= 100 || targetPercentage <= 0) {
      throw new BadDataException(
        "SLO target percentage must be greater than 0 and less than 100.",
      );
    }
  }
}
