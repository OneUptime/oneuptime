import Event from "./Event";
import MonitorEvent from "./MonitorEvent";
import { Green } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import WorstStatusTimeline, {
  WorstStatusTimelineOptions,
} from "./WorstStatusTimeline";

/**
 * The time period an uptime calculation is reported over. When this is supplied, events are
 * clipped to it and the denominator of the uptime percentage is the window itself - clipped to
 * now, and starting no earlier than the first recorded event (so a monitor younger than the
 * window is measured from its first event, not diluted by time it did not exist). Without it,
 * events run to the start of the next event (or now) and the denominator is "first event -> now",
 * which lets an open (endsAt = null) row from months ago leak into an unrelated report.
 */
export interface UptimeWindow {
  startDate: Date;
  endDate: Date;
}

/*
 * A row of one monitor's status timeline as the time it covers: from its
 * start to its end - an open row to the next row's start, or to now - and
 * clipped to the window when there is one.
 */
interface StatusTimelineRowSpan {
  row: MonitorStatusTimeline;
  startDate: Date;
  endDate: Date;
}

/*
 * Time one monitor's monitoring was turned off, as its status timeline
 * marks it (MonitorStatusTimeline.isMonitoringOff).
 */
export interface MonitoringOffSpan {
  monitorId: ObjectID;
  startDate: Date;
  endDate: Date;
}

// An interval in epoch milliseconds, start before end.
type MillisecondInterval = [number, number];

export default class UptimeUtil {
  /**
   * Chronological order for timeline rows, to the millisecond.
   *
   * Not OneUptimeDate.isAfter: that compares at SECOND granularity, so two
   * rows that start within the same wall-clock second compare as equal and
   * keep whatever order they arrived in. The server sends rows newest-first,
   * and a flapping monitor writes most of its transitions within a second of
   * each other (Offline at 12:47:40.326, back to Operational at .540). Left in
   * arrival order, the still-open Operational row sorted BEFORE the Offline
   * row it follows, took that row's start as its own end, and ended before it
   * began. The monitor's current status then never reached "now", so today's
   * bar had nothing in it and was painted the no-events colour - grey on a
   * page whose default bar colour is grey - while the monitor was up.
   *
   * On an exact tie a closed row sorts before an open one, so the open row is
   * the one that runs on to the next row or to now. This is the order
   * getRollingUptimeTotals and getDailyUptimeAggregate use server-side
   * (`ORDER BY startsAt, endsAt NULLS LAST`); the zero-length row a backfill
   * tie leaves behind can then never cut the open row short.
   */
  public static compareTimelinesChronologically(
    a: MonitorStatusTimeline,
    b: MonitorStatusTimeline,
  ): number {
    if (!a.startsAt || !b.startsAt) {
      return 0;
    }

    const startDifference: number =
      OneUptimeDate.fromString(a.startsAt).getTime() -
      OneUptimeDate.fromString(b.startsAt).getTime();

    if (startDifference !== 0) {
      return startDifference;
    }

    if (!a.endsAt && !b.endsAt) {
      return 0;
    }

    // closed before open.
    if (!a.endsAt) {
      return 1;
    }

    if (!b.endsAt) {
      return -1;
    }

    return (
      OneUptimeDate.fromString(a.endsAt).getTime() -
      OneUptimeDate.fromString(b.endsAt).getTime()
    );
  }

  /*
   * Whether a status timeline row covers time with the monitor's monitoring
   * turned off. Only an explicit true does: the column is NOT NULL and
   * defaults to false, so a row read without it was read without the
   * column, not with monitoring off.
   */
  public static isMonitoringOff(row: MonitorStatusTimeline): boolean {
    return row.isMonitoringOff === true;
  }

  /**
   * This function, `getMonitorEventsForId`, takes a `monitorId` as an argument and returns an array of `MonitorEvent` objects.
   *
   * Time with the monitor's monitoring turned off is no event (issue #6480): nothing checked
   * the monitor then, so the status its row holds is only what the last check saw before that.
   * The row still ends the row before it - an open row runs to the next row's start, whatever
   * that row is - and leaves a gap of its own, which getTotalDowntimeInSeconds leaves out of
   * the time it measures (getNotMonitoredSeconds).
   * @param {ObjectID} monitorId - The ID of the monitor for which events are to be fetched.
   * @param {UptimeWindow | undefined} window - If supplied, events are clipped to this window and events outside it are dropped.
   * @returns {Array<MonitorEvent>} - An array of `MonitorEvent` objects.
   */
  public static getMonitorEventsForId(
    monitorId: ObjectID,
    statusTimelineItems: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
  ): Array<MonitorEvent> {
    const eventList: Array<MonitorEvent> = [];

    for (const span of this.getRowSpansForId(
      monitorId,
      statusTimelineItems,
      window,
    )) {
      if (UptimeUtil.isMonitoringOff(span.row)) {
        continue;
      }

      // Push a new MonitorEvent object to the eventList array with properties from the current item and calculated dates.
      eventList.push({
        startDate: span.startDate,
        endDate: span.endDate,
        label: span.row.monitorStatus?.name || "Operational",
        priority: span.row.monitorStatus?.priority || 0,
        color: span.row.monitorStatus?.color || Green,
        monitorId: span.row.monitorId!,
        eventStatusId: span.row.monitorStatus!.id!,
      });
    }

    // Return the populated eventList array.
    return eventList;
  }

  /*
   * The time each monitor's monitoring was turned off, as its rows mark it:
   * clipped and ended exactly as getMonitorEventsForId clips and ends the
   * rows it turns into events, so the two never overlap. In start order.
   */
  public static getMonitoringOffSpans(
    items: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
  ): Array<MonitoringOffSpan> {
    const spans: Array<MonitoringOffSpan> = [];

    for (const monitorId of this.getMonitorIds(items)) {
      for (const span of this.getRowSpansForId(monitorId, items, window)) {
        if (!UptimeUtil.isMonitoringOff(span.row)) {
          continue;
        }

        spans.push({
          monitorId: monitorId,
          startDate: OneUptimeDate.fromString(span.startDate),
          endDate: OneUptimeDate.fromString(span.endDate),
        });
      }
    }

    return spans.sort((a: MonitoringOffSpan, b: MonitoringOffSpan): number => {
      return a.startDate.getTime() - b.startDate.getTime();
    });
  }

  /*
   * Seconds of [startDate, endDate] in which none of the monitors in `items`
   * was monitored: at each such instant every one of them either had its
   * monitoring turned off, or had no row yet. That time is no time at all
   * for uptime (issue #6480): neither up nor down. A gap in a timeline - a
   * row deleted from its middle - is read as it always was.
   *
   * Zero when no row marks monitoring off, so a timeline without such a
   * row is measured exactly as before.
   */
  public static getNotMonitoredSeconds(data: {
    items: Array<MonitorStatusTimeline>;
    startDate: Date;
    endDate: Date;
  }): number {
    const periodStart: number = OneUptimeDate.fromString(
      data.startDate,
    ).getTime();
    const periodEnd: number = OneUptimeDate.fromString(data.endDate).getTime();

    if (
      !(periodEnd > periodStart) ||
      !data.items.some((item: MonitorStatusTimeline): boolean => {
        return Boolean(item) && UptimeUtil.isMonitoringOff(item);
      })
    ) {
      return 0;
    }

    let notMonitored: Array<MillisecondInterval> | null = null;

    for (const monitorId of this.getMonitorIds(data.items)) {
      const intervals: Array<MillisecondInterval> = [];

      // Before its first row the monitor was not there to be checked.
      let firstRowStart: number | null = null;

      for (const item of data.items) {
        if (!item || item.monitorId?.toString() !== monitorId.toString()) {
          continue;
        }

        const startsAt: number = OneUptimeDate.fromString(
          item.startsAt || OneUptimeDate.getCurrentDate(),
        ).getTime();

        if (firstRowStart === null || startsAt < firstRowStart) {
          firstRowStart = startsAt;
        }
      }

      if (firstRowStart !== null && firstRowStart > periodStart) {
        intervals.push([periodStart, Math.min(firstRowStart, periodEnd)]);
      }

      for (const span of this.getRowSpansForId(monitorId, data.items)) {
        if (!UptimeUtil.isMonitoringOff(span.row)) {
          continue;
        }

        intervals.push([
          Math.max(
            OneUptimeDate.fromString(span.startDate).getTime(),
            periodStart,
          ),
          Math.min(OneUptimeDate.fromString(span.endDate).getTime(), periodEnd),
        ]);
      }

      const merged: Array<MillisecondInterval> =
        UptimeUtil.mergeMillisecondIntervals(intervals);

      notMonitored =
        notMonitored === null
          ? merged
          : UptimeUtil.intersectMillisecondIntervals(notMonitored, merged);

      if (notMonitored.length === 0) {
        return 0;
      }
    }

    let notMonitoredMilliseconds: number = 0;

    for (const interval of notMonitored || []) {
      notMonitoredMilliseconds += interval[1] - interval[0];
    }

    return notMonitoredMilliseconds / 1000;
  }

  // Sorted, disjoint and non-empty: overlapping or touching intervals joined.
  private static mergeMillisecondIntervals(
    intervals: Array<MillisecondInterval>,
  ): Array<MillisecondInterval> {
    const merged: Array<MillisecondInterval> = [];

    const sorted: Array<MillisecondInterval> = [...intervals].sort(
      (a: MillisecondInterval, b: MillisecondInterval): number => {
        return a[0] - b[0];
      },
    );

    for (const interval of sorted) {
      if (!(interval[1] > interval[0])) {
        continue;
      }

      const last: MillisecondInterval | undefined = merged[merged.length - 1];

      if (last && interval[0] <= last[1]) {
        last[1] = Math.max(last[1], interval[1]);
        continue;
      }

      merged.push([interval[0], interval[1]]);
    }

    return merged;
  }

  // The time both sorted, disjoint lists cover.
  private static intersectMillisecondIntervals(
    a: Array<MillisecondInterval>,
    b: Array<MillisecondInterval>,
  ): Array<MillisecondInterval> {
    const both: Array<MillisecondInterval> = [];
    let i: number = 0;
    let j: number = 0;

    while (i < a.length && j < b.length) {
      const start: number = Math.max(a[i]![0], b[j]![0]);
      const end: number = Math.min(a[i]![1], b[j]![1]);

      if (end > start) {
        both.push([start, end]);
      }

      if (a[i]![1] < b[j]![1]) {
        i++;
      } else {
        j++;
      }
    }

    return both;
  }

  // Every monitor the rows are of, once each, in the order first seen.
  private static getMonitorIds(
    items: Array<MonitorStatusTimeline>,
  ): Array<ObjectID> {
    const monitorIds: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of items) {
      const monitorId: string | undefined = item?.monitorId?.toString();

      if (!monitorId || seen.has(monitorId)) {
        continue;
      }

      seen.add(monitorId);
      monitorIds.push(new ObjectID(monitorId));
    }

    return monitorIds;
  }

  /*
   * One monitor's rows as the time each covers, in order: what
   * getMonitorEventsForId makes its events of, and getMonitoringOffSpans
   * and getNotMonitoredSeconds the time with monitoring off of.
   */
  private static getRowSpansForId(
    monitorId: ObjectID,
    statusTimelineItems: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
  ): Array<StatusTimelineRowSpan> {
    // make sure items are sorted by start date - to the millisecond, see compareTimelinesChronologically.

    let items: Array<MonitorStatusTimeline> = [...statusTimelineItems];

    items = items.sort(
      (a: MonitorStatusTimeline, b: MonitorStatusTimeline): number => {
        return UptimeUtil.compareTimelinesChronologically(a, b);
      },
    );

    const spans: Array<StatusTimelineRowSpan> = [];

    const monitorEvents: Array<MonitorStatusTimeline> = items.filter(
      (item: MonitorStatusTimeline) => {
        return item.monitorId?.toString() === monitorId.toString();
      },
    );

    // Loop through the items in the props object.
    for (let i: number = 0; i < monitorEvents.length; i++) {
      // If the current item is null or undefined, skip to the next iteration.
      if (!monitorEvents[i]) {
        continue;
      }

      // Set the start date of the event to the creation date of the current item. If it doesn't exist, use the current date.
      const startDate: Date =
        monitorEvents[i]!.startsAt || OneUptimeDate.getCurrentDate();

      // Initialize the end date as the current date.
      let endDate: Date | undefined = monitorEvents[i]!.endsAt;

      if (!endDate) {
        // check if there's next event, if there is, set the end date to the start date of the next event.
        if (i < monitorEvents.length - 1) {
          endDate = monitorEvents[i + 1]!.startsAt;
        }

        // if this is the last event, or the next event has no start date, then this event is still open and runs until now.
        if (!endDate) {
          endDate = OneUptimeDate.getCurrentDate();
        }
      }

      let eventStartDate: Date = startDate;
      let eventEndDate: Date = endDate;

      if (window) {
        /*
         * Clip the event to the reporting window. Without this an open (endsAt = null) row that
         * started months before the window contributes its entire life to the report.
         *
         * The end is also capped at "now", to match the denominator in
         * getTotalDowntimeInSeconds, which measures the window only up to the
         * current time (min(window.endDate, now)). If the numerator were allowed
         * to run to a future window.endDate while the denominator stopped at now,
         * a closed row ending in the future could make downtime exceed the elapsed
         * period and drive the raw percentage negative.
         */
        eventStartDate = OneUptimeDate.getGreaterDate(
          eventStartDate,
          window.startDate,
        );
        eventEndDate = OneUptimeDate.getLesserDate(
          eventEndDate,
          OneUptimeDate.getLesserDate(
            window.endDate,
            OneUptimeDate.getCurrentDate(),
          ),
        );

        // if the event does not overlap the window at all, then drop it.
        if (
          OneUptimeDate.getSecondsBetweenDates(eventStartDate, eventEndDate) <=
          0
        ) {
          continue;
        }
      } else if (
        OneUptimeDate.fromString(eventEndDate).getTime() <
        OneUptimeDate.fromString(eventStartDate).getTime()
      ) {
        /*
         * An event that ends before it starts covers nothing. Kept, it counts
         * negative seconds, which the day bars and the downtime sums then
         * subtract from real time. A row can only produce one from a corrupt
         * endsAt now that the rows are sorted to the millisecond.
         */
        continue;
      }

      spans.push({
        row: monitorEvents[i]!,
        startDate: eventStartDate,
        endDate: eventEndDate,
      });
    }

    return spans;
  }

  /*
   * Start-date order for events, to the millisecond rather than to the second
   * OneUptimeDate.isAfter compares at. Ties keep their existing order.
   */
  public static compareEventsByStartDate(a: Event, b: Event): number {
    return (
      OneUptimeDate.fromString(a.startDate).getTime() -
      OneUptimeDate.fromString(b.startDate).getTime()
    );
  }

  /**
   * One timeline out of the rows of one or more monitors: at every instant,
   * the worst status among the monitors recorded then, and nothing where
   * none was. See WorstStatusTimeline.merge.
   *
   * Pass the downtime statuses when the result is measured for uptime: they
   * then outrank every other status, so the time it counts as down is
   * exactly the time at least one of the monitors was down - what a monitor
   * group's uptime percentage is measured from on the server
   * (MonitorStatusTimelineService.getMergedDowntimeSeconds).
   */
  public static getNonOverlappingMonitorEvents(
    items: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
    options?: WorstStatusTimelineOptions | undefined,
  ): Array<Event> {
    return WorstStatusTimeline.merge(this.getMonitorEvents(items, window), {
      downtimeMonitorStatusIds: options?.downtimeMonitorStatusIds,
    });
  }

  public static getMonitorEvents(
    items: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
  ): Array<MonitorEvent> {
    // get all distinct monitor ids.
    const monitorIds: Array<ObjectID> = this.getMonitorIds(items);

    const eventList: Array<MonitorEvent> = [];
    // convert data to events.

    for (const monitorId of monitorIds) {
      const monitorEvents: Array<MonitorEvent> = this.getMonitorEventsForId(
        monitorId,
        items,
        window,
      );
      eventList.push(...monitorEvents);
    }

    /*
     * sort event list by start date, to the millisecond. Events from several
     * monitors (a monitor group) that start within the same second must still
     * come out in the order they happened - see compareTimelinesChronologically.
     */
    eventList.sort((a: MonitorEvent, b: MonitorEvent): number => {
      return UptimeUtil.compareEventsByStartDate(a, b);
    });

    return [...eventList];
  }

  public static getTotalDowntimeInSeconds(
    monitorStatusTimelines: Array<MonitorStatusTimeline>,
    downtimeMonitorStatuses: Array<MonitorStatus>,
    window?: UptimeWindow | undefined,
  ): {
    totalDowntimeInSeconds: number;
    totalSecondsInTimePeriod: number;
  } {
    const monitorEvents: Array<Event> = this.getNonOverlappingMonitorEvents(
      monitorStatusTimelines,
      window,
      {
        downtimeMonitorStatusIds: (downtimeMonitorStatuses || [])
          .map((status: MonitorStatus): string => {
            return status.id?.toString() || "";
          })
          .filter(Boolean),
      },
    );

    // sort these by start date, to the millisecond.
    monitorEvents.sort((a: Event, b: Event): number => {
      return UptimeUtil.compareEventsByStartDate(a, b);
    });

    /*
     * If a window is supplied then the time period is the window itself, and not "first event -> now".
     * Two clamps apply to the window:
     *
     *   - The window end is clipped to now, so a window that reaches into the future does not
     *     inflate the denominator (which is what made the reported percentage drift upwards
     *     every day).
     *
     *   - The window start is clamped forward to the first event's start, so time from before
     *     the monitor's first recorded event does not count as uptime. Events are already
     *     clipped to the window, so this only moves the start when the monitor has NO data for
     *     the head of the window - i.e. it is younger than the window. Without this a monitor
     *     created a day ago and Offline ever since would report ~98.9% uptime over a 90 day
     *     window; with it, it reports 0% - the same answer the windowless
     *     "first event -> now" denominator always gave.
     *
     * When there are no events at all there is nothing to clamp to and the denominator is the
     * full (now-clipped) window.
     *
     * Either way, the time in it that none of the monitors was monitored - each had its
     * monitoring turned off, or no row yet - is left out (getNotMonitoredSeconds, issue #6480).
     * Their rows hold no events for it, so it would otherwise count as up. A window nothing was
     * monitored in at all measures no time: 0.
     */
    let windowSecondsInTimePeriod: number | null = null;

    // The period measured, which the time nothing was monitored is taken out of.
    let periodStartDate: Date | null = null;
    let periodEndDate: Date | null = null;

    if (window) {
      const windowEndDate: Date = OneUptimeDate.getLesserDate(
        window.endDate,
        OneUptimeDate.getCurrentDate(),
      );

      const windowStartDate: Date =
        monitorEvents.length > 0
          ? OneUptimeDate.getGreaterDate(
              window.startDate,
              monitorEvents[0]!.startDate,
            )
          : window.startDate;

      windowSecondsInTimePeriod = OneUptimeDate.getSecondsBetweenDates(
        windowStartDate,
        windowEndDate,
      );

      // never let the denominator be zero or negative.
      if (!windowSecondsInTimePeriod || windowSecondsInTimePeriod < 0) {
        windowSecondsInTimePeriod = 1;
      }

      periodStartDate = windowStartDate;
      periodEndDate = windowEndDate;
    }

    // calculate number of seconds between start of first event to date time now.
    let totalSecondsInTimePeriod: number = 0;

    if (monitorEvents.length === 0) {
      return {
        totalDowntimeInSeconds: 0,
        totalSecondsInTimePeriod:
          windowSecondsInTimePeriod === null
            ? 1
            : UptimeUtil.withoutNotMonitoredSeconds({
                seconds: windowSecondsInTimePeriod,
                items: monitorStatusTimelines,
                startDate: periodStartDate!,
                endDate: periodEndDate!,
              }),
      };
    }

    if (windowSecondsInTimePeriod !== null) {
      totalSecondsInTimePeriod = windowSecondsInTimePeriod;
    } else {
      if (
        OneUptimeDate.isAfter(
          monitorEvents[0]!.startDate,
          OneUptimeDate.getCurrentDate(),
        )
      ) {
        return {
          totalDowntimeInSeconds: 0,
          totalSecondsInTimePeriod: 1,
        };
      }

      totalSecondsInTimePeriod =
        OneUptimeDate.getSecondsBetweenDates(
          monitorEvents[0]!.startDate,
          OneUptimeDate.getCurrentDate(),
        ) || 1;

      periodStartDate = monitorEvents[0]!.startDate;
      periodEndDate = OneUptimeDate.getCurrentDate();
    }

    totalSecondsInTimePeriod = UptimeUtil.withoutNotMonitoredSeconds({
      seconds: totalSecondsInTimePeriod,
      items: monitorStatusTimelines,
      startDate: periodStartDate!,
      endDate: periodEndDate!,
    });

    // get order of operational state.

    // if the event belongs to less than operationalStatePriority, then add the seconds to the total seconds.

    let totalDowntime: number = 0;

    for (const monitorEvent of monitorEvents) {
      const isDowntimeEvent: boolean = Boolean(
        downtimeMonitorStatuses.find((item: MonitorStatus) => {
          return item.id?.toString() === monitorEvent.eventStatusId.toString();
        }),
      );

      if (isDowntimeEvent) {
        totalDowntime += OneUptimeDate.getSecondsBetweenDates(
          monitorEvent.startDate,
          monitorEvent.endDate,
        );
      }
    }

    return {
      totalDowntimeInSeconds: totalDowntime,
      totalSecondsInTimePeriod,
    };
  }

  public static roundToPrecision(data: {
    number: number;
    precision: UptimePrecision;
  }): number {
    const { number, precision } = data;

    if (precision === UptimePrecision.NO_DECIMAL) {
      return Math.floor(number);
    }

    if (precision === UptimePrecision.ONE_DECIMAL) {
      return Math.floor(number * 10) / 10;
    }

    if (precision === UptimePrecision.TWO_DECIMAL) {
      return Math.floor(number * 100) / 100;
    }

    if (precision === UptimePrecision.THREE_DECIMAL) {
      return Math.floor(number * 1000) / 1000;
    }

    return number;
  }

  public static calculateUptimePercentage(
    monitorStatusTimelines: Array<MonitorStatusTimeline>,
    precision: UptimePrecision,
    downtimeMonitorStatuses: Array<MonitorStatus>,
    window?: UptimeWindow | undefined,
  ): number {
    // calculate percentage.

    return this.toUptimePercentage({
      totals: this.getTotalDowntimeInSeconds(
        monitorStatusTimelines,
        downtimeMonitorStatuses,
        window,
      ),
      precision: precision,
    });
  }

  /*
   * calculateUptimePercentage, or null when none of the period was
   * monitored - every monitor's rows in it mark its monitoring off - so a
   * reader can show no percentage rather than the 100% that no time at all
   * reads as (issue #6480).
   */
  public static calculateUptimePercentageOfMonitoredTime(
    monitorStatusTimelines: Array<MonitorStatusTimeline>,
    precision: UptimePrecision,
    downtimeMonitorStatuses: Array<MonitorStatus>,
    window?: UptimeWindow | undefined,
  ): number | null {
    const totals: {
      totalDowntimeInSeconds: number;
      totalSecondsInTimePeriod: number;
    } = this.getTotalDowntimeInSeconds(
      monitorStatusTimelines,
      downtimeMonitorStatuses,
      window,
    );

    if (!(totals.totalSecondsInTimePeriod > 0)) {
      return null;
    }

    return this.toUptimePercentage({ totals: totals, precision: precision });
  }

  /*
   * The period's seconds without those in it that none of the monitors was
   * monitored (getNotMonitoredSeconds), never below zero.
   */
  private static withoutNotMonitoredSeconds(data: {
    seconds: number;
    items: Array<MonitorStatusTimeline>;
    startDate: Date;
    endDate: Date;
  }): number {
    const notMonitoredSeconds: number = this.getNotMonitoredSeconds({
      items: data.items,
      startDate: data.startDate,
      endDate: data.endDate,
    });

    if (!(notMonitoredSeconds > 0)) {
      return data.seconds;
    }

    return Math.max(0, data.seconds - notMonitoredSeconds);
  }

  private static toUptimePercentage(data: {
    totals: {
      totalDowntimeInSeconds: number;
      totalSecondsInTimePeriod: number;
    };
    precision: UptimePrecision;
  }): number {
    const { totalDowntimeInSeconds, totalSecondsInTimePeriod } = data.totals;
    const precision: UptimePrecision = data.precision;

    if (totalSecondsInTimePeriod === 0) {
      return 100;
    }

    if (totalDowntimeInSeconds === 0) {
      return 100;
    }

    const percentage: number =
      ((totalSecondsInTimePeriod - totalDowntimeInSeconds) /
        totalSecondsInTimePeriod) *
      100;

    /*
     * clamp before rounding. roundToPrecision floors, so an out of range value would otherwise
     * escape as is (for example -13.5 stays -13.5 and never becomes 0).
     */
    const clampedPercentage: number = Math.min(100, Math.max(0, percentage));

    return this.roundToPrecision({
      number: clampedPercentage,
      precision,
    });
  }

  /**
   * Uptime over the seconds that were actually recorded, or null when none
   * were, so a caller can tell a resource with no data from one that was up.
   *
   * Both uncapped figures come through here: a single monitor's, from its
   * day buckets, and a merged one from getMergedDowntimeSeconds. Measured
   * over coverage rather than the window, a monitor younger than the window
   * is measured from its first reading. Clamped to [0, 100], then rounded
   * down to the precision the way every other uptime figure is.
   */
  public static calculateUptimePercentOfCoveredSeconds(data: {
    coveredSeconds: number;
    downtimeSeconds: number;
    precision: UptimePrecision;
  }): number | null {
    if (!(data.coveredSeconds > 0)) {
      return null;
    }

    const percentage: number =
      ((data.coveredSeconds - data.downtimeSeconds) / data.coveredSeconds) *
      100;

    return this.roundToPrecision({
      number: Math.min(100, Math.max(0, percentage)),
      precision: data.precision,
    });
  }

  public static calculateAvgUptimePercentage(data: {
    uptimePercentages: Array<number>;
    precision: UptimePrecision;
  }): number {
    // calculate percentage.

    const { uptimePercentages, precision } = data;

    if (uptimePercentages.length === 0) {
      return 100;
    }

    let totalUptimePercentage: number = 0;

    for (const uptimePercentage of uptimePercentages) {
      totalUptimePercentage += uptimePercentage;
    }

    const percentage: number = totalUptimePercentage / uptimePercentages.length;

    return this.roundToPrecision({
      number: percentage,
      precision,
    });
  }
}
