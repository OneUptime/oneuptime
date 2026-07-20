import Event from "./Event";
import MonitorEvent from "./MonitorEvent";
import { Green } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";

/**
 * The time period an uptime calculation is reported over. When this is supplied, events are
 * clipped to it and the denominator of the uptime percentage is the window itself. Without it,
 * events run to the start of the next event (or now) and the denominator is "first event -> now",
 * which lets an open (endsAt = null) row from months ago leak into an unrelated report.
 */
export interface UptimeWindow {
  startDate: Date;
  endDate: Date;
}

export default class UptimeUtil {
  /**
   * This function, `getMonitorEventsForId`, takes a `monitorId` as an argument and returns an array of `MonitorEvent` objects.
   * @param {ObjectID} monitorId - The ID of the monitor for which events are to be fetched.
   * @param {UptimeWindow | undefined} window - If supplied, events are clipped to this window and events outside it are dropped.
   * @returns {Array<MonitorEvent>} - An array of `MonitorEvent` objects.
   */
  public static getMonitorEventsForId(
    monitorId: ObjectID,
    statusTimelineItems: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
  ): Array<MonitorEvent> {
    // Initialize an empty array to store the monitor events.

    // make sure items are sorted by start date.

    let items: Array<MonitorStatusTimeline> = [...statusTimelineItems];

    items = items.sort((a: MonitorStatusTimeline, b: MonitorStatusTimeline) => {
      if (!a.startsAt || !b.startsAt) {
        return 0;
      }

      if (OneUptimeDate.isAfter(a.startsAt!, b.startsAt!)) {
        return 1;
      }

      if (OneUptimeDate.isAfter(b.startsAt!, a.startsAt!)) {
        return -1;
      }

      return 0;
    });

    const eventList: Array<MonitorEvent> = [];

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
      }

      // Push a new MonitorEvent object to the eventList array with properties from the current item and calculated dates.
      eventList.push({
        startDate: eventStartDate,
        endDate: eventEndDate,
        label: monitorEvents[i]?.monitorStatus?.name || "Operational",
        priority: monitorEvents[i]?.monitorStatus?.priority || 0,
        color: monitorEvents[i]?.monitorStatus?.color || Green,
        monitorId: monitorEvents[i]!.monitorId!,
        eventStatusId: monitorEvents[i]!.monitorStatus!.id!,
      });
    }

    // Return the populated eventList array.
    return eventList;
  }

  public static getNonOverlappingMonitorEvents(
    items: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
  ): Array<Event> {
    const monitorEventList: Array<MonitorEvent> = this.getMonitorEvents(
      items,
      window,
    );

    const eventList: Array<Event> = [];

    for (let i: number = 0; i < monitorEventList.length; i++) {
      // if this event starts after the last event, then add it to the list directly.

      const monitorEvent: MonitorEvent = monitorEventList[i]!;

      if (
        eventList.length === 0 ||
        OneUptimeDate.isAfter(
          monitorEvent.startDate,
          eventList[eventList.length - 1]!.endDate,
        ) ||
        OneUptimeDate.isEqualBySeconds(
          monitorEvent.startDate,
          eventList[eventList.length - 1]!.endDate,
        )
      ) {
        eventList.push(monitorEvent);
        continue;
      }

      // if this event starts before the last event, then we need to check if it ends before the last event. If it does, then we can skip this event if the monitrEvent is of lower priority than the last event. If it is of higher priority, then we need to add it to the list and remove the last event from the list.
      if (
        OneUptimeDate.isBefore(
          monitorEvent.startDate,
          eventList[eventList.length - 1]!.endDate,
        )
      ) {
        let isEndDateOfCurrenteventAfterLastEvent: boolean = false;
        if (
          eventList[eventList.length - 1] &&
          eventList[eventList.length - 1]?.endDate
        ) {
          isEndDateOfCurrenteventAfterLastEvent =
            OneUptimeDate.isAfter(
              monitorEvent.endDate,
              eventList[eventList.length - 1]!.endDate,
            ) ||
            OneUptimeDate.isEqualBySeconds(
              monitorEvent.endDate,
              eventList[eventList.length - 1]!.endDate,
            );
        }

        if (
          monitorEvent.priority > eventList[eventList.length - 1]!.priority ||
          isEndDateOfCurrenteventAfterLastEvent
        ) {
          // end the last event at the start of this event.

          const tempLastEvent: Event = {
            ...eventList[eventList.length - 1],
          } as Event;

          eventList[eventList.length - 1]!.endDate = monitorEvent.startDate;
          eventList.push(monitorEvent);

          // if the monitorEvent endDate is before the end of the last event, then we need to add the end of the last event to the list.

          if (
            OneUptimeDate.isBefore(monitorEvent.endDate, tempLastEvent.endDate)
          ) {
            eventList.push({
              startDate: monitorEvent.endDate,
              endDate: tempLastEvent.endDate,
              label: tempLastEvent.label,
              priority: tempLastEvent.priority,
              color: tempLastEvent.color,
              eventStatusId: tempLastEvent.eventStatusId,
            });
          }
        }

        continue;
      }
    }

    return eventList;
  }

  public static getMonitorEvents(
    items: Array<MonitorStatusTimeline>,
    window?: UptimeWindow | undefined,
  ): Array<MonitorEvent> {
    // get all distinct monitor ids.
    const monitorIds: Array<ObjectID> = [];

    for (let i: number = 0; i < items.length; i++) {
      if (!items[i]) {
        continue;
      }

      const monitorId: string | undefined = items[i]!.monitorId?.toString();

      if (!monitorId) {
        continue;
      }

      if (
        !monitorIds.find((item: ObjectID) => {
          return item.toString() === monitorId;
        })
      ) {
        monitorIds.push(new ObjectID(monitorId));
      }
    }

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

    // sort event list by start date.
    eventList.sort((a: MonitorEvent, b: MonitorEvent) => {
      if (OneUptimeDate.isAfter(a.startDate, b.startDate)) {
        return 1;
      }

      if (OneUptimeDate.isAfter(b.startDate, a.startDate)) {
        return -1;
      }

      return 0;
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
    );

    // sort these by start date,
    monitorEvents.sort((a: Event, b: Event) => {
      if (OneUptimeDate.isAfter(a.startDate, b.startDate)) {
        return 1;
      }

      if (OneUptimeDate.isAfter(b.startDate, a.startDate)) {
        return -1;
      }

      return 0;
    });

    /*
     * If a window is supplied then the time period is the window itself, and not "first event -> now".
     * The window end is clipped to now so a window that reaches into the future does not inflate the
     * denominator (which is what made the reported percentage drift upwards every day).
     */
    let windowSecondsInTimePeriod: number | null = null;

    if (window) {
      windowSecondsInTimePeriod = OneUptimeDate.getSecondsBetweenDates(
        window.startDate,
        OneUptimeDate.getLesserDate(
          window.endDate,
          OneUptimeDate.getCurrentDate(),
        ),
      );

      // never let the denominator be zero or negative.
      if (!windowSecondsInTimePeriod || windowSecondsInTimePeriod < 0) {
        windowSecondsInTimePeriod = 1;
      }
    }

    // calculate number of seconds between start of first event to date time now.
    let totalSecondsInTimePeriod: number = 0;

    if (monitorEvents.length === 0) {
      return {
        totalDowntimeInSeconds: 0,
        totalSecondsInTimePeriod: windowSecondsInTimePeriod ?? 1,
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
    }

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

    const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
      this.getTotalDowntimeInSeconds(
        monitorStatusTimelines,
        downtimeMonitorStatuses,
        window,
      );

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
