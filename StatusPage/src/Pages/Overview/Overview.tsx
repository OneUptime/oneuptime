import React, { FunctionComponent, ReactElement, useState } from 'react';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import Accordian from 'CommonUI/src/Components/Accordian/Accordian';
import AccordianGroup from 'CommonUI/src/Components/Accordian/AccordianGroup';
import Alert, { AlertSize } from 'CommonUI/src/Components/Alerts/Alert';
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
import { Blue, Green, Red, Yellow } from 'Common/Types/BrandColors';
import OneUptimeDate from 'Common/Types/Date';
import Dictionary from 'Common/Types/Dictionary';
import IncidentGroup from '../../Types/IncidentGroup';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import RouteMap, { RouteUtil } from '../../Utils/RouteMap';
import PageMap from '../../Utils/PageMap';
import Route from 'Common/Types/API/Route';
import ScheduledMaintenanceGroup from '../../Types/ScheduledMaintenanceGroup';
import { TimelineItem } from 'CommonUI/src/Components/EventItem/EventItem';
import HTTPResponse from 'Common/Types/API/HTTPResponse';

const Overview: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [
        scheduledMaintenanceEventsPublicNotes,
        setScheduledMaintenanceEventsPublicNotes,
    ] = useState<Array<ScheduledMaintenancePublicNote>>([]);
    const [
        activeScheduledMaintenanceEvents,
        setActiveScheduledMaintenanceEvents,
    ] = useState<Array<ScheduledMaintenance>>([]);
    const [activeAnnouncements, setActiveAnnouncements] = useState<
        Array<StatusPageAnnouncement>
    >([]);
    const [incidentPublicNotes, setIncidentPublicNotes] = useState<
        Array<IncidentPublicNote>
    >([]);
    const [activeIncidents, setActiveIncidents] = useState<Array<Incident>>([]);
    const [monitorStatusTimelines, setMonitorStatusTimelines] = useState<
        Array<MonitorStatusTimeline>
    >([]);
    const [resourceGroups, setResourceGroups] = useState<
        Array<StatusPageGroup>
    >([]);
    const [monitorStatuses, setMonitorStatuses] = useState<
        Array<MonitorStatus>
    >([]);
    const [statusPageResources, setStatusPageResources] = useState<
        Array<StatusPageResource>
    >([]);
    const [incidentStateTimelines, setIncidentStateTimelines] = useState<
        Array<IncidentStateTimeline>
    >([]);
    const [
        scheduledMaintenanceStateTimelines,
        setScheduledMaintenanceStateTimelines,
    ] = useState<Array<ScheduledMaintenanceStateTimeline>>([]);
    const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const [currentStatus, setCurrentStatus] = useState<MonitorStatus | null>(
        null
    );

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
                        `/status-page/overview/${id.toString()}`
                    ),
                    {},
                    {}
                );
            const data: JSONObject = response.data;

            const scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
                BaseModel.fromJSONArray(
                    (data[
                        'scheduledMaintenanceEventsPublicNotes'
                    ] as JSONArray) || [],
                    ScheduledMaintenancePublicNote
                );
            const activeScheduledMaintenanceEvents: Array<ScheduledMaintenance> =
                BaseModel.fromJSONArray(
                    (data['activeScheduledMaintenanceEvents'] as JSONArray) ||
                        [],
                    ScheduledMaintenance
                );
            const activeAnnouncements: Array<StatusPageAnnouncement> =
                BaseModel.fromJSONArray(
                    (data['activeAnnouncements'] as JSONArray) || [],
                    StatusPageAnnouncement
                );
            const incidentPublicNotes: Array<IncidentPublicNote> =
                BaseModel.fromJSONArray(
                    (data['incidentPublicNotes'] as JSONArray) || [],
                    IncidentPublicNote
                );
            const activeIncidents: Array<Incident> = BaseModel.fromJSONArray(
                (data['activeIncidents'] as JSONArray) || [],
                Incident
            );
            const monitorStatusTimelines: Array<MonitorStatusTimeline> =
                BaseModel.fromJSONArray(
                    (data['monitorStatusTimelines'] as JSONArray) || [],
                    MonitorStatusTimeline
                );
            const resourceGroups: Array<StatusPageGroup> =
                BaseModel.fromJSONArray(
                    (data['resourceGroups'] as JSONArray) || [],
                    StatusPageGroup
                );
            const monitorStatuses: Array<MonitorStatus> =
                BaseModel.fromJSONArray(
                    (data['monitorStatuses'] as JSONArray) || [],
                    MonitorStatus
                );
            const statusPageResources: Array<StatusPageResource> =
                BaseModel.fromJSONArray(
                    (data['statusPageResources'] as JSONArray) || [],
                    StatusPageResource
                );
            const incidentStateTimelines: Array<IncidentStateTimeline> =
                BaseModel.fromJSONArray(
                    (data['incidentStateTimelines'] as JSONArray) || [],
                    IncidentStateTimeline
                );
            const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
                BaseModel.fromJSONArray(
                    (data['scheduledMaintenanceStateTimelines'] as JSONArray) ||
                        [],
                    ScheduledMaintenanceStateTimeline
                );

            // save data. set()
            setScheduledMaintenanceEventsPublicNotes(
                scheduledMaintenanceEventsPublicNotes
            );
            setActiveScheduledMaintenanceEvents(
                activeScheduledMaintenanceEvents
            );
            setActiveAnnouncements(activeAnnouncements);
            setIncidentPublicNotes(incidentPublicNotes);
            setActiveIncidents(activeIncidents);
            setMonitorStatusTimelines(monitorStatusTimelines);
            setResourceGroups(resourceGroups);
            setMonitorStatuses(monitorStatuses);
            setStatusPageResources(statusPageResources);
            setIncidentStateTimelines(incidentStateTimelines);
            setScheduledMaintenanceStateTimelines(
                scheduledMaintenanceStateTimelines
            );

            // Parse Data.
            setCurrentStatus(
                getOverallMonitorStatus(statusPageResources, monitorStatuses)
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

    const getOverallMonitorStatus: Function = (
        statusPageResources: Array<StatusPageResource>,
        monitorStatuses: Array<MonitorStatus>
    ): MonitorStatus | null => {
        let currentStatus: MonitorStatus | null =
            monitorStatuses.length > 0 && monitorStatuses[0]
                ? monitorStatuses[0]
                : null;
        const dict: Dictionary<number> = {};

        for (const resource of statusPageResources) {
            if (resource.monitor?.currentMonitorStatusId) {
                if (
                    !Object.keys(dict).includes(
                        resource.monitor?.currentMonitorStatusId.toString() ||
                            ''
                    )
                ) {
                    dict[
                        resource.monitor?.currentMonitorStatusId.toString()
                    ] = 1;
                } else {
                    dict[resource.monitor?.currentMonitorStatusId.toString()]++;
                }
            }
        }

        for (const monitorStatus of monitorStatuses) {
            if (monitorStatus._id && dict[monitorStatus._id]) {
                currentStatus = monitorStatus;
            }
        }

        return currentStatus;
    };

    if (isLoading) {
        return <PageLoader isVisible={true} />;
    }

    if (error) {
        return <ErrorMessage error={error} />;
    }

    const getMonitorOverviewListInGroup: Function = (
        group: StatusPageGroup | null
    ): Array<ReactElement> => {
        const elements: Array<ReactElement> = [];

        for (const resource of statusPageResources) {
            if (
                (resource.statusPageGroupId &&
                    resource.statusPageGroupId.toString() &&
                    group &&
                    group._id?.toString() &&
                    group._id?.toString() ===
                        resource.statusPageGroupId.toString()) ||
                (!resource.statusPageGroupId && !group)
            ) {
                let currentStatus: MonitorStatus | undefined =
                    monitorStatuses.find((status: MonitorStatus) => {
                        return (
                            status._id?.toString() ===
                            resource.monitor?.currentMonitorStatusId?.toString()
                        );
                    });

                if (!currentStatus) {
                    currentStatus = new MonitorStatus();
                    currentStatus.name = 'Operational';
                    currentStatus.color = Green;
                }

                elements.push(
                    <MonitorOverview
                        key={Math.random()}
                        monitorName={
                            resource.displayName ||
                            resource.monitor?.name! ||
                            ''
                        }
                        description={resource.displayDescription || ''}
                        tooltip={resource.displayTooltip || ''}
                        monitorStatus={currentStatus}
                        monitorStatusTimeline={[
                            ...monitorStatusTimelines,
                        ].filter((timeline: MonitorStatusTimeline) => {
                            return (
                                timeline.monitorId?.toString() ===
                                resource.monitorId?.toString()
                            );
                        })}
                        startDate={startDate}
                        endDate={endDate}
                        showHistoryChart={resource.showStatusHistoryChart}
                        showCurrentStatus={resource.showCurrentStatus}
                    />
                );
            }
        }

        if (elements.length === 0) {
            elements.push(
                <p key={1} className="text-center">
                    No resources in this group.
                </p>
            );
        }

        return elements;
    };

    const getActiveIncidents: Function = (): Array<IncidentGroup> => {
        const groups: Array<IncidentGroup> = [];

        for (const activeIncident of activeIncidents) {
            if (!activeIncident.currentIncidentState) {
                throw new BadDataException('Incident State not found.');
            }

            const timeline: IncidentStateTimeline | undefined =
                incidentStateTimelines.find(
                    (timeline: IncidentStateTimeline) => {
                        return (
                            timeline.incidentId?.toString() ===
                            activeIncident._id
                        );
                    }
                );

            if (!timeline) {
                throw new BadDataException('Incident Timeline not found.');
            }

            const group: IncidentGroup = {
                incident: activeIncident,
                incidentState: activeIncident.currentIncidentState,
                publicNote: incidentPublicNotes.find(
                    (publicNote: IncidentPublicNote) => {
                        return (
                            publicNote.incidentId?.toString() ===
                            activeIncident._id
                        );
                    }
                ),
                incidentSeverity: activeIncident.incidentSeverity!,
                incidentStateTimeline: timeline,
            };

            groups.push(group);
        }

        return groups;
    };

    const getOngoingScheduledEvents: Function =
        (): Array<ScheduledMaintenanceGroup> => {
            const groups: Array<ScheduledMaintenanceGroup> = [];

            for (const activeEvent of activeScheduledMaintenanceEvents) {
                if (!activeEvent.currentScheduledMaintenanceState) {
                    throw new BadDataException(
                        'Scheduled Maintenance State not found.'
                    );
                }

                const timeline: ScheduledMaintenanceStateTimeline | undefined =
                    scheduledMaintenanceStateTimelines.find(
                        (timeline: ScheduledMaintenanceStateTimeline) => {
                            return (
                                timeline.scheduledMaintenanceId?.toString() ===
                                activeEvent._id
                            );
                        }
                    );

                if (!timeline) {
                    throw new BadDataException('Incident Timeline not found.');
                }

                const group: ScheduledMaintenanceGroup = {
                    scheduledMaintenance: activeEvent,
                    scheduledMaintenanceState:
                        activeEvent.currentScheduledMaintenanceState,
                    publicNote: scheduledMaintenanceEventsPublicNotes.find(
                        (publicNote: ScheduledMaintenancePublicNote) => {
                            return (
                                publicNote.scheduledMaintenanceId?.toString() ===
                                activeEvent._id
                            );
                        }
                    ),
                    scheduledMaintenanceStateTimeline: timeline,
                };

                groups.push(group);
            }

            return groups;
        };

    const getRightAccordianElement: Function = (
        group: StatusPageGroup
    ): ReactElement => {
        let currentStatus: MonitorStatus = new MonitorStatus();
        currentStatus.name = 'Operational';
        currentStatus.color = Green;
        let hasReosurce: boolean = false;

        for (const resource of statusPageResources) {
            if (
                (resource.statusPageGroupId &&
                    resource.statusPageGroupId.toString() &&
                    group &&
                    group._id?.toString() &&
                    group._id?.toString() ===
                        resource.statusPageGroupId.toString()) ||
                (!resource.statusPageGroupId && !group)
            ) {
                hasReosurce = true;
                const currentMonitorStatus: MonitorStatus | undefined =
                    monitorStatuses.find((status: MonitorStatus) => {
                        return (
                            status._id?.toString() ===
                            resource.monitor?.currentMonitorStatusId?.toString()
                        );
                    });

                if (
                    (currentStatus &&
                        currentStatus.priority &&
                        currentMonitorStatus?.priority &&
                        currentMonitorStatus?.priority >
                            currentStatus.priority) ||
                    !currentStatus.priority
                ) {
                    currentStatus = currentMonitorStatus!;
                }
            }
        }

        if (hasReosurce) {
            return (
                <div
                    className="bold font16"
                    style={{
                        color:
                            currentStatus?.color?.toString() ||
                            Green.toString(),
                    }}
                >
                    {currentStatus?.name || 'Operational'}
                </div>
            );
        }
        return <></>;
    };

    const getScheduledEventGroupEventTimeline: Function = (
        scheduledEventGroup: ScheduledMaintenanceGroup
    ): Array<TimelineItem> => {
        const timeline: Array<TimelineItem> = [];

        timeline.push({
            text: scheduledEventGroup.scheduledMaintenanceState.name!,
            date: scheduledEventGroup.scheduledMaintenanceStateTimeline
                .createdAt!,
            isBold: true,
        });

        timeline.push({
            text: scheduledEventGroup.publicNote?.note || '',
            date: scheduledEventGroup.publicNote?.createdAt!,
            isBold: false,
        });

        timeline.sort((a: TimelineItem, b: TimelineItem) => {
            return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
        });

        return timeline;
    };

    const getIncidentGroupEventTimeline: Function = (
        incidentGroup: IncidentGroup
    ): Array<TimelineItem> => {
        const timeline: Array<TimelineItem> = [];

        timeline.push({
            text: incidentGroup.incidentState.name!,
            date: incidentGroup.incidentStateTimeline.createdAt!,
            isBold: true,
        });

        if (incidentGroup.publicNote) {
            timeline.push({
                text: incidentGroup.publicNote?.note || '',
                date: incidentGroup.publicNote?.createdAt!,
                isBold: false,
            });
        }

        timeline.sort((a: TimelineItem, b: TimelineItem) => {
            return OneUptimeDate.isAfter(a.date, b.date) === true ? 1 : -1;
        });

        return timeline;
    };

    // const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
    // const endDate: Date = OneUptimeDate.getCurrentDate();

    return (
        <Page>
            {isLoading ? <PageLoader isVisible={true} /> : <></>}
            {error ? <ErrorMessage error={error} /> : <></>}

            {!isLoading && !error ? (
                <div>
                    {/* Load Active Anouncement */}
                    {activeAnnouncements.map(
                        (announcement: StatusPageAnnouncement, i: number) => {
                            return (
                                <ActiveEvent
                                    key={i}
                                    cardTitle={'Announcement'}
                                    cardTitleRight={''}
                                    cardColor={Blue}
                                    eventTitle={announcement.title || ''}
                                    eventDescription={
                                        announcement.description || ''
                                    }
                                    footerEventStatus={'Announced'}
                                    footerDateTime={
                                        announcement.showAnnouncementAt!
                                    }
                                    eventTimeline={[]}
                                    eventType={'Anouncement'}
                                />
                            );
                        }
                    )}

                    {/* Load Active Incident */}

                    {getActiveIncidents().map(
                        (incidentGroup: IncidentGroup, i: number) => {
                            return (
                                <ActiveEvent
                                    key={i}
                                    cardTitle={'Active Incident'}
                                    cardTitleRight={
                                        incidentGroup.incidentSeverity.name ||
                                        ''
                                    }
                                    cardColor={
                                        incidentGroup.incidentSeverity.color ||
                                        Red
                                    }
                                    eventTitle={
                                        incidentGroup.incident.title || ''
                                    }
                                    eventDescription={
                                        incidentGroup.incident.description || ''
                                    }
                                    eventTimeline={getIncidentGroupEventTimeline(
                                        incidentGroup
                                    )}
                                    eventType={'Incident'}
                                    eventViewRoute={RouteUtil.populateRouteParams(
                                        props.isPreviewPage ? RouteMap[
                                            PageMap.PREVIEW_INCIDENT_DETAIL
                                        ] as Route :  RouteMap[
                                            PageMap.INCIDENT_DETAIL
                                        ] as Route,
                                        incidentGroup.incident.id!
                                    )}
                                />
                            );
                        }
                    )}

                    {/* Load Active ScheduledEvent */}

                    {getOngoingScheduledEvents().map(
                        (
                            scheduledEventGroup: ScheduledMaintenanceGroup,
                            i: number
                        ) => {
                            return (
                                <ActiveEvent
                                    key={i}
                                    cardTitle={'Scheduled Maintenance'}
                                    cardTitleRight={'Ongoing Event'}
                                    footerEventStatus={'Ends'}
                                    cardColor={Yellow}
                                    eventTitle={
                                        scheduledEventGroup.scheduledMaintenance
                                            .title || ''
                                    }
                                    eventDescription={
                                        scheduledEventGroup.scheduledMaintenance
                                            .description || ''
                                    }
                                    eventTimeline={getScheduledEventGroupEventTimeline(
                                        scheduledEventGroup
                                    )}
                                    footerDateTime={
                                        scheduledEventGroup.scheduledMaintenance
                                            .endsAt!
                                    }
                                    eventType={'Scheduled Maintenance'}
                                    eventViewRoute={RouteUtil.populateRouteParams(
                                        props.isPreviewPage ? RouteMap[
                                            PageMap.PREVIEW_SCHEDULED_EVENT_DETAIL
                                        ] as Route :  RouteMap[
                                            PageMap.SCHEDULED_EVENT_DETAIL
                                        ] as Route,
                                        scheduledEventGroup.scheduledMaintenance
                                            .id!
                                    )}
                                />
                            );
                        }
                    )}

                    <div>
                        {currentStatus && (
                            <Alert
                                title={`${
                                    currentStatus.isOperationalState
                                        ? `All`
                                        : 'Some'
                                } Resources are ${currentStatus.name}`}
                                color={currentStatus.color}
                                doNotShowIcon={true}
                                size={AlertSize.Large}
                            />
                        )}
                    </div>

                    <div>
                        <AccordianGroup>
                            {statusPageResources.filter(
                                (resources: StatusPageResource) => {
                                    return !resources.statusPageGroupId;
                                }
                            ).length > 0 ? (
                                <Accordian
                                    key={Math.random()}
                                    title={undefined}
                                    isLastElement={resourceGroups.length === 0}
                                >
                                    {getMonitorOverviewListInGroup(null)}
                                </Accordian>
                            ) : (
                                <></>
                            )}
                            <div
                                key={Math.random()}
                                style={{
                                    padding: '0px',
                                }}
                            >
                                {resourceGroups.length > 0 &&
                                    resourceGroups.map(
                                        (
                                            resourceGroup: StatusPageGroup,
                                            i: number
                                        ) => {
                                            return (
                                                <Accordian
                                                    key={i}
                                                    rightElement={getRightAccordianElement(
                                                        resourceGroup
                                                    )}
                                                    isInitiallyExpanded={
                                                        resourceGroup.isExpandedByDefault
                                                    }
                                                    isLastElement={
                                                        resourceGroups.length -
                                                            1 ===
                                                        i
                                                    }
                                                    title={resourceGroup.name!}
                                                >
                                                    {getMonitorOverviewListInGroup(
                                                        resourceGroup
                                                    )}
                                                </Accordian>
                                            );
                                        }
                                    )}
                            </div>
                        </AccordianGroup>
                    </div>
                </div>
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
