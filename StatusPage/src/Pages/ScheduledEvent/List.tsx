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
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { getScheduledEventEventItem } from './Detail';
import Route from 'Common/Types/API/Route';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import API from '../../Utils/API';
import StatusPageUtil from '../../Utils/StatusPage';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import StatusPageResource from 'Model/Models/StatusPageResource';
import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import Section from '../../Components/Section/Section';

const Overview: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
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

    const [ongoingEventsParsedData, setOngoingEventsParsedData] =
        useState<EventHistoryListComponentProps | null>(null);
    const [scheduledEventsParsedData, setScheduledEventsParsedData] =
        useState<EventHistoryListComponentProps | null>(null);
    const [endedEventsParsedData, setEndedEventsParsedData] =
        useState<EventHistoryListComponentProps | null>(null);

    const [statusPageResources, setStatusPageResources] = useState<
        Array<StatusPageResource>
    >([]);

    const [monitorsInGroup, setMonitorsInGroup] = useState<
        Dictionary<Array<ObjectID>>
    >({});

    const [scheduledMaintenanceStates, setScheduledMaintenanceStates] =
        useState<Array<ScheduledMaintenanceState>>([]);

    StatusPageUtil.checkIfUserHasLoggedIn();

    const getEventHistoryListComponentProps: Function = (
        scheduledMaintenanceEvents: ScheduledMaintenance[],
        scheduledMaintenanceEventsPublicNotes: ScheduledMaintenancePublicNote[],
        scheduledMaintenanceStateTimelines: ScheduledMaintenanceStateTimeline[],
        statusPageResources: StatusPageResource[],
        monitorsInGroup: Dictionary<ObjectID[]>
    ): EventHistoryListComponentProps => {
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
                    statusPageResources,
                    monitorsInGroup,
                    Boolean(StatusPageUtil.isPreviewPage()),
                    true
                )
            );
        }

        for (const key in days) {
            eventHistoryListComponentProps.items.push(
                days[key] as EventHistoryDayListComponentProps
            );
        }
        return eventHistoryListComponentProps;
    };

    useAsyncEffect(async () => {
        try {
            if (!StatusPageUtil.getStatusPageId()) {
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
                await API.post<JSONObject>(
                    URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
                        `/scheduled-maintenance-events/${id.toString()}`
                    ),
                    {},
                    API.getDefaultHeaders(StatusPageUtil.getStatusPageId()!)
                );

            if (!response.isSuccess()) {
                throw response;
            }
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
            const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
                JSONFunctions.fromJSONArray(
                    (data['scheduledMaintenanceStateTimelines'] as JSONArray) ||
                        [],
                    ScheduledMaintenanceStateTimeline
                );

            const statusPageResources: Array<StatusPageResource> =
                JSONFunctions.fromJSONArray(
                    (data['statusPageResources'] as JSONArray) || [],
                    StatusPageResource
                );

            const monitorsInGroup: Dictionary<Array<ObjectID>> =
                JSONFunctions.deserialize(
                    (data['monitorsInGroup'] as JSONObject) || {}
                ) as Dictionary<Array<ObjectID>>;

            const scheduledMaintenanceStates: Array<ScheduledMaintenanceState> =
                JSONFunctions.fromJSONArray(
                    (data['scheduledMaintenanceStates'] as JSONArray) || [],
                    ScheduledMaintenanceState
                );

            setScheduledMaintenanceStates(scheduledMaintenanceStates);
            setStatusPageResources(statusPageResources);
            setMonitorsInGroup(monitorsInGroup);

            // save data. set()
            setscheduledMaintenanceEventsPublicNotes(
                scheduledMaintenanceEventsPublicNotes
            );
            setscheduledMaintenanceEvents(scheduledMaintenanceEvents);
            setscheduledMaintenanceStateTimelines(
                scheduledMaintenanceStateTimelines
            );

            setIsLoading(false);
            props.onLoadComplete();
        } catch (err) {
            if (err instanceof HTTPErrorResponse) {
                await StatusPageUtil.checkIfTheUserIsAuthenticated(err);
            }
            setError(API.getFriendlyMessage(err));
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isLoading) {
            // parse data;
            setOngoingEventsParsedData(null);
            setScheduledEventsParsedData(null);
            setEndedEventsParsedData(null);
            return;
        }

        const ongoingOrder: number =
            scheduledMaintenanceStates.find(
                (state: ScheduledMaintenanceState) => {
                    return state.isOngoingState;
                }
            )?.order || 0;

        const endedEventOrder: number =
            scheduledMaintenanceStates.find(
                (state: ScheduledMaintenanceState) => {
                    return state.isEndedState;
                }
            )?.order || 0;

        // get ongoing events - anything after ongoing state but before ended state

        const ongoingEvents: ScheduledMaintenance[] =
            scheduledMaintenanceEvents.filter((event: ScheduledMaintenance) => {
                return (
                    event.currentScheduledMaintenanceState!.order! >=
                        ongoingOrder &&
                    event.currentScheduledMaintenanceState!.order! <
                        endedEventOrder
                );
            });

        // get scheduled events - anything before ongoing state

        const scheduledEvents: ScheduledMaintenance[] =
            scheduledMaintenanceEvents.filter((event: ScheduledMaintenance) => {
                return (
                    event.currentScheduledMaintenanceState!.order! <
                    ongoingOrder
                );
            });

        // get ended events - anythign equalTo or after ended state

        const endedEvents: ScheduledMaintenance[] =
            scheduledMaintenanceEvents.filter((event: ScheduledMaintenance) => {
                return (
                    event.currentScheduledMaintenanceState!.order! >=
                    endedEventOrder
                );
            });

        const endedEventProps: EventHistoryListComponentProps =
            getEventHistoryListComponentProps(
                endedEvents,
                scheduledMaintenanceEventsPublicNotes,
                scheduledMaintenanceStateTimelines,
                statusPageResources,
                monitorsInGroup
            );
        const scheduledEventProps: EventHistoryListComponentProps =
            getEventHistoryListComponentProps(
                scheduledEvents,
                scheduledMaintenanceEventsPublicNotes,
                scheduledMaintenanceStateTimelines,
                statusPageResources,
                monitorsInGroup
            );
        const ongoingEventProps: EventHistoryListComponentProps =
            getEventHistoryListComponentProps(
                ongoingEvents,
                scheduledMaintenanceEventsPublicNotes,
                scheduledMaintenanceStateTimelines,
                statusPageResources,
                monitorsInGroup
            );

        setOngoingEventsParsedData(ongoingEventProps);
        setScheduledEventsParsedData(scheduledEventProps);
        setEndedEventsParsedData(endedEventProps);
    }, [isLoading]);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <Page
            title="Scheduled Events"
            breadcrumbLinks={[
                {
                    title: 'Overview',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[PageMap.PREVIEW_OVERVIEW] as Route)
                            : (RouteMap[PageMap.OVERVIEW] as Route)
                    ),
                },
                {
                    title: 'Scheduled Events',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[
                                  PageMap.PREVIEW_SCHEDULED_EVENT_LIST
                              ] as Route)
                            : (RouteMap[PageMap.SCHEDULED_EVENT_LIST] as Route)
                    ),
                },
            ]}
        >
            {ongoingEventsParsedData?.items &&
            ongoingEventsParsedData?.items.length > 0 ? (
                <div>
                    <Section title="Ongoing Events" />

                    <EventHistoryList
                        items={ongoingEventsParsedData?.items || []}
                    />
                </div>
            ) : (
                <></>
            )}

            {scheduledEventsParsedData?.items &&
            scheduledEventsParsedData?.items.length > 0 ? (
                <div>
                    <Section title="Scheduled Events" />

                    <EventHistoryList
                        items={scheduledEventsParsedData?.items || []}
                    />
                </div>
            ) : (
                <></>
            )}

            {endedEventsParsedData?.items &&
            endedEventsParsedData?.items.length > 0 ? (
                <div>
                    <Section title="Completed Events" />

                    <EventHistoryList
                        items={endedEventsParsedData?.items || []}
                    />
                </div>
            ) : (
                <></>
            )}

            {scheduledMaintenanceEvents.length === 0 ? (
                <EmptyState
                    id="scheduled-events-empty-state"
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
