import Event from "./Event";
import MonitorEvent from "./MonitorEvent";
import { Green } from "../../Types/BrandColors";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../Types/Dictionary";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";

export default class UptimeUtil {
  /**
   * This function, `getMonitorEventsForId`, takes a `monitorId` as an argument and returns an array of `MonitorEvent` objects.
   * @param {ObjectID} monitorId - The ID of the monitor for which events are to be fetched.
   * @returns {Array<MonitorEvent>} - An array of `MonitorEvent` objects.
   */
  public static getMonitorEventsForId(
    monitorId: ObjectID,
    statusTimelineItems: Array<MonitorStatusTimeline>,
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
        } else {
          endDate = OneUptimeDate.getCurrentDate();
        }
      }

      // Push a new MonitorEvent object to the eventList array with properties from the current item and calculated dates.
      eventList.push({
        startDate: startDate,
        endDate: endDate!,
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
  ): Array<Event> {
    const monitorEventList: Array<MonitorEvent> = this.getMonitorEvents(items);

    const eventList: Array<Event> = [];

    for (let i: number = 0; i < monitorEventList.length; i++) {
      // if this event starts after the last event, then add it to the list directly.

      const monitorEvent: MonitorEvent = monitorEventList[i]!;

      if (!monitorEvent.endDate) {
        // if this is the last event then set endDate to current date.

        // otherwise set it to start date of next event.

        if (i === monitorEventList.length - 1) {
          monitorEvent.endDate = OneUptimeDate.getCurrentDate();
        } else {
          monitorEvent.endDate =
            monitorEventList[i + 1]!.startDate ||
            OneUptimeDate.getCurrentDate();
        }
      }

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
        if (monitorEvent.priority > eventList[eventList.length - 1]!.priority) {
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
  ): {
    totalDowntimeInSeconds: number;
    totalSecondsInTimePeriod: number;
  } {
    const monitorEvents: Array<Event> = this.getNonOverlappingMonitorEvents(
      monitorStatusTimelines,
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

    // calculate number of seconds between start of first event to date time now.
    let totalSecondsInTimePeriod: number = 0;

    if (monitorEvents.length === 0) {
      return {
        totalDowntimeInSeconds: 0,
        totalSecondsInTimePeriod: 1,
      };
    }

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

  public static calculateAvgUptimePercentageOfAllResources(data: {
    monitorStatusTimelines: Array<MonitorStatusTimeline>;
    precision: UptimePrecision;
    downtimeMonitorStatuses: Array<MonitorStatus>;
    statusPageResources: Array<StatusPageResource>;
    monitorsInGroup: Dictionary<Array<ObjectID>>;
  }): number | null {
    const showUptimePercentage: boolean = Boolean(
      data.statusPageResources.find((item: StatusPageResource) => {
        return item.showUptimePercent;
      }),
    );

    if (!showUptimePercentage) {
      return null;
    }

    const uptimePercentPerResource: Array<number> = [];

    for (const resource of data.statusPageResources) {
      let timelinesForThisResource: Array<MonitorStatusTimeline> = [];

      if (resource.monitorGroupId) {
        timelinesForThisResource = [...data.monitorStatusTimelines].filter(
          (timeline: MonitorStatusTimeline) => {
            const monitorsInThisGroup: Array<ObjectID> | undefined =
              data.monitorsInGroup[resource.monitorGroupId?.toString() || ""];

            if (!monitorsInThisGroup) {
              return false;
            }

            return monitorsInThisGroup.find((monitorId: ObjectID) => {
              return monitorId.toString() === timeline.monitorId?.toString();
            });
          },
        );
      }

      if (resource.monitorId || resource.monitor?.id) {
        const monitorId: ObjectID | null | undefined =
          resource.monitorId || resource.monitor?.id;

        if (!monitorId) {
          // this should never happen.
          continue;
        }

        timelinesForThisResource = [...data.monitorStatusTimelines].filter(
          (timeline: MonitorStatusTimeline) => {
            return (
              timeline.monitorId?.toString() === resource.monitorId?.toString()
            );
          },
        );
      }

      const uptimePercent: number = this.calculateUptimePercentage(
        timelinesForThisResource,
        data.precision,
        data.downtimeMonitorStatuses,
      );

      uptimePercentPerResource.push(uptimePercent);
    }

    // calculate avg

    if (uptimePercentPerResource.length === 0) {
      return null;
    }

    const averageUptimePercentage: number =
      uptimePercentPerResource.reduce((a: number, b: number) => {
        return a + b;
      }) / uptimePercentPerResource.length;

    //round this to precision.

    if (data.precision === UptimePrecision.NO_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage);

      return percent;
    }

    if (data.precision === UptimePrecision.ONE_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage * 10) / 10;
      return percent;
    }

    if (data.precision === UptimePrecision.TWO_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage * 100) / 100;
      return percent;
    }

    if (data.precision === UptimePrecision.THREE_DECIMAL) {
      const percent: number = Math.round(averageUptimePercentage * 1000) / 1000;
      return percent;
    }

    return averageUptimePercentage;
  }

  public static calculateUptimePercentage(
    monitorStatusTimelines: Array<MonitorStatusTimeline>,
    precision: UptimePrecision,
    downtimeMonitorStatuses: Array<MonitorStatus>,
  ): number {
    // calculate percentage.

    const { totalDowntimeInSeconds, totalSecondsInTimePeriod } =
      this.getTotalDowntimeInSeconds(
        monitorStatusTimelines,
        downtimeMonitorStatuses,
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

    if (precision === UptimePrecision.NO_DECIMAL) {
      const noDecimalPercent: number = Math.round(percentage);
      if (noDecimalPercent === 100 && totalDowntimeInSeconds > 0) {
        return 99;
      }

      return noDecimalPercent;
    }

    if (precision === UptimePrecision.ONE_DECIMAL) {
      const noDecimalPercent: number = Math.round(percentage * 10) / 10;
      if (noDecimalPercent === 100 && totalDowntimeInSeconds > 0) {
        return 99.9;
      }

      return noDecimalPercent;
    }

    if (precision === UptimePrecision.TWO_DECIMAL) {
      const noDecimalPercent: number = Math.round(percentage * 100) / 100;
      if (noDecimalPercent === 100 && totalDowntimeInSeconds > 0) {
        return 99.99;
      }

      return noDecimalPercent;
    }

    if (precision === UptimePrecision.THREE_DECIMAL) {
      const noDecimalPercent: number = Math.round(percentage * 1000) / 1000;
      if (noDecimalPercent === 100 && totalDowntimeInSeconds > 0) {
        return 99.999;
      }

      return noDecimalPercent;
    }

    return percentage;
  }
}
