import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import URL from 'Common/Types/API/URL';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import BaseAPI from 'CommonUI/src/Utils/API/API';
import { DASHBOARD_API_URL } from 'CommonUI/src/Config';
import useAsyncEffect from 'use-async-effect';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import BaseModel from 'Common/Models/BaseModel';
import EventHistoryList, {
    ComponentProps as EventHistoryListComponentProps,
} from 'CommonUI/src/Components/EventHistoryList/EventHistoryList';
import { ComponentProps as EventHistoryDayListComponentProps } from 'CommonUI/src/Components/EventHistoryList/EventHistoryDayList';
import StatusPageResource from 'Model/Models/StatusPageResource';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import { Red } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';

const Overview: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [_statusPageResources, setStatusPageResources] = useState<
        Array<StatusPageResource>
    >([]);
    const [
        scheduledMaintenanceEventsPublicNotes,
        setscheduledMaintenanceEventsPublicNotes,
    ] = useState<Array<ScheduledMaintenancePublicNote>>([]);
    const [scheduledMaintenanceEvents, setscheduledMaintenanceEvents] =
        useState<Array<ScheduledMaintenance>>([]);
    const [
        scheduledMaintenanceStateTimelines,
        setscheduledMaintenanceStateTimelines,
    ] = useState<Array<ScheduledMaintenanceStateTimeline>>([]);
    const [parsedData, setParsedData] =
        useState<EventHistoryListComponentProps | null>(null);

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const id = LocalStorage.getItem('statusPageId') as ObjectID;
            if (!id) {
                throw new BadDataException('Status Page ID is required');
            }
            const response = await BaseAPI.post<JSONObject>(
                URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                    `/status-page/scheduled-maintenance-events/${id.toString()}`
                ),
                {},
                {}
            );
            const data = response.data;

            const scheduledMaintenanceEventsPublicNotes =
                BaseModel.fromJSONArray(
                    (data[
                        'scheduledMaintenanceEventsPublicNotes'
                    ] as JSONArray) || [],
                    ScheduledMaintenancePublicNote
                );
            const scheduledMaintenanceEvents = BaseModel.fromJSONArray(
                (data['scheduledMaintenanceEvents'] as JSONArray) || [],
                ScheduledMaintenance
            );
            const statusPageResources = BaseModel.fromJSONArray(
                (data['statusPageResources'] as JSONArray) || [],
                StatusPageResource
            );
            const scheduledMaintenanceStateTimelines = BaseModel.fromJSONArray(
                (data['scheduledMaintenanceStateTimelines'] as JSONArray) || [],
                ScheduledMaintenanceStateTimeline
            );

            // save data. set()
            setscheduledMaintenanceEventsPublicNotes(
                scheduledMaintenanceEventsPublicNotes
            );
            setscheduledMaintenanceEvents(scheduledMaintenanceEvents);
            setStatusPageResources(statusPageResources);
            setscheduledMaintenanceStateTimelines(
                scheduledMaintenanceStateTimelines
            );

            setIsLoading(false);
            props.onLoadComplete();
        } catch (err) {
            try {
                setError(
                    (err as HTTPErrorResponse).message ||
                        'Server Error. Please try again'
                );
            } catch (e) {
                setError('Server Error. Please try again');
            }
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isLoading) {
            // parse data;
            setParsedData(null);
            return;
        }

        const eventHistoryListComponentProps: EventHistoryListComponentProps = {
            items: [],
        };

        const days: Dictionary<EventHistoryDayListComponentProps> = {};

        for (const scheduledMaintenance of scheduledMaintenanceEvents) {
            const dayString = OneUptimeDate.getDateString(
                scheduledMaintenance.createdAt!
            );

            if (!days[dayString]) {
                days[dayString] = {
                    date: scheduledMaintenance.createdAt!,
                    items: [],
                };
            }

            /// get timeline.

            const timeline = [];

            for (const scheduledMaintenancePublicNote of scheduledMaintenanceEventsPublicNotes) {
                if (
                    scheduledMaintenancePublicNote.scheduledMaintenanceId?.toString() ===
                    scheduledMaintenance.id?.toString()
                ) {
                    timeline.push({
                        text: scheduledMaintenancePublicNote?.note || '',
                        date: scheduledMaintenancePublicNote?.createdAt!,
                        isBold: false,
                    });
                }
            }

            for (const scheduledMaintenanceEventstateTimeline of scheduledMaintenanceStateTimelines) {
                if (
                    scheduledMaintenanceEventstateTimeline.scheduledMaintenanceId?.toString() ===
                    scheduledMaintenance.id?.toString()
                ) {
                    timeline.push({
                        text:
                            scheduledMaintenanceEventstateTimeline
                                .scheduledMaintenanceState?.name || '',
                        date: scheduledMaintenanceEventstateTimeline?.createdAt!,
                        isBold: true,
                        color:
                            scheduledMaintenanceEventstateTimeline
                                .scheduledMaintenanceState?.color || Red,
                    });
                }
            }

            timeline.sort((a, b) => {
                return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
            });

            days[dayString]?.items.push({
                eventTitle: scheduledMaintenance.title || '',
                eventDescription: scheduledMaintenance.description,
                eventTimeline: timeline,
                eventType: 'Scheduled Maintenance',
                eventViewRoute: RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SCHEDULED_EVENT_DETAIL] as Route,
                    scheduledMaintenance.id!
                ),
            });
        }

        for (const key in days) {
            eventHistoryListComponentProps.items.push(
                days[key] as EventHistoryDayListComponentProps
            );
        }

        setParsedData(eventHistoryListComponentProps);
    }, [isLoading]);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    if (!parsedData) {
        return <PageLoader isVisible={true} />;
    }

    return (
        <Page>
            <h3>Scheduled Maintenance Events</h3>
            <EventHistoryList {...parsedData} />
        </Page>
    );
};

export default Overview;
