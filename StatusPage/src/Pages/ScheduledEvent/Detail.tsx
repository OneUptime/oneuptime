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
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageResource from 'Model/Models/StatusPageResource';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import OneUptimeDate from 'Common/Types/Date';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import EventItem, {
    TimelineItem,
    ComponentProps as EventItemComponentProps,
} from 'CommonUI/src/Components/EventItem/EventItem';
import Navigation from 'CommonUI/src/Utils/Navigation';

export const getScheduledEventEventItem: Function = (
    scheduledMaintenance: ScheduledMaintenance,
    scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote>,
    scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline>,
    isPreviewPage: boolean
) => {
    /// get timeline.

    const timeline: Array<TimelineItem> = [];

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
            });
        }
    }

    timeline.sort((a: TimelineItem, b: TimelineItem) => {
        return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
    });

    return {
        eventTitle: scheduledMaintenance.title || '',
        eventDescription: scheduledMaintenance.description,
        eventTimeline: timeline,
        eventType: 'Scheduled Maintenance',
        eventViewRoute: RouteUtil.populateRouteParams(
            isPreviewPage
                ? (RouteMap[PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL] as Route)
                : (RouteMap[PageMap.SCHEDULED_EVENT_DETAIL] as Route),
            scheduledMaintenance.id!
        ),
    };
};

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
    const [scheduledMaintenanceEvent, setscheduledMaintenanceEvent] =
        useState<ScheduledMaintenance | null>(null);
    const [
        scheduledMaintenanceStateTimelines,
        setscheduledMaintenanceStateTimelines,
    ] = useState<Array<ScheduledMaintenanceStateTimeline>>([]);
    const [parsedData, setParsedData] =
        useState<EventItemComponentProps | null>(null);

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const id: ObjectID = LocalStorage.getItem(
                'statusPageId'
            ) as ObjectID;
            if (!id) {
                throw new BadDataException('Status Page ID is required');
            }

            const eventId: string | undefined = Navigation.getLastParam()
                ?.toString()
                .replace('/', '');

            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/status-page/scheduled-maintenance-events/${id.toString()}/${eventId}`
                    ),
                    {},
                    {}
                );
            const data: JSONObject = response.data;

            const scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
                JSONFunctions.fromJSONArray(
                    (data[
                        'scheduledMaintenanceEventsPublicNotes'
                    ] as JSONArray) || [],
                    ScheduledMaintenancePublicNote
                );
            const scheduledMaintenanceEvent: ScheduledMaintenance =
                JSONFunctions.fromJSONObject(
                    (data['scheduledMaintenanceEvent'] as JSONObject) || [],
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
            setscheduledMaintenanceEvent(scheduledMaintenanceEvent);
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

        if (!scheduledMaintenanceEvent) {
            return;
        }
        setParsedData(
            getScheduledEventEventItem(
                scheduledMaintenanceEvent,
                scheduledMaintenanceEventsPublicNotes,
                scheduledMaintenanceStateTimelines,
                Boolean(props.isPreviewPage)
            )
        );
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
            {scheduledMaintenanceEvent ? <EventItem {...parsedData} /> : <></>}
            {!scheduledMaintenanceEvent ? (
                <ErrorMessage error="No incident found with this ID." />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
