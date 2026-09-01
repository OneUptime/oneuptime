import OneUptimeDate from "../../Types/Date";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import Event from "../Uptime/Event";
import UptimeUtil, { UptimeWindow } from "../Uptime/UptimeUtil";

/*
 * Turns MonitorStatusTimeline rows into the geometry a "state timeline"
 * renders: one lane per monitor, and inside each lane a run of coloured
 * segments positioned as percentages of the visible window.
 *
 * Deliberately pure — no React, no database, no clock of its own beyond what
 * UptimeUtil already consults — so the arithmetic that decides where a bar
 * starts, how wide it is, and what uptime it reports can be tested directly.
 *
 * The event math itself is NOT re-implemented here. UptimeUtil already owns
 * the hard parts (clipping an event to a window, resolving an open row with
 * endsAt = null against the next row or "now", and computing an uptime
 * percentage whose denominator does not count time before a monitor's first
 * recorded event). This module only converts those events into geometry.
 */

/**
 * A segment is one contiguous run of a single status inside the window,
 * already clipped to it. `startPercent` and `widthPercent` are percentages of
 * the window's width, so a renderer can place them without knowing any dates.
 */
export interface MonitorStateTimelineSegment {
  monitorStatusId: string;
  label: string;
  color: string;
  startDate: Date;
  endDate: Date;
  durationInSeconds: number;
  startPercent: number;
  widthPercent: number;
  /*
   * The monitor was STILL in this state at the right edge of the window, so
   * the segment's end is where the chart stops, not where the state did.
   * Only the last segment of a lane can carry it.
   */
  continuesAfterWindow: boolean;
  /*
   * The monitor was ALREADY in this state when the window opened, so the
   * segment's start is where the chart begins, not where the state did. Only
   * the first segment of a lane can carry it.
   */
  beganBeforeWindow: boolean;
}

/** One lane of the timeline: a single monitor and everything it did. */
export interface MonitorStateTimelineRow {
  monitorId: string;
  monitorName: string;
  segments: Array<MonitorStateTimelineSegment>;
  /*
   * Uptime over the visible window, or null when this monitor has no status
   * history inside it at all — which is not the same as 0%, and must not be
   * rendered as if it were.
   */
  uptimePercent: number | null;
  /** The status the monitor is in at the END of the window. */
  currentStatusName: string | undefined;
  currentStatusColor: string | undefined;
  /** Start of the last segment, i.e. when the status last changed. */
  lastStatusChangeAt: Date | null;
}

/*
 * The longest range a state timeline will draw.
 *
 * A timeline row is written on every status CHANGE, so an unbounded window on
 * a flapping fleet is an unbounded read, and a lane thousands of segments deep
 * is unreadable anyway. 92 days matches the longest range the dashboard's own
 * time picker offers (TimeRange.PAST_THREE_MONTHS); a longer CUSTOM range is
 * clamped to it.
 *
 * Both ends of the wire share this number. The public route enforces it, and
 * the browser applies it BEFORE it draws, so the axis never labels a span the
 * server was never asked about.
 */
export const MAX_STATE_TIMELINE_WINDOW_IN_DAYS: number = 92;

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

/** One label under the timeline axis. */
export interface MonitorStateTimelineAxisTick {
  date: Date;
  percent: number;
}

/** A distinct status shown in the timeline, for the legend. */
export interface MonitorStateTimelineLegendItem {
  monitorStatusId: string;
  label: string;
  color: string;
}

export interface MonitorStateTimelineInput {
  /*
   * The monitors to render, in the order they should appear. A monitor with
   * no timeline rows still gets a lane — an empty lane is the honest answer
   * to "this device has no recorded history in this window".
   */
  monitors: Array<{
    monitorId: string;
    monitorName: string;
  }>;
  statusTimelines: Array<MonitorStatusTimeline>;
  startDate: Date;
  endDate: Date;
  uptimePrecision?: UptimePrecision | undefined;
}

export default class MonitorStateTimelineUtil {
  /**
   * True when the window is usable — a zero-length or inverted window has no
   * geometry, and every percentage computed from it would divide by zero.
   */
  public static isWindowValid(startDate: Date, endDate: Date): boolean {
    return endDate.getTime() > startDate.getTime();
  }

  /**
   * The window a timeline may actually draw, given the one the dashboard asked
   * for. A range longer than the ceiling keeps its END — that is the edge the
   * viewer is looking at — and has its start moved forward.
   */
  public static clampWindow(data: { startDate: Date; endDate: Date }): {
    startDate: Date;
    endDate: Date;
  } {
    const { startDate, endDate } = data;

    const maxWindowInMs: number =
      MAX_STATE_TIMELINE_WINDOW_IN_DAYS * MS_PER_DAY;

    if (endDate.getTime() - startDate.getTime() > maxWindowInMs) {
      return {
        startDate: new Date(endDate.getTime() - maxWindowInMs),
        endDate: endDate,
      };
    }

    return { startDate: startDate, endDate: endDate };
  }

  /**
   * Where `date` falls inside the window, as a 0-100 percentage, clamped to
   * the window at both ends. An invalid window pins everything to 0.
   */
  public static getPercentOfWindow(data: {
    date: Date;
    startDate: Date;
    endDate: Date;
  }): number {
    const { date, startDate, endDate } = data;

    if (!MonitorStateTimelineUtil.isWindowValid(startDate, endDate)) {
      return 0;
    }

    const windowMs: number = endDate.getTime() - startDate.getTime();
    const offsetMs: number = date.getTime() - startDate.getTime();

    const percent: number = (offsetMs / windowMs) * 100;

    return Math.min(100, Math.max(0, percent));
  }

  /**
   * The non-operational statuses appearing anywhere in `statusTimelines`.
   *
   * Derived from the rows the widget already fetched rather than from a
   * second query for the project's status list: every row carries its status,
   * and a status that never appears in the window cannot contribute downtime
   * to it either. A row whose status did not select `isOperationalState` is
   * treated as operational, so a missing column can only ever under-report
   * downtime, never invent it.
   */
  public static getDowntimeStatuses(
    statusTimelines: Array<MonitorStatusTimeline>,
  ): Array<MonitorStatus> {
    const byId: Map<string, MonitorStatus> = new Map<string, MonitorStatus>();

    for (const timeline of statusTimelines) {
      const status: MonitorStatus | undefined = timeline.monitorStatus;

      if (!status || !status.id) {
        continue;
      }

      if (status.isOperationalState === false) {
        byId.set(status.id.toString(), status);
      }
    }

    return Array.from(byId.values());
  }

  /**
   * The timeline rows belonging to one monitor. Callers hand us every row for
   * every monitor in one fetch (one query beats N), so each lane filters.
   */
  public static getTimelinesForMonitor(
    statusTimelines: Array<MonitorStatusTimeline>,
    monitorId: string,
  ): Array<MonitorStatusTimeline> {
    return statusTimelines.filter((timeline: MonitorStatusTimeline) => {
      /*
       * A row whose status did not come back fully joined is dropped rather
       * than passed on: UptimeUtil reads `monitorStatus.id` unguarded, so one
       * such row throws and takes the whole widget down — and buildRows runs
       * inside a render memo, not the fetch's try/catch, so the throw blanks
       * the dashboard rather than the lane. The `id` is checked, not merely
       * the relation: a status object present but without one fails in exactly
       * the same place, and getDowntimeStatuses below already tests for it.
       */
      return (
        timeline.monitorId?.toString() === monitorId &&
        Boolean(timeline.monitorStatus?.id)
      );
    });
  }

  /**
   * Whether the monitor was still in whatever state it was in when the window
   * closed — i.e. the run the last bar draws had not ended by then.
   *
   * Read off the RAW rows rather than the clipped events, because a clipped
   * event always ends at the window edge and so cannot tell the difference.
   * The row that covers the window end is the latest one starting at or before
   * it; if that row is open, or closes after the window, the state was still
   * running. Taking the LATEST such row is also what makes this immune to the
   * orphaned open rows (endsAt = NULL with a later successor) that
   * MonitorStatusTimelineReconciler exists to repair — an orphan is superseded
   * by the row that starts after it.
   */
  public static isStillInStateAtWindowEnd(
    statusTimelines: Array<MonitorStatusTimeline>,
    endDate: Date,
  ): boolean {
    let covering: MonitorStatusTimeline | null = null;

    for (const timeline of statusTimelines) {
      if (
        !timeline.startsAt ||
        timeline.startsAt.getTime() > endDate.getTime()
      ) {
        continue;
      }

      if (
        !covering ||
        !covering.startsAt ||
        timeline.startsAt.getTime() >= covering.startsAt.getTime()
      ) {
        covering = timeline;
      }
    }

    if (!covering) {
      return false;
    }

    return !covering.endsAt || covering.endsAt.getTime() > endDate.getTime();
  }

  /**
   * Whether the monitor was already in some state before the window opened —
   * i.e. the run the first bar draws started earlier than the chart does.
   *
   * Same shape as isStillInStateAtWindowEnd and read off the RAW rows for the
   * same reason: a clipped event always starts at the window edge, so it
   * cannot tell a status change that happened at that instant from one that
   * happened a year earlier.
   */
  public static beganBeforeWindowStart(
    statusTimelines: Array<MonitorStatusTimeline>,
    startDate: Date,
  ): boolean {
    return statusTimelines.some((timeline: MonitorStatusTimeline) => {
      if (!timeline.startsAt) {
        return false;
      }

      if (timeline.startsAt.getTime() >= startDate.getTime()) {
        return false;
      }

      // Still running when the window opened.
      return (
        !timeline.endsAt || timeline.endsAt.getTime() > startDate.getTime()
      );
    });
  }

  /**
   * One monitor's clipped events turned into positioned segments.
   *
   * Segments come back in chronological order. Zero-width segments are kept
   * out: UptimeUtil already drops events that do not overlap the window, and
   * a segment that rounds to no width is noise a renderer cannot draw.
   */
  public static buildSegments(data: {
    monitorId: string;
    statusTimelines: Array<MonitorStatusTimeline>;
    startDate: Date;
    endDate: Date;
  }): Array<MonitorStateTimelineSegment> {
    const { monitorId, statusTimelines, startDate, endDate } = data;

    if (!MonitorStateTimelineUtil.isWindowValid(startDate, endDate)) {
      return [];
    }

    const window: UptimeWindow = {
      startDate: startDate,
      endDate: endDate,
    };

    /*
     * Filtered here as well as in buildRows so this stays safe when called on
     * its own with every monitor's rows: the filter is what drops rows with no
     * usable status, which UptimeUtil would throw on.
     */
    const timelinesForMonitor: Array<MonitorStatusTimeline> =
      MonitorStateTimelineUtil.getTimelinesForMonitor(
        statusTimelines,
        monitorId,
      );

    /*
     * The NON-overlapping event list, which is the same one
     * UptimeUtil.calculateUptimePercentage derives its number from. Drawing
     * the raw list instead would let two overlapping rows paint bars summing
     * past the width of the lane while the percentage beside them was computed
     * from a different, split interpretation of the same rows.
     */
    const events: Array<Event> = UptimeUtil.getNonOverlappingMonitorEvents(
      timelinesForMonitor,
      window,
    );

    const segments: Array<MonitorStateTimelineSegment> = [];

    for (const event of events) {
      const startPercent: number = MonitorStateTimelineUtil.getPercentOfWindow({
        date: event.startDate,
        startDate: startDate,
        endDate: endDate,
      });

      const endPercent: number = MonitorStateTimelineUtil.getPercentOfWindow({
        date: event.endDate,
        startDate: startDate,
        endDate: endDate,
      });

      const widthPercent: number = endPercent - startPercent;

      if (widthPercent <= 0) {
        continue;
      }

      segments.push({
        monitorStatusId: event.eventStatusId.toString(),
        label: event.label,
        color: event.color.toString(),
        startDate: event.startDate,
        endDate: event.endDate,
        durationInSeconds: OneUptimeDate.getSecondsBetweenDates(
          event.startDate,
          event.endDate,
        ),
        startPercent: startPercent,
        widthPercent: widthPercent,
        // Both decided once the whole run is known — below.
        continuesAfterWindow: false,
        beganBeforeWindow: false,
      });
    }

    /*
     * UptimeUtil sorts by start date already, but it sorts the timeline rows
     * rather than the produced events, and an event list built from rows with
     * equal startsAt is only as ordered as its input. Sorting here keeps
     * "last segment == current status" true regardless.
     */
    segments.sort(
      (a: MonitorStateTimelineSegment, b: MonitorStateTimelineSegment) => {
        return a.startDate.getTime() - b.startDate.getTime();
      },
    );

    /*
     * Only the last bar can still be running: every earlier one is bounded by
     * the bar after it. Without this the hover card reads "Ended: <the current
     * time>" over an outage that is still happening.
     */
    const lastSegment: MonitorStateTimelineSegment | undefined =
      segments[segments.length - 1];

    if (lastSegment) {
      lastSegment.continuesAfterWindow =
        MonitorStateTimelineUtil.isStillInStateAtWindowEnd(
          timelinesForMonitor,
          endDate,
        );
    }

    /*
     * Likewise only the first bar can have been cut off at the left. It is
     * what tells the caller that the run it draws is older than the chart, so
     * the clipped start is not a status change that happened.
     */
    const firstSegment: MonitorStateTimelineSegment | undefined = segments[0];

    if (firstSegment) {
      firstSegment.beganBeforeWindow =
        MonitorStateTimelineUtil.beganBeforeWindowStart(
          timelinesForMonitor,
          startDate,
        );
    }

    return segments;
  }

  /**
   * The complete set of lanes for a state timeline widget.
   */
  public static buildRows(
    input: MonitorStateTimelineInput,
  ): Array<MonitorStateTimelineRow> {
    const { monitors, statusTimelines, startDate, endDate } = input;

    const precision: UptimePrecision =
      input.uptimePrecision ?? UptimePrecision.TWO_DECIMAL;

    const downtimeStatuses: Array<MonitorStatus> =
      MonitorStateTimelineUtil.getDowntimeStatuses(statusTimelines);

    const isValidWindow: boolean = MonitorStateTimelineUtil.isWindowValid(
      startDate,
      endDate,
    );

    return monitors.map(
      (monitor: {
        monitorId: string;
        monitorName: string;
      }): MonitorStateTimelineRow => {
        const timelinesForMonitor: Array<MonitorStatusTimeline> =
          MonitorStateTimelineUtil.getTimelinesForMonitor(
            statusTimelines,
            monitor.monitorId,
          );

        const segments: Array<MonitorStateTimelineSegment> =
          MonitorStateTimelineUtil.buildSegments({
            monitorId: monitor.monitorId,
            statusTimelines: timelinesForMonitor,
            startDate: startDate,
            endDate: endDate,
          });

        const lastSegment: MonitorStateTimelineSegment | undefined =
          segments[segments.length - 1];

        /*
         * No segments means no recorded history inside the window. Reporting
         * 100% there would claim an uptime the data does not support, and 0%
         * would invent an outage, so the row reports nothing at all.
         */
        const uptimePercent: number | null =
          segments.length > 0 && isValidWindow
            ? UptimeUtil.calculateUptimePercentage(
                timelinesForMonitor,
                precision,
                downtimeStatuses,
                { startDate: startDate, endDate: endDate },
              )
            : null;

        return {
          monitorId: monitor.monitorId,
          monitorName: monitor.monitorName,
          segments: segments,
          uptimePercent: uptimePercent,
          currentStatusName: lastSegment?.label,
          currentStatusColor: lastSegment?.color,
          /*
           * null when nothing CHANGED inside the window. A monitor that has
           * sat in one status since before the window opened has exactly one
           * segment, clipped to the window start — reporting that boundary as
           * a status change would tell an operator a seven-year-old
           * Operational monitor changed status an hour ago, and would move
           * forward on every auto-refresh.
           */
          lastStatusChangeAt:
            lastSegment && !lastSegment.beganBeforeWindow
              ? lastSegment.startDate
              : null,
        };
      },
    );
  }

  /**
   * Evenly spaced tick positions across the window, oldest first, including
   * both edges. `tickCount` is the number of ticks, so 2 gives just the two
   * edges. An invalid window, or fewer than two ticks, yields nothing to draw.
   */
  public static getAxisTicks(data: {
    startDate: Date;
    endDate: Date;
    tickCount: number;
  }): Array<MonitorStateTimelineAxisTick> {
    const { startDate, endDate, tickCount } = data;

    if (
      !MonitorStateTimelineUtil.isWindowValid(startDate, endDate) ||
      tickCount < 2
    ) {
      return [];
    }

    const windowMs: number = endDate.getTime() - startDate.getTime();
    const ticks: Array<MonitorStateTimelineAxisTick> = [];

    for (let i: number = 0; i < tickCount; i++) {
      const fraction: number = i / (tickCount - 1);

      ticks.push({
        date: new Date(startDate.getTime() + windowMs * fraction),
        percent: fraction * 100,
      });
    }

    return ticks;
  }

  /**
   * Every distinct status drawn across all lanes, in first-appearance order,
   * so the legend explains exactly the colours on screen and nothing else.
   */
  public static getLegend(
    rows: Array<MonitorStateTimelineRow>,
  ): Array<MonitorStateTimelineLegendItem> {
    const seen: Set<string> = new Set<string>();
    const legend: Array<MonitorStateTimelineLegendItem> = [];

    for (const row of rows) {
      for (const segment of row.segments) {
        if (seen.has(segment.monitorStatusId)) {
          continue;
        }

        seen.add(segment.monitorStatusId);
        legend.push({
          monitorStatusId: segment.monitorStatusId,
          label: segment.label,
          color: segment.color,
        });
      }
    }

    return legend;
  }
}
