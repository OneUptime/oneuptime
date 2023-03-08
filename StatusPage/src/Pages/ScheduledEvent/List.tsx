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
import JSONFunctions from 'Common/Types/JSONFunctions';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import EventHistoryList, {
    ComponentProps as EventHistoryListComponentProps,
} from 'CommonUI/src/Components/EventHistoryList/EventHistoryList';
import { ComponentProps as EventHistoryDayListComponentProps } from 'CommonUI/src/Components/EventHistoryList/EventHistoryDayList';
import StatusPageResource from 'Model/Models/StatusPageResource';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { getScheduledEventEventItem } from './Detail';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Route from 'Common/Types/API/Route';
import User from '../../Utils/User';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';

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

    if (
        props.statusPageId &&
        props.isPrivatePage &&
        !User.isLoggedIn(props.statusPageId)
    ) {
        Navigation.navigate(
            new Route(
                props.isPreviewPage
                    ? `/status-page/${props.statusPageId}/login`
                    : '/login'
            )
        );
    }

    useAsyncEffect(async () => {
        try {
            if (!props.statusPageId) {
                return;
            }
            setIsLoading(true);

            const id: ObjectID = LocalStorage.getItem(
                'statusPageId'
            ) as ObjectID;
            if (!id) {
                throw new BadDataException('Status Page ID is required');
            }
            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/status-page/scheduled-maintenance-events/${id.toString()}`
                    ),
                    {},
                    {
                        'status-page-token': User.getAccessToken(
                            props.statusPageId
                        ),
                    }
                );
            const data: JSONObject = response.data;

            const scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
                JSONFunctions.fromJSONArray(
                    (data[
                        'scheduledMaintenanceEventsPublicNotes'
                    ] as JSONArray) || [],
                    ScheduledMaintenancePublicNote
                );
            const scheduledMaintenanceEvents: Array<ScheduledMaintenance> =
                JSONFunctions.fromJSONArray(
                    (data['scheduledMaintenanceEvents'] as JSONArray) || [],
                    ScheduledMaintenance
                );
            const statusPageResources: Array<StatusPageResource> =
                JSONFunctions.fromJSONArray(
                    (data['statusPageResources'] as JSONArray) || [],
                    StatusPageResource
                );
            const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
                JSONFunctions.fromJSONArray(
                    (data['scheduledMaintenanceStateTimelines'] as JSONArray) ||
                        [],
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
            setError(BaseAPI.getFriendlyMessage(err));
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
            const dayString: string = OneUptimeDate.getDateString(
                scheduledMaintenance.startsAt!
            );

            if (!days[dayString]) {
                days[dayString] = {
                    date: scheduledMaintenance.startsAt!,
                    items: [],
                };
            }

            days[dayString]?.items.push(
                getScheduledEventEventItem(
                    scheduledMaintenance,
                    scheduledMaintenanceEventsPublicNotes,
                    scheduledMaintenanceStateTimelines,
                    Boolean(props.isPreviewPage),
                    true
                )
            );
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
        <Page
            title="Scheduled Events"
            breadcrumbLinks={[
                {
                    title: 'Overview',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewPage
                            ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                            : (RouteMap[PageMap.OVERVIEW] as Route)
                    ),
                },
                {
                    title: 'Scheduled Events',
                    to: RouteUtil.populateRouteParams(
                        props.isPreviewPage
                            ? (RouteMap[
                                  PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                              ] as Route)
                            : (RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route)
                    ),
                },
            ]}
        >
            {scheduledMaintenanceEvents &&
            scheduledMaintenanceEvents.length > 0 ? (
                <EventHistoryList {...parsedData} />
            ) : (
                <></>
            )}

            {scheduledMaintenanceEvents.length === 0 ? (
                <EmptyState
                    title={'No Scheduled Events'}
                    description={
                        'No scheduled events posted for this status page.'
                    }
                    icon={IconProp.Clock}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
