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
    TimelineItemType,
} from 'CommonUI/src/Components/EventItem/EventItem';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Monitor from 'Model/Models/Monitor';
import Color from 'Common/Types/Color';
import { Green, Grey, Red } from 'Common/Types/BrandColors';
import IconProp from 'Common/Types/Icon/IconProp';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import API from '../../Utils/API';
import StatusPageUtil from '../../Utils/StatusPage';

export const getIncidentEventItem: Function = (
    incident: Incident,
    incidentPublicNotes: Array<IncidentPublicNote>,
    incidentStateTimelines: Array<IncidentStateTimeline>,
    statusPageResources: Array<StatusPageResource>,
    isPreviewPage: boolean,
    isSummary: boolean
): EventItemComponentProps => {
    const timeline: Array<TimelineItem> = [];

    let currentStateStatus: string = '';
    let currentStatusColor: Color = Green;

    for (const incidentPublicNote of incidentPublicNotes) {
        if (
            incidentPublicNote.incidentId?.toString() ===
                incident.id?.toString() &&
            incidentPublicNote?.note
        ) {
            timeline.push({
                note: incidentPublicNote?.note,
                date: incidentPublicNote?.createdAt!,
                type: TimelineItemType.Note,
                icon: IconProp.Chat,
                iconColor: Grey,
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
                incident.id?.toString() &&
            incidentStateTimeline.incidentState
        ) {
            timeline.push({
                state: incidentStateTimeline.incidentState,
                date: incidentStateTimeline?.createdAt!,
                type: TimelineItemType.StateChange,
                icon: incidentStateTimeline.incidentState.isCreatedState
                    ? IconProp.Alert
                    : incidentStateTimeline.incidentState.isAcknowledgedState
                    ? IconProp.TransparentCube
                    : incidentStateTimeline.incidentState.isResolvedState
                    ? IconProp.CheckCircle
                    : IconProp.ArrowCircleRight,
                iconColor: incidentStateTimeline.incidentState.color || Grey,
            });

            if (!currentStateStatus) {
                currentStateStatus =
                    incidentStateTimeline.incidentState?.name || '';
                currentStatusColor =
                    incidentStateTimeline.incidentState?.color || Green;
            }

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
        eventViewRoute: !isSummary
            ? undefined
            : RouteUtil.populateRouteParams(
                  isPreviewPage
                      ? (RouteMap[PageMap.PREVIEW_INCIDENT_DETAIL] as Route)
                      : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
                  incident.id!
              ),
        isDetailItem: !isSummary,
        currentStatus: currentStateStatus,
        currentStatusColor: currentStatusColor,
        anotherStatusColor: incident.incidentSeverity?.color || undefined,
        anotherStatus: incident.incidentSeverity?.name,
        eventSecondDescription:
            'Created at ' +
            OneUptimeDate.getDateAsLocalFormattedString(incident.createdAt!),
        eventTypeColor: Red,
    };

    return data;
};

const Detail: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    StatusPageUtil.checkIfUserHasLoggedIn();

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
            if (!StatusPageUtil.getStatusPageId()) {
                return;
            }
            setIsLoading(true);

            const id: ObjectID = LocalStorage.getItem(
                'statusPageId'
            ) as ObjectID;

            const incidentId: string | undefined =
                Navigation.getLastParamAsObjectID().toString();

            if (!id) {
                throw new BadDataException('Status Page ID is required');
            }
            const response: HTTPResponse<JSONObject> =
                await BaseAPI.post<JSONObject>(
                    URL.fromString(DASHBOARD_API_URL.toString()).addRoute(
                        `/status-page/incidents/${id.toString()}/${incidentId?.toString()}`
                    ),
                    {},
                    API.getDefaultHeaders(StatusPageUtil.getStatusPageId())
                );
            const data: JSONObject = response.data;

            const incidentPublicNotes: Array<IncidentPublicNote> =
                JSONFunctions.fromJSONArray(
                    (data['incidentPublicNotes'] as JSONArray) || [],
                    IncidentPublicNote
                );

            const rawIncidents: JSONArray =
                (data['incidents'] as JSONArray) || [];
            const incident: Incident = JSONFunctions.fromJSONObject(
                (rawIncidents[0] as JSONObject) || {},
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

        if (!incident) {
            return;
        }

        setParsedData(
            getIncidentEventItem(
                incident,
                incidentPublicNotes,
                incidentStateTimelines,
                statusPageResources,
                StatusPageUtil.isPreviewPage()
            )
        );
    }, [isLoading, incident]);

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
            title="Incident Report"
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
                    title: 'Incidents',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[PageMap.PREVIEW_INCIDENT_LIST] as Route)
                            : (RouteMap[PageMap.INCIDENT_LIST] as Route)
                    ),
                },
                {
                    title: 'Incident Report',
                    to: RouteUtil.populateRouteParams(
                        StatusPageUtil.isPreviewPage()
                            ? (RouteMap[
                                  PageMap.PREVIEW_INCIDENT_DETAIL
                              ] as Route)
                            : (RouteMap[PageMap.INCIDENT_DETAIL] as Route),
                        Navigation.getLastParamAsObjectID()
                    ),
                },
            ]}
        >
            {incident ? <EventItem {...parsedData} /> : <></>}
            {!incident ? (
                <EmptyState
                    title={'No Incident'}
                    description={'Incident not found on this status page.'}
                    icon={IconProp.Alert}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Detail;
