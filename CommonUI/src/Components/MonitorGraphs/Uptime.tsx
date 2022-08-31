import ObjectID from 'Common/Types/ObjectID';
import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import ModelAPI, { ListResult } from '../../Utils/ModelAPI/ModelAPI';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import ComponentLoader from '../ComponentLoader/ComponentLoader';
import OneUptimeDate from 'Common/Types/Date';
import InBetween from 'Common/Types/Database/InBetween';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import SortOrder from 'Common/Types/Database/SortOrder';
import DayUptimeGraph, { Event } from '../Graphs/DayUptimeGraph';
import { Green } from 'Common/Types/BrandColors';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { JSONObject } from 'Common/Types/JSON';
import useAsyncEffect from 'use-async-effect';

export interface ComponentProps {
    monitorId: ObjectID;
    startDate: Date;
    endDate: Date;
}

const MonitorUptimeGraph: FunctionComponent<ComponentProps> = (
    props: ComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [data, setData] = useState<Array<MonitorStatusTimeline>>([]);
    const [events, setEvents] = useState<Array<Event>>([]);
    const [error, setError] = useState<string>('');

    useEffect(() => {
        const eventList: Array<Event> = [];
        // convert data to events.
        for (let i: number = 0; i < data.length; i++) {
            if (!data[i]) {
                break;
            }

            eventList.push({
                startDate: data[i]!.createdAt || OneUptimeDate.getCurrentDate(),
                endDate:
                    data[i + 1] && data[i + 1]!.createdAt
                        ? (data[i + 1]?.createdAt as Date)
                        : OneUptimeDate.getCurrentDate(),
                label: data[i]?.monitorStatus?.name || 'Operational',
                priority: data[i]?.monitorStatus?.priority || 0,
                color: data[i]?.monitorStatus?.color || Green,
            });
        }

        setEvents(eventList);
    }, [data]);

    const fetchItem: Function = async (): Promise<void> => {
        setIsLoading(true);
        setError('');

        try {
            const startDate: Date = OneUptimeDate.getSomeDaysAgoFromDate(
                props.startDate,
                10
            );
            const endDate: Date = props.endDate;

            const monitorStatus: ListResult<MonitorStatusTimeline> =
                await ModelAPI.getList(
                    MonitorStatusTimeline,
                    {
                        createdAt: new InBetween(startDate, endDate),
                        monitorId: props.monitorId,
                    },
                    LIMIT_PER_PROJECT,
                    0,
                    {
                        createdAt: true,
                        monitorId: true,
                    },
                    {
                        createdAt: SortOrder.Ascending,
                    },
                    {
                        monitorStatus: {
                            name: true,
                            color: true,
                            priority: true,
                        },
                    }
                );

            setData(monitorStatus.data);
        } catch (err) {
            try {
                setError(
                    ((err as HTTPErrorResponse).data as JSONObject)[
                        'error'
                    ] as string
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
        }

        setIsLoading(false);
    };

    useAsyncEffect(async () => {
        await fetchItem();
    }, []);

    if (isLoading) {
        return <ComponentLoader />;
    }

    if (error) {
        return <ErrorMessage error={error} onRefreshClick={()=>fetchItem()} />;
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
