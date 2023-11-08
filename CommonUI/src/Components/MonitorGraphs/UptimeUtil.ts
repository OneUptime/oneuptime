import ObjectID from 'Common/Types/ObjectID';
import { MonitorEvent } from './Uptime';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import OneUptimeDate from 'Common/Types/Date';
import { Green } from 'Common/Types/BrandColors';
import { Event } from '../Graphs/DayUptimeGraph';
import MonitorStatus from 'Model/Models/MonitorStatus';
import { UptimePrecision } from 'Model/Models/StatusPageResource';

export default class UptimeUtil {
    /**
     * This function, `getMonitorEventsForId`, takes a `monitorId` as an argument and returns an array of `MonitorEvent` objects.
     * @param {ObjectID} monitorId - The ID of the monitor for which events are to be fetched.
     * @returns {Array<MonitorEvent>} - An array of `MonitorEvent` objects.
     */
    public static getMonitorEventsForId(
        monitorId: ObjectID,
        items: Array<MonitorStatusTimeline>
    ): Array<MonitorEvent> {
        // Initialize an empty array to store the monitor events.
        const eventList: Array<MonitorEvent> = [];

        const monitorEvents: Array<MonitorStatusTimeline> = items.filter(
            (item: MonitorStatusTimeline) => {
                return item.monitorId?.toString() === monitorId.toString();
            }
        );

        // Loop through the items in the props object.
        for (let i: number = 0; i < monitorEvents.length; i++) {
            // If the current item is null or undefined, skip to the next iteration.
            if (!monitorEvents[i]) {
                continue;
            }

            // Set the start date of the event to the creation date of the current item. If it doesn't exist, use the current date.
            const startDate: Date =
                monitorEvents[i]!.createdAt || OneUptimeDate.getCurrentDate();

            // Initialize the end date as the current date.
            let endDate: Date = OneUptimeDate.getCurrentDate();

            // If there is a next item and it has a creation date, use that as the end date.
            if (monitorEvents[i + 1] && monitorEvents[i + 1]!.createdAt) {
                endDate = monitorEvents[i + 1]!.createdAt!;
            }

            // Push a new MonitorEvent object to the eventList array with properties from the current item and calculated dates.
            eventList.push({
                startDate: startDate,
                endDate: endDate,
                label: monitorEvents[i]?.monitorStatus?.name || 'Operational',
                priority: monitorEvents[i]?.monitorStatus?.priority || 0,
                color: monitorEvents[i]?.monitorStatus?.color || Green,
                monitorId: monitorEvents[i]!.monitorId!,
            });
        }

        // Return the populated eventList array.
        return eventList;
    }

    public static getNonOverlappingMonitorEvents(
        items: Array<MonitorStatusTimeline>
    ): Array<Event> {
        const monitorEventList: Array<MonitorEvent> =
            this.getMonitorEvents(items);

        const eventList: Array<Event> = [];

        for (const monitorEvent of monitorEventList) {
            // if this event starts after the last event, then add it to the list directly.
            if (
                eventList.length === 0 ||
                OneUptimeDate.isAfter(
                    monitorEvent.startDate,
                    eventList[eventList.length - 1]!.endDate
                ) ||
                OneUptimeDate.isEqualBySeconds(
                    monitorEvent.startDate,
                    eventList[eventList.length - 1]!.endDate
                )
            ) {
                eventList.push(monitorEvent);
                continue;
            }

            // if this event starts before the last event, then we need to check if it ends before the last event. If it does, then we can skip this event if the monitrEvent is of lower priority than the last event. If it is of higher priority, then we need to add it to the list and remove the last event from the list.
            if (
                OneUptimeDate.isBefore(
                    monitorEvent.startDate,
                    eventList[eventList.length - 1]!.endDate
                )
            ) {
                if (
                    monitorEvent.priority >
                    eventList[eventList.length - 1]!.priority
                ) {
                    // end the last event at the start of this event.

                    const tempLastEvent: Event = {
                        ...eventList[eventList.length - 1],
                    } as Event;

                    eventList[eventList.length - 1]!.endDate =
                        monitorEvent.startDate;
                    eventList.push(monitorEvent);

                    // if the monitorEvent endDate is before the end of the last event, then we need to add the end of the last event to the list.

                    if (
                        OneUptimeDate.isBefore(
                            monitorEvent.endDate,
                            tempLastEvent.endDate
                        )
                    ) {
                        eventList.push({
                            startDate: monitorEvent.endDate,
                            endDate: tempLastEvent.endDate,
                            label: tempLastEvent.label,
                            priority: tempLastEvent.priority,
                            color: tempLastEvent.color,
                        });
                    }
                }

                continue;
            }
        }

        return eventList;
    }

    public static getMonitorEvents(
        items: Array<MonitorStatusTimeline>
    ): Array<MonitorEvent> {
        // get all distinct monitor ids.
        const monitorIds: Array<ObjectID> = [];

        for (let i: number = 0; i < items.length; i++) {
            if (!items[i]) {
                continue;
            }

            const monitorId: string | undefined =
                items[i]!.monitorId?.toString();

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
            const monitorEvents: Array<MonitorEvent> =
                this.getMonitorEventsForId(monitorId, items);
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

    public static calculateUptimePercentage(
        items: Array<MonitorStatusTimeline>,
        monitorStatuses: Array<MonitorStatus>,
        precision: UptimePrecision
    ): number {
        const monitorEvents: Array<Event> =
            this.getNonOverlappingMonitorEvents(items);

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
            return 100;
        }

        if (
            OneUptimeDate.isAfter(
                monitorEvents[0]!.startDate,
                OneUptimeDate.getCurrentDate()
            )
        ) {
            return 100;
        }

        totalSecondsInTimePeriod =
            OneUptimeDate.getSecondsBetweenDates(
                monitorEvents[0]!.startDate,
                OneUptimeDate.getCurrentDate()
            ) || 1;

        // get order of operational state.

        const operationalStatePriority: number =
            monitorStatuses.find((item: MonitorStatus) => {
                return item.isOperationalState;
            })?.priority || 0;

        // if the event belongs to less than operationalStatePriority, then add the seconds to the total seconds.

        let totalDowntime: number = 0;

        for (const monitorEvent of monitorEvents) {
            if (monitorEvent.priority > operationalStatePriority) {
                totalDowntime += OneUptimeDate.getSecondsBetweenDates(
                    monitorEvent.startDate,
                    monitorEvent.endDate
                );
            }
        }

        // calculate percentage.

        const percentage: number =
            ((totalSecondsInTimePeriod - totalDowntime) /
                totalSecondsInTimePeriod) *
            100;

        if (precision === UptimePrecision.NO_DECIMAL) {
            const noDecimalPercent: number = Math.round(percentage);
            if (noDecimalPercent === 100 && totalDowntime > 0) {
                return 99;
            }

            return noDecimalPercent;
        }

        if (precision === UptimePrecision.ONE_DECIMAL) {
            const noDecimalPercent: number = Math.round(percentage * 10) / 10;
            if (noDecimalPercent === 100 && totalDowntime > 0) {
                return 99.9;
            }

            return noDecimalPercent;
        }

        if (precision === UptimePrecision.TWO_DECIMAL) {
            const noDecimalPercent: number = Math.round(percentage * 100) / 100;
            if (noDecimalPercent === 100 && totalDowntime > 0) {
                return 99.99;
            }

            return noDecimalPercent;
        }

        if (precision === UptimePrecision.THREE_DECIMAL) {
            const noDecimalPercent: number =
                Math.round(percentage * 1000) / 1000;
            if (noDecimalPercent === 100 && totalDowntime > 0) {
                return 99.999;
            }

            return noDecimalPercent;
        }

        return percentage;
    }
}
