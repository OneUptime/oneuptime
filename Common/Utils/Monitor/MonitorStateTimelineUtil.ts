import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorEvent from "../Uptime/MonitorEvent";
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
       * A row whose status did not come back joined is dropped rather than
       * passed on: UptimeUtil reads `monitorStatus.id` unguarded, so one such
       * row would throw and take the whole widget down. It happens when the
       * status was deleted out from under the row, and a lane that is missing
       * one segment is a far better outcome than a blank dashboard tile.
       */
      return (
        timeline.monitorId?.toString() === monitorId &&
        Boolean(timeline.monitorStatus)
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

    const events: Array<MonitorEvent> = UptimeUtil.getMonitorEventsForId(
      new ObjectID(monitorId),
      /*
       * Filtered here as well as in buildRows so this stays safe when called
       * on its own with every monitor's rows: the filter is what drops rows
       * with no joined status, which UptimeUtil would throw on.
       */
      MonitorStateTimelineUtil.getTimelinesForMonitor(
        statusTimelines,
        monitorId,
      ),
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
          lastStatusChangeAt: lastSegment ? lastSegment.startDate : null,
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
