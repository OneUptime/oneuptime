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
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import JSONFunctions from 'Common/Types/JSONFunctions';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import EventHistoryList, {
    ComponentProps as EventHistoryListComponentProps,
} from 'CommonUI/src/Components/EventHistoryList/EventHistoryList';
import { ComponentProps as EventHistoryDayListComponentProps } from 'CommonUI/src/Components/EventHistoryList/EventHistoryDayList';
import StatusPageResource from 'Model/Models/StatusPageResource';
import Incident from 'Model/Models/Incident';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { getIncidentEventItem } from './Detail';
import Route from 'Common/Types/API/Route';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import API from '../../Utils/API';
import StatusPageUtil from '../../Utils/StatusPage';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import Section from '../../Components/Section/Section';
import IncidentState from 'Model/Models/IncidentState';

const Overview: FunctionComponent<PageComponentProps> = (
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
    const [incidents, setIncidents] = useState<Array<Incident>>([]);
    const [incidentStateTimelines, setIncidentStateTimelines] = useState<
        Array<IncidentStateTimeline>
    >([]);

    const [parsedActiveIncidentsData, setParsedActiveIncidentsData] =
        useState<EventHistoryListComponentProps | null>(null);

    const [parsedResolvedIncidentsData, setParsedResolvedIncidentsData] =
        useState<EventHistoryListComponentProps | null>(null);

    const [monitorsInGroup, setMonitorsInGroup] = useState<
        Dictionary<Array<ObjectID>>
    >({});

    const [incidentStates, setIncidentStates] = useState<Array<IncidentState>>(
        []
    );

    StatusPageUtil.checkIfUserHasLoggedIn();

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
                        `/incidents/${id.toString()}`
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
            const incidents: Array<Incident> = JSONFunctions.fromJSONArray(
                (data['incidents'] as JSONArray) || [],
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

            const incidentStates: Array<IncidentState> =
                JSONFunctions.fromJSONArray(
                    (data['incidentStates'] as JSONArray) || [],
                    IncidentState
                );

            setMonitorsInGroup(monitorsInGroup);
            setIncidentStates(incidentStates);

            // save data. set()
            setIncidentPublicNotes(incidentPublicNotes);
            setIncidents(incidents);
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

    const getEventHistoryListComponentProps: Function = (
        incidents: Array<Incident>
    ): EventHistoryListComponentProps => {
        const eventHistoryListComponentProps: EventHistoryListComponentProps = {
            items: [],
        };

        const days: Dictionary<EventHistoryDayListComponentProps> = {};

        for (const incident of incidents) {
            const dayString: string = OneUptimeDate.getDateString(
                incident.createdAt!
            );

            if (!days[dayString]) {
                days[dayString] = {
                    date: incident.createdAt!,
                    items: [],
                };
            }

            days[dayString]?.items.push(
                getIncidentEventItem(
                    incident,
                    incidentPublicNotes,
                    incidentStateTimelines,
                    statusPageResources,
                    monitorsInGroup,
                    StatusPageUtil.isPreviewPage(),
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

    useEffect(() => {
        if (isLoading) {
            // parse data;
            setParsedActiveIncidentsData(null);
            setParsedResolvedIncidentsData(null);
            return;
        }

        const resolvedIncidentStateOrder: number =
            incidentStates.find((state: IncidentState) => {
                return state.isResolvedState;
            })?.order || 0;

        const activeIncidents: Array<Incident> = incidents.filter(
            (incident: Incident) => {
                return (
                    (incident.currentIncidentState?.order || 0) <
                    resolvedIncidentStateOrder
                );
            }
        );

        const resolvedIncidents: Array<Incident> = incidents.filter(
            (incident: Incident) => {
                return !(
                    (incident.currentIncidentState?.order || 0) <
                    resolvedIncidentStateOrder
                );
            }
        );

        setParsedActiveIncidentsData(
            getEventHistoryListComponentProps(activeIncidents)
        );
        setParsedResolvedIncidentsData(
            getEventHistoryListComponentProps(resolvedIncidents)
        );
    }, [isLoading]);

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    return (
        <Page
            title={'Incidents'}
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
            ]}
        >
            {parsedActiveIncidentsData?.items &&
            parsedActiveIncidentsData?.items.length > 0 ? (
                <div>
                    <Section title="Active Incidents" />

                    <EventHistoryList
                        items={parsedActiveIncidentsData?.items || []}
                    />
                </div>
            ) : (
                <></>
            )}

            {parsedResolvedIncidentsData?.items &&
            parsedResolvedIncidentsData?.items.length > 0 ? (
                <div>
                    <Section title="Resolved Incidents" />

                    <EventHistoryList
                        items={parsedResolvedIncidentsData?.items || []}
                    />
                </div>
            ) : (
                <></>
            )}
            {incidents.length === 0 ? (
                <EmptyState
                    id={'incidents-empty-state'}
                    title={'No Incident'}
                    description={'No incidents posted on this status page.'}
                    icon={IconProp.Alert}
                />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
