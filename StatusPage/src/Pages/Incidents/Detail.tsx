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
import JSONFunctions from 'Common/Types/JSONFunctions';
import useAsyncEffect from 'use-async-effect';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageResource from 'Model/Models/StatusPageResource';
import Incident from 'Model/Models/Incident';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import OneUptimeDate from 'Common/Types/Date';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import EventItem, {
    TimelineItem,
    ComponentProps as EventItemComponentProps,
} from 'CommonUI/src/Components/EventItem/EventItem';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Monitor from 'Model/Models/Monitor';

export const getIncidentEventItem: Function = (
    incident: Incident,
    incidentPublicNotes: Array<IncidentPublicNote>,
    incidentStateTimelines: Array<IncidentStateTimeline>,
    statusPageResources: Array<StatusPageResource>,
    isPreviewPage: boolean,
    isSummary: boolean
): EventItemComponentProps => {
    const timeline: Array<TimelineItem> = [];

    for (const incidentPublicNote of incidentPublicNotes) {
        if (
            incidentPublicNote.incidentId?.toString() ===
            incident.id?.toString()
        ) {
            timeline.push({
                text: (
                    <span>
                        <b>Update</b> - <span>{incidentPublicNote?.note}</span>
                    </span>
                ),
                date: incidentPublicNote?.createdAt!,
                isBold: false,
            });
            // If this incident is a sumamry then dont include all the notes .
            if (isSummary) {
                break;
            }
        }
    }

    for (const incidentStateTimeline of incidentStateTimelines) {
        if (
            incidentStateTimeline.incidentId?.toString() ===
            incident.id?.toString()
        ) {
            timeline.push({
                text: incidentStateTimeline.incidentState?.name || '',
                date: incidentStateTimeline?.createdAt!,
                isBold: true,
            });
            // If this incident is a sumamry then dont include all the notes .
            if (isSummary) {
                break;
            }
        }
    }

    timeline.sort((a: TimelineItem, b: TimelineItem) => {
        return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
    });

    const monitorIds: Array<string | undefined> =
        incident.monitors?.map((monitor: Monitor) => {
            return monitor._id;
        }) || [];

    const namesOfResources: Array<StatusPageResource> =
        statusPageResources.filter((resource: StatusPageResource) => {
            return monitorIds.includes(resource.monitorId?.toString());
        });

    const data: EventItemComponentProps = {
        eventTitle: incident.title || '',
        eventDescription: incident.description,
        eventResourcesAffected: namesOfResources.map(
            (i: StatusPageResource) => {
                return i.displayName || '';
            }
        ),
        eventTimeline: timeline,
        eventType: 'Incident',
        eventViewRoute: RouteUtil.populateRouteParams(
            isPreviewPage
                ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
                : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
            incident.id!
        ),
    };

    return data;
};

const Detail: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [statusPageResources, setStatusPageResources] = useState<
        Array<StatusPageResource>
    >([]);
    const [incidentPublicNotes, setIncidentPublicNotes] = useState<
        Array<IncidentPublicNote>
    >([]);
    const [incident, setIncident] = useState<Incident | null>(null);
    const [incidentStateTimelines, setIncidentStateTimelines] = useState<
        Array<IncidentStateTimeline>
    >([]);
    const [parsedData, setParsedData] =
        useState<EventItemComponentProps | null>(null);

    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const id: ObjectID = LocalStorage.getItem(
                'statusPageId'
            ) as ObjectID;

            const incidentId: string | undefined = Navigation.getLastParam()
                ?.toString()
                .replace('/', '');

            if (!id) {
                throw new BadDataException('Status Page ID is required');
            }
            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/status-page/incidents/${id.toString()}/${incidentId?.toString()}`
                    ),
                    {},
                    {}
                );
            const data: JSONObject = response.data;

            const incidentPublicNotes: Array<IncidentPublicNote> =
                JSONFunctions.fromJSONArray(
                    (data['incidentPublicNotes'] as JSONArray) || [],
                    IncidentPublicNote
                );
            const incident: Incident = JSONFunctions.fromJSONObject(
                (data['incident'] as JSONObject) || [],
                Incident
            );
            const statusPageResources: Array<StatusPageResource> =
                JSONFunctions.fromJSONArray(
                    (data['statusPageResources'] as JSONArray) || [],
                    StatusPageResource
                );
            const incidentStateTimelines: Array<IncidentStateTimeline> =
                JSONFunctions.fromJSONArray(
                    (data['incidentStateTimelines'] as JSONArray) || [],
                    IncidentStateTimeline
                );

            // save data. set()
            setIncidentPublicNotes(incidentPublicNotes);
            setIncident(incident);
            setStatusPageResources(statusPageResources);
            setIncidentStateTimelines(incidentStateTimelines);

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

        if (!incident) {
            return;
        }

        setParsedData(
            getIncidentEventItem(
                incident,
                incidentPublicNotes,
                incidentStateTimelines,
                statusPageResources,
                props.isPreviewPage
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
            {incident ? <EventItem {...parsedData} /> : <></>}
            {!incident ? (
                <ErrorMessage error="No incident found with this ID." />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Detail;
