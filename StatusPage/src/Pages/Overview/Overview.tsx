import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import Accordian from 'CommonUI/src/Components/Accordian/Accordian';
import AccordianGroup from 'CommonUI/src/Components/Accordian/AccordianGroup';
import Alert, { AlertSize, AlertType } from 'CommonUI/src/Components/Alerts/Alert';
import ActiveEvent from 'CommonUI/src/Components/ActiveEvent/ActiveEvent';
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
import StatusPageGroup from 'Model/Models/StatusPageGroup';
import StatusPageResource from 'Model/Models/StatusPageResource';
import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusTimeline from 'Model/Models/MonitorStatusTimeline';
import Incident from 'Model/Models/Incident';
import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import MonitorOverview from '../../Components/Monitor/MonitorOverview';
import { Green } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';

const Overview: FunctionComponent<PageComponentProps> = (
    _props: PageComponentProps
): ReactElement => {


    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [scheduledMaintenanceEventsPublicNotes, setScheduledMaintenanceEventsPublicNotes] = useState<Array<ScheduledMaintenancePublicNote>>([]);
    const [activeScheduledMaintenanceEvents, setActiveScheduledMaintenanceEvents] = useState<Array<ScheduledMaintenance>>([]);
    const [activeAnnouncements, setActiveAnnouncements] = useState<Array<StatusPageAnnouncement>>([]);
    const [incidentPublicNotes, setIncidentPublicNotes] = useState<Array<IncidentPublicNote>>([]);
    const [activeIncidents, setActiveIncidents] = useState<Array<Incident>>([]);
    const [monitorStatusTimelines, setMonitorStatusTimelines] = useState<Array<MonitorStatusTimeline>>([]);
    const [resourceGroups, setResourceGroups] = useState<Array<StatusPageGroup>>([]);
    const [monitorStatuses, setMonitorStatuses] = useState<Array<MonitorStatus>>([]);
    const [statusPageResources, setStatusPageResources] = useState<Array<StatusPageResource>>([]);
    const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
    const endDate: Date = OneUptimeDate.getCurrentDate();


    useAsyncEffect(async () => {
        try {
            setIsLoading(true);

            const id = LocalStorage.getItem('statusPageId') as ObjectID;
            if (!id) {
                throw new BadDataException("Status Page ID is required");
            }
            const response = await BaseAPI.post<JSONObject>(URL.fromString(DASHBOARD_API_URL.toString()).addRoute(`/status-page/overview/${id.toString()}`), {}, {});
            const data = response.data;


            const scheduledMaintenanceEventsPublicNotes = BaseModel.fromJSONArray(data['scheduledMaintenanceEventsPublicNotes'] as JSONArray || [], ScheduledMaintenancePublicNote);
            const activeScheduledMaintenanceEvents = BaseModel.fromJSONArray(data['activeScheduledMaintenanceEvents'] as JSONArray || [], ScheduledMaintenance);
            const activeAnnouncements = BaseModel.fromJSONArray(data['activeAnnouncements'] as JSONArray || [], StatusPageAnnouncement);
            const incidentPublicNotes = BaseModel.fromJSONArray(data['incidentPublicNotes'] as JSONArray || [], IncidentPublicNote);
            const activeIncidents = BaseModel.fromJSONArray(data['activeIncidents'] as JSONArray || [], Incident);
            const monitorStatusTimelines = BaseModel.fromJSONArray(data['monitorStatusTimelines'] as JSONArray || [], MonitorStatusTimeline);
            const resourceGroups = BaseModel.fromJSONArray(data['groups'] as JSONArray || [], StatusPageGroup);
            const monitorStatuses = BaseModel.fromJSONArray(data['monitorStatuses'] as JSONArray || [], MonitorStatus);
            const statusPageResources = BaseModel.fromJSONArray(data['statusPageResources'] as JSONArray || [], StatusPageResource);

            // save data. set()
            setScheduledMaintenanceEventsPublicNotes(scheduledMaintenanceEventsPublicNotes)
            setActiveScheduledMaintenanceEvents(activeScheduledMaintenanceEvents)
            setActiveAnnouncements(activeAnnouncements)
            setIncidentPublicNotes(incidentPublicNotes)
            setActiveIncidents(activeIncidents)
            setMonitorStatusTimelines(monitorStatusTimelines)
            setResourceGroups(resourceGroups)
            setMonitorStatuses(monitorStatuses)
            setStatusPageResources(statusPageResources)

            // Parse Data.


            setIsLoading(false);
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


    if (isLoading) {
        return <PageLoader isVisible={true} />
    }

    if (error) {
        return <ErrorMessage error={error} />
    }

    const getMonitorOverviewListInGroup = (group: StatusPageGroup | null): Array<ReactElement> => {
        const elements: Array<ReactElement> = [];

        for (const resource of statusPageResources) {
            if (
                (resource.statusPageGroupId && resource.statusPageGroupId.toString() && group && group._id?.toString()) ||
                (!resource.statusPageGroupId && !group)

            ) {

                let currentStatus = monitorStatuses.find((status) => {
                    return status._id?.toString() === resource.monitor?.currentMonitorStatusId?.toString()
                });

                if (!currentStatus) {
                    currentStatus = new MonitorStatus();
                    currentStatus.name = 'Operational';
                    currentStatus.color = Green;
                }



                elements.push((
                    <MonitorOverview
                        monitorName={resource.displayName || resource.monitor?.name! || ''}
                        description={resource.displayDescription || ''}
                        tooltip={resource.displayTooltip || ''}
                        monitorStatus={currentStatus}
                        monitorStatusTimeline={monitorStatusTimelines.filter((timeline) => timeline.monitorId?.toString() === resource.monitorId?.toString())}
                        startDate={startDate}
                        endDate={endDate}
                    />
                ));
            }
        }

        return elements;
    };


    // const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
    // const endDate: Date = OneUptimeDate.getCurrentDate();


    return (
        <Page>

            {isLoading ? <PageLoader isVisible={true} /> : <></>}
            {error ? <ErrorMessage error={error} /> : <></>}

            {!isLoading && !error ? <div>
                {/* Load Active Anouncement */}
                <ActiveEvent />

                {/* Load Active Incident */}

                {/* Load Active ScheduledEvent */}

                <div>
                    <Alert
                        title='All Systems Operatonal'
                        type={AlertType.SUCCESS}
                        doNotShowIcon={true}
                        size={AlertSize.Large}
                    />
                </div>

                {resourceGroups.length > 0 ?
                    <div>
                        <AccordianGroup>
                            {resourceGroups.map((resourceGroup) => {
                                return (<Accordian title={resourceGroup.name!}>
                                    {getMonitorOverviewListInGroup(resourceGroup)}
                                </Accordian>)
                            })}
                        </AccordianGroup>
                    </div> : <></>
                }
            </div> : <></>}


        </Page>
    );
};

export default Overview;
