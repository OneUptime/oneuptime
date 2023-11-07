import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import DayUptimeGraph, { Event } from '../Graphs/DayUptimeGraph';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ObjectID from 'Common/Types/ObjectID';
import UptimeUtil from './UptimeUtil';

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

    useEffect(() => {
        const eventList: Array<Event> =
            UptimeUtil.getNonOverlappingMonitorEvents(props.items);
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
