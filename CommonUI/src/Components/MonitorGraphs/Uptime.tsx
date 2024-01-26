import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';

import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import DayUptimeGraph, { BarChartRule, Event } from '../Graphs/DayUptimeGraph';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import ObjectID from 'Common/Types/ObjectID';
import UptimeUtil from './UptimeUtil';
import StatusPageHistoryChartBarColorRule from 'Model/Models/StatusPageHistoryChartBarColorRule';
import MonitorStatus from 'Model/Models/MonitorStatus';

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
    barColorRules?: Array<StatusPageHistoryChartBarColorRule> | undefined;
    downtimeMonitorStatuses: Array<MonitorStatus> | undefined;
}

const MonitorUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [events, setEvents] = useState<Array<Event>>([]);

    const [barColorRules, setBarColorRules] = useState<BarChartRule[]>([]);

    useEffect(() => {
        const eventList: Array<Event> =
            UptimeUtil.getNonOverlappingMonitorEvents(props.items);
        setEvents(eventList);
    }, [props.items]);

    useEffect(() => {
        if (props.barColorRules) {
            setBarColorRules(
                props.barColorRules.map(
                    (rule: StatusPageHistoryChartBarColorRule) => {
                        return {
                            barColor: rule.barColor!,
                            uptimePercentGreaterThanOrEqualTo:
                                rule.uptimePercentGreaterThanOrEqualTo!,
                        };
                    }
                )
            );
        }
    }, [props.barColorRules]);

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
            barColorRules={barColorRules}
            downtimeEventStatusIds={
                props.downtimeMonitorStatuses?.map((status: MonitorStatus) => {
                    return status.id!;
                }) || []
            }
        />
    );
};

export default MonitorUptimeGraph;
