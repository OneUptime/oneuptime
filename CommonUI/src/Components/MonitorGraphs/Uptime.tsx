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

export interface ComponentProps {
    startDate: Date;
    endDate: Date;
    items: Array<MonitorStatusTimeline>;
    isLoading?: boolean | undefined;
    onRefreshClick?: (() => void) | undefined;
    error?: string | undefined;
}

const MonitorUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [events, setEvents] = useState<Array<Event>>([]);

    useEffect(() => {
        const eventList: Array<Event> = [];
        // convert data to events.
        for (let i: number = 0; i < props.items.length; i++) {
            if (!props.items[i]) {
                break;
            }

            eventList.push({
                startDate:
                    props.items[i]!.createdAt || OneUptimeDate.getCurrentDate(),
                endDate:
                    props.items[i + 1] && props.items[i + 1]!.createdAt
                        ? (props.items[i + 1]?.createdAt as Date)
                        : OneUptimeDate.getCurrentDate(),
                label: props.items[i]?.monitorStatus?.name || 'Operational',
                priority: props.items[i]?.monitorStatus?.priority || 0,
                color: props.items[i]?.monitorStatus?.color || Green,
            });
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
        />
    );
};

export default MonitorUptimeGraph;
