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
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import { getIncidentEventItem } from './Detail';

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
    const [parsedData, setParsedData] =
        useState<EventHistoryListComponentProps | null>(null);

    useAsyncEffect(async () => {
        try {
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
                        `/status-page/incidents/${id.toString()}`
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
            const incidents: Array<Incident> =  JSONFunctions.fromJSONArray(
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
                    props.isPreviewPage
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
        <Page>
            {incidents && incidents.length > 0 ? (
                <div>
                    <h4>Incidents</h4>
                    <p>
                        Here is the incident history for all the resources on
                        this status page.
                    </p>
                </div>
            ) : (
                <></>
            )}
            {incidents && incidents.length > 0 ? (
                <EventHistoryList {...parsedData} />
            ) : (
                <></>
            )}
            {incidents.length === 0 ? (
                <ErrorMessage error="No incidents reported on this status page." />
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
