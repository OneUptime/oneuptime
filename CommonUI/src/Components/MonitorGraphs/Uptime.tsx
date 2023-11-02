import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import OneUptimeDate from 'Common/Types/Date';

import DayUptimeGraph, { Event } from '../Graphs/DayUptimeGraph';
import { Green } from 'Common/Types/BrandColors';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ObjectID from 'Common/Types/ObjectID';

export interface MonitorEvent extends Event {
    monitorId: ObjectID;
}

export interface ComponentProps {
    startDate: Date;
    endDate: Date;
    items: Array<MonitorStatusTimeline>;
    isLoading?: boolean | undefined;
    onRefreshClick?: (() => void) | undefined;
    error?: string | undefined;
    height?: number | undefined;
}

const MonitorUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [events, setEvents] = useState<Array<Event>>([]);

    /**
     * This function, `getMonitorEventsForId`, takes a `monitorId` as an argument and returns an array of `MonitorEvent` objects.
     * @param {ObjectID} monitorId - The ID of the monitor for which events are to be fetched.
     * @returns {Array<MonitorEvent>} - An array of `MonitorEvent` objects.
     */
    const getMonitorEventsForId: (
        monitorId: ObjectID
    ) => Array<MonitorEvent> = (monitorId: ObjectID): Array<MonitorEvent> => {
        // Initialize an empty array to store the monitor events.
        const eventList: Array<MonitorEvent> = [];

        const monitorEvents: Array<MonitorStatusTimeline> = props.items.filter(
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
    };

    const getMonitorEvents: () => Array<MonitorEvent> =
        (): Array<MonitorEvent> => {
            // get all distinct monitor ids.
            const monitorIds: Array<ObjectID> = [];

            for (let i: number = 0; i < props.items.length; i++) {
                if (!props.items[i]) {
                    continue;
                }

                const monitorId: string | undefined =
                    props.items[i]!.monitorId?.toString();

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
                    getMonitorEventsForId(monitorId);
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
        };

    useEffect(() => {
        const monitorEventList: Array<Event> = getMonitorEvents();

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

        setEvents(eventList);
    }, [props.items]);

    if (props.isLoading) {
        return <ComponentLoader />;
    }

    if (props.error) {
        return (
            <ErrorMessage
                error={props.error}
                onRefreshClick={
                    props.onRefreshClick ? props.onRefreshClick : undefined
                }
            />
        );
    }

    return (
        <DayUptimeGraph
            startDate={props.startDate}
            endDate={props.endDate}
            events={events}
            defaultLabel={'Operational'}
            height={props.height}
        />
    );
};

export default MonitorUptimeGraph;
