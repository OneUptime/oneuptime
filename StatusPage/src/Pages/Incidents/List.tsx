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
import Incident from 'Model/Models/Incident';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import { Red } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
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
    const [incidentPublicNotes, setIncidentPublicNotes] = useState<
        Array<IncidentPublicNote>
    >([]);
    const [incidents, setIncidents] = useState<Array<Incident>>([]);
    const [incidentStateTimelines, setIncidentStateTimelines] = useState<
        Array<IncidentStateTimeline>
    >([]);
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
                    `/status-page/incidents/${id.toString()}`
                ),
                {},
                {}
            );
            const data = response.data;

            const incidentPublicNotes = BaseModel.fromJSONArray(
                (data['incidentPublicNotes'] as JSONArray) || [],
                IncidentPublicNote
            );
            const incidents = BaseModel.fromJSONArray(
                (data['incidents'] as JSONArray) || [],
                Incident
            );
            const statusPageResources = BaseModel.fromJSONArray(
                (data['statusPageResources'] as JSONArray) || [],
                StatusPageResource
            );
            const incidentStateTimelines = BaseModel.fromJSONArray(
                (data['incidentStateTimelines'] as JSONArray) || [],
                IncidentStateTimeline
            );

            // save data. set()
            setIncidentPublicNotes(incidentPublicNotes);
            setIncidents(incidents);
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

        const eventHistoryListComponentProps: EventHistoryListComponentProps = {
            items: [],
        };

        const days: Dictionary<EventHistoryDayListComponentProps> = {};

        for (const incident of incidents) {
            const dayString = OneUptimeDate.getDateString(incident.createdAt!);

            if (!days[dayString]) {
                days[dayString] = {
                    date: incident.createdAt!,
                    items: [],
                };
            }

            /// get timeline.

            const timeline = [];

            for (const incidentPublicNote of incidentPublicNotes) {
                if (
                    incidentPublicNote.incidentId?.toString() ===
                    incident.id?.toString()
                ) {
                    timeline.push({
                        text: incidentPublicNote?.note || '',
                        date: incidentPublicNote?.createdAt!,
                        isBold: false,
                    });
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
                        color:
                            incidentStateTimeline.incidentState?.color || Red,
                    });
                }
            }

            timeline.sort((a, b) => {
                return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
            });

            days[dayString]?.items.push({
                eventTitle: incident.title || '',
                eventDescription: incident.description,
                eventTimeline: timeline,
                eventType: 'Incident',
                eventViewRoute: RouteUtil.populateRouteParams(
                    RouteMap[PageMap.INCIDENT_DETAIL] as Route,
                    incident.id!
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
            <h3>Incidents</h3>
            <EventHistoryList {...parsedData} />
        </Page>
    );
};

export default Overview;
