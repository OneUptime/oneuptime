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
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import Label from 'Model/Models/Label';
import Dictionary from 'Common/Types/Dictionary';

export const getIncidentEventItem: Function = (
    incident: Incident,
    incidentPublicNotes: Array<IncidentPublicNote>,
    incidentStateTimelines: Array<IncidentStateTimeline>,
    statusPageResources: Array<StatusPageResource>,
    monitorsInGroup: Dictionary<Array<ObjectID>>,
    isPreviewPage: boolean,
    isSummary: boolean
): EventItemComponentProps => {
    const timeline: Array<TimelineItem> = [];

    let currentStateStatus: string = '';
    let currentStatusColor: Color = Green;

    if (isSummary) {
        // If this is summary then reverse the order so we show the latest first
        incidentPublicNotes.sort(
            (a: IncidentPublicNote, b: IncidentPublicNote) => {
                return OneUptimeDate.isAfter(a.createdAt!, b.createdAt!) ===
                    false
                    ? 1
                    : -1;
            }
        );

        incidentStateTimelines.sort(
            (a: IncidentStateTimeline, b: IncidentStateTimeline) => {
                return OneUptimeDate.isAfter(a.createdAt!, b.createdAt!) ===
                    false
                    ? 1
                    : -1;
            }
        );
    }

    for (const incidentPublicNote of incidentPublicNotes) {
        if (
            incidentPublicNote.incidentId?.toString() ===
                incident.id?.toString() &&
            incidentPublicNote?.note
        ) {
            timeline.push({
                note: incidentPublicNote?.note,
                date: incidentPublicNote?.createdAt as Date,
                type: TimelineItemType.Note,
                icon: IconProp.Chat,
                iconColor: Grey,
            });

            // If this incident is a sumamry then don't include all the notes .
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
                date: incidentStateTimeline?.createdAt as Date,
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

            // If this incident is a sumamry then don't include all the notes .
            if (isSummary) {
                break;
            }
        }
    }

    timeline.sort((a: TimelineItem, b: TimelineItem) => {
        return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
    });

    const monitorIdsInThisIncident: Array<string | undefined> =
        incident.monitors?.map((monitor: Monitor) => {
            return monitor._id;
        }) || [];

    let namesOfResources: Array<StatusPageResource> =
        statusPageResources.filter((resource: StatusPageResource) => {
            return monitorIdsInThisIncident.includes(
                resource.monitorId?.toString()
            );
        });

    // add names of the groups as well.
    namesOfResources = namesOfResources.concat(
        statusPageResources.filter((resource: StatusPageResource) => {
            if (!resource.monitorGroupId) {
                return false;
            }

            const monitorGroupId: string = resource.monitorGroupId.toString();

            const monitorIdsInThisGroup: Array<ObjectID> =
                monitorsInGroup[monitorGroupId]! || [];

            for (const monitorId of monitorIdsInThisGroup) {
                if (
                    monitorIdsInThisIncident.find((id: string | undefined) => {
                        return id?.toString() === monitorId.toString();
                    })
                ) {
                    return true;
                }
            }

            return false;
        })
    );

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
        eventSecondDescription: incident.createdAt
            ? 'Created at ' +
              OneUptimeDate.getDateAsLocalFormattedString(incident.createdAt!)
            : '',
        eventTypeColor: Red,
        labels:
            incident.labels?.map((label: Label) => {
                return {
                    name: label.name!,
                    color: label.color!,
                };
            }) || [],
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

    const [monitorsInGroup, setMonitorsInGroup] = useState<
        Dictionary<Array<ObjectID>>
    >({});

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
                await API.post<JSONObject>(
                    URL.fromString(STATUS_PAGE_API_URL.toString()).addRoute(
                        `/incidents/${id.toString()}/${incidentId?.toString()}`
                    ),
                    {},
                    API.getDefaultHeaders(StatusPageUtil.getStatusPageId()!)
                );

            if (!response.isSuccess()) {
                throw response;
            }
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

            const monitorsInGroup: Dictionary<Array<ObjectID>> =
                JSONFunctions.deserialize(
                    (data['monitorsInGroup'] as JSONObject) || {}
                ) as Dictionary<Array<ObjectID>>;

            setMonitorsInGroup(monitorsInGroup);

            // save data. set()
            setIncidentPublicNotes(incidentPublicNotes);
            setIncident(incident);
            setStatusPageResources(statusPageResources);
            setIncidentStateTimelines(incidentStateTimelines);

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
                monitorsInGroup,
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
                    id="incident-empty-state"
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
