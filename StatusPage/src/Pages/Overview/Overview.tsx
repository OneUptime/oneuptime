import React, {
    FunctionComponent,
    ReactElement,
    useEffect,
    useState,
} from 'react';
import BaseModel from 'Common/Models/BaseModel';
import PageComponentProps from '../PageComponentProps';
import Page from '../../Components/Page/Page';
import Accordion from 'CommonUI/src/Components/Accordion/Accordion';
import AccordionGroup from 'CommonUI/src/Components/Accordion/AccordionGroup';
import Alert from 'CommonUI/src/Components/Alerts/Alert';
import URL from 'Common/Types/API/URL';
import PageLoader from 'CommonUI/src/Components/Loader/PageLoader';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import ErrorMessage from 'CommonUI/src/Components/ErrorMessage/ErrorMessage';
import BadDataException from 'Common/Types/Exception/BadDataException';
import LocalStorage from 'CommonUI/src/Utils/LocalStorage';
import ObjectID from 'Common/Types/ObjectID';
import StatusPageGroup from 'Model/Models/StatusPageGroup';
import StatusPageResource, {
    UptimePrecision,
} from 'Model/Models/StatusPageResource';
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
import Dictionary from 'Common/Types/Dictionary';
import IncidentGroup from '../../Types/IncidentGroup';
import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import Route from 'Common/Types/API/Route';
import ScheduledMaintenanceGroup from '../../Types/ScheduledMaintenanceGroup';
import EventItem from 'CommonUI/src/Components/EventItem/EventItem';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import Navigation from 'CommonUI/src/Utils/Navigation';
import { getIncidentEventItem } from '../Incidents/Detail';
import { getScheduledEventEventItem } from '../ScheduledEvent/Detail';
import { getAnnouncementEventItem } from '../Announcement/Detail';
import EmptyState from 'CommonUI/src/Components/EmptyState/EmptyState';
import IconProp from 'Common/Types/Icon/IconProp';
import API from '../../Utils/API';
import StatusPage from 'Model/Models/StatusPage';
import MarkdownViewer from 'CommonUI/src/Components/Markdown.tsx/LazyMarkdownViewer';
import StatusPageUtil from '../../Utils/StatusPage';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import { STATUS_PAGE_API_URL } from '../../Utils/Config';
import Section from '../../Components/Section/Section';
import StatusPageHistoryChartBarColorRule from 'Model/Models/StatusPageHistoryChartBarColorRule';
import { PromiseVoidFunctionType } from 'Common/Types/FunctionTypes';

const Overview: FunctionComponent<PageComponentProps> = (
    props: PageComponentProps
): ReactElement => {
    if (LocalStorage.getItem('redirectUrl')) {
        // const get item

        const redirectUrl: string = LocalStorage.getItem(
            'redirectUrl'
        ) as string;

        // clear local storage.
        LocalStorage.removeItem('redirectUrl');

        Navigation.navigate(new Route(redirectUrl));
    }

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [
        scheduledMaintenanceEventsPublicNotes,
        setScheduledMaintenanceEventsPublicNotes,
    ] = useState<Array<ScheduledMaintenancePublicNote>>([]);
    const [statusPage, setStatusPage] = useState<StatusPage | null>(null);
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

    const [
        statusPageHistoryChartBarColorRules,
        setStatusPageHistoryChartBarColorRules,
    ] = useState<Array<StatusPageHistoryChartBarColorRule>>([]);

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

    const [monitorsInGroup, setMonitorsInGroup] = useState<
        Dictionary<Array<ObjectID>>
    >({});

    const [monitorGroupCurrentStatuses, setMonitorGroupCurrentStatuses] =
        useState<Dictionary<ObjectID>>({});

    StatusPageUtil.checkIfUserHasLoggedIn();

    const loadPage: PromiseVoidFunctionType = async (): Promise<void> => {
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
                        `/overview/${id.toString()}`
                    ),
                    {},
                    API.getDefaultHeaders(StatusPageUtil.getStatusPageId()!)
                );

            if (!response.isSuccess()) {
                throw response;
            }

            if (!response.isSuccess()) {
                throw response;
            }

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
                    (data['scheduledMaintenanceEvents'] as JSONArray) || [],
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

            const statusPageHistoryChartBarColorRules: Array<StatusPageHistoryChartBarColorRule> =
                BaseModel.fromJSONArray(
                    (data[
                        'statusPageHistoryChartBarColorRules'
                    ] as JSONArray) || [],
                    StatusPageHistoryChartBarColorRule
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

            const statusPage: StatusPage = BaseModel.fromJSONObject(
                (data['statusPage'] as JSONObject) || [],
                StatusPage
            );

            const scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
                BaseModel.fromJSONArray(
                    (data['scheduledMaintenanceStateTimelines'] as JSONArray) ||
                    [],
                    ScheduledMaintenanceStateTimeline
                );

            const monitorsInGroup: Dictionary<Array<ObjectID>> =
                JSONFunctions.deserialize(
                    (data['monitorsInGroup'] as JSONObject) || {}
                ) as Dictionary<Array<ObjectID>>;

            const monitorGroupCurrentStatuses: Dictionary<ObjectID> =
                JSONFunctions.deserialize(
                    (data['monitorGroupCurrentStatuses'] as JSONObject) || {}
                ) as Dictionary<ObjectID>;

            setMonitorsInGroup(monitorsInGroup);
            setMonitorGroupCurrentStatuses(monitorGroupCurrentStatuses);

            setStatusPageHistoryChartBarColorRules(
                statusPageHistoryChartBarColorRules
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
            setStatusPage(statusPage);
            setStatusPageResources(statusPageResources);
            setIncidentStateTimelines(incidentStateTimelines);
            setScheduledMaintenanceStateTimelines(
                scheduledMaintenanceStateTimelines
            );

            // Parse Data.
            setCurrentStatus(
                getOverallMonitorStatus(
                    statusPageResources,
                    monitorStatuses,
                    monitorGroupCurrentStatuses
                )
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
    };

    useEffect(() => {
        loadPage().catch((err: Error) => {
            setError(err.message);
        });
    }, []);

    useEffect(() => {
        loadPage().catch((err: Error) => {
            setError(err.message);
        });
    }, [
        StatusPageUtil.getStatusPageId()?.toString() || '',
        StatusPageUtil.isPreviewPage(),
        StatusPageUtil.isPrivateStatusPage(),
    ]);

    const getOverallMonitorStatus: Function = (
        statusPageResources: Array<StatusPageResource>,
        monitorStatuses: Array<MonitorStatus>,
        monitorGroupCurrentStatuses: Dictionary<ObjectID>
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

        // check status of monitor groups.

        for (const groupId in monitorGroupCurrentStatuses) {
            const statusId: ObjectID | undefined =
                monitorGroupCurrentStatuses[groupId];

            if (statusId) {
                if (!Object.keys(dict).includes(statusId.toString() || '')) {
                    dict[statusId.toString()] = 1;
                } else {
                    dict[statusId.toString()]++;
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

    type GetMonitorOverviewListInGroupFunctionType = (group: StatusPageGroup | null) => Array<ReactElement>;

    const getMonitorOverviewListInGroup: GetMonitorOverviewListInGroupFunctionType = (
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
                // if its not a monitor or a monitor group, then continue. This should ideally not happen.

                if (!resource.monitor && !resource.monitorGroupId) {
                    continue;
                }

                // if its a monitor

                if (resource.monitor) {
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
                                resource.monitor?.name ||
                                ''
                            }
                            statusPageHistoryChartBarColorRules={
                                statusPageHistoryChartBarColorRules
                            }
                            downtimeMonitorStatuses={
                                statusPage?.downtimeMonitorStatuses || []
                            }
                            description={resource.displayDescription || ''}
                            tooltip={resource.displayTooltip || ''}
                            currentStatus={currentStatus}
                            showUptimePercent={Boolean(
                                resource.showUptimePercent
                            )}
                            uptimePrecision={
                                resource.uptimePercentPrecision ||
                                UptimePrecision.ONE_DECIMAL
                            }
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
                            uptimeGraphHeight={10}
                            defaultBarColor={
                                statusPage?.defaultBarColor || Green
                            }
                        />
                    );
                }

                // if its a monitor group, then...

                if (resource.monitorGroupId) {
                    let currentStatus: MonitorStatus | undefined =
                        monitorStatuses.find((status: MonitorStatus) => {
                            return (
                                status._id?.toString() ===
                                monitorGroupCurrentStatuses[
                                    resource.monitorGroupId?.toString() || ''
                                ]?.toString()
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
                                resource.monitor?.name ||
                                ''
                            }
                            showUptimePercent={Boolean(
                                resource.showUptimePercent
                            )}
                            uptimePrecision={
                                resource.uptimePercentPrecision ||
                                UptimePrecision.ONE_DECIMAL
                            }
                            statusPageHistoryChartBarColorRules={
                                statusPageHistoryChartBarColorRules
                            }
                            description={resource.displayDescription || ''}
                            tooltip={resource.displayTooltip || ''}
                            currentStatus={currentStatus}
                            monitorStatusTimeline={[
                                ...monitorStatusTimelines,
                            ].filter((timeline: MonitorStatusTimeline) => {
                                const monitorsInThisGroup:
                                    | Array<ObjectID>
                                    | undefined =
                                    monitorsInGroup[
                                    resource.monitorGroupId?.toString() ||
                                    ''
                                    ];

                                if (!monitorsInThisGroup) {
                                    return false;
                                }

                                return monitorsInThisGroup.find(
                                    (monitorId: ObjectID) => {
                                        return (
                                            monitorId.toString() ===
                                            timeline.monitorId?.toString()
                                        );
                                    }
                                );
                            })}
                            downtimeMonitorStatuses={
                                statusPage?.downtimeMonitorStatuses || []
                            }
                            startDate={startDate}
                            endDate={endDate}
                            showHistoryChart={resource.showStatusHistoryChart}
                            showCurrentStatus={resource.showCurrentStatus}
                            uptimeGraphHeight={10}
                            defaultBarColor={
                                statusPage?.defaultBarColor || Green
                            }
                        />
                    );
                }
            }
        }

        if (elements.length === 0) {
            elements.push(
                <div key={1} className="mb-20">
                    <ErrorMessage error="No resources added to this group." />
                </div>
            );
        }

        return elements;
    };

    type GetActiveIncidentsFunctionType = () => Array<IncidentGroup>;

    const getActiveIncidents: GetActiveIncidentsFunctionType = (): Array<IncidentGroup> => {
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
                incidentResources: statusPageResources,
                publicNotes: incidentPublicNotes.filter(
                    (publicNote: IncidentPublicNote) => {
                        return (
                            publicNote.incidentId?.toString() ===
                            activeIncident._id
                        );
                    }
                ),
                incidentSeverity: activeIncident.incidentSeverity!,
                incidentStateTimelines: [timeline],
                monitorsInGroup: monitorsInGroup,
            };

            groups.push(group);
        }

        return groups;
    };

    type GetOngoingScheduledEventsFunctionType = () => Array<ScheduledMaintenanceGroup>;

    const getOngoingScheduledEvents: GetOngoingScheduledEventsFunctionType =
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
                    scheduledEventResources: statusPageResources,
                    publicNotes: scheduledMaintenanceEventsPublicNotes.filter(
                        (publicNote: ScheduledMaintenancePublicNote) => {
                            return (
                                publicNote.scheduledMaintenanceId?.toString() ===
                                activeEvent._id
                            );
                        }
                    ),
                    scheduledMaintenanceStateTimelines: [timeline],
                    monitorsInGroup: monitorsInGroup,
                };

                groups.push(group);
            }

            return groups;
        };

    type GetRightAccordionElementFunctionType = (group: StatusPageGroup) => ReactElement;

    const getRightAccordionElement: GetRightAccordionElementFunctionType = (
        group: StatusPageGroup
    ): ReactElement => {
        let currentStatus: MonitorStatus = new MonitorStatus();
        currentStatus.name = 'Operational';
        currentStatus.color = Green;
        let hasResource: boolean = false;

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
                hasResource = true;
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

        if (hasResource) {
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

    const activeIncidentsInIncidentGroup: Array<IncidentGroup> =
        getActiveIncidents();
    const activeScheduledMaintenanceEventsInScheduledMaintenanceGroup: Array<ScheduledMaintenanceGroup> =
        getOngoingScheduledEvents();

    return (
        <Page>
            {isLoading ? <PageLoader isVisible={true} /> : <></>}
            {error ? <ErrorMessage error={error} /> : <></>}

            {!isLoading && !error ? (
                <div>
                    {/* Overview Page Description */}
                    {statusPage && statusPage.overviewPageDescription && (
                        <div
                            id="status-page-description"
                            className="bg-white p-5 my-5 rounded-xl shadow"
                        >
                            <MarkdownViewer
                                text={statusPage.overviewPageDescription}
                            />
                        </div>
                    )}

                    {/* Load Active Announcement */}
                    <div id="announcements-list">
                        {activeAnnouncements.map(
                            (
                                announcement: StatusPageAnnouncement,
                                i: number
                            ) => {
                                return (
                                    <EventItem
                                        {...getAnnouncementEventItem({
                                            announcement,
                                            isPreviewPage: StatusPageUtil.isPreviewPage(),
                                            isSummary: true
                                        }
                                        )}
                                        isDetailItem={false}
                                        key={i}

                                    />
                                );
                            }
                        )}
                    </div>

                    <div>
                        {currentStatus && statusPageResources.length > 0 && (
                            <Alert
                                title={`${currentStatus.isOperationalState
                                        ? `All`
                                        : 'Some'
                                    } Resources are ${currentStatus.name?.toLowerCase() ===
                                        'maintenance'
                                        ? 'under'
                                        : ''
                                    } ${currentStatus.name}`}
                                color={currentStatus.color}
                                doNotShowIcon={true}
                                textClassName="text-white text-lg"
                                id="overview-alert"
                            />
                        )}
                    </div>

                    {statusPageResources.length > 0 && (
                        <div className="bg-white pl-5 pr-5 mt-5 rounded-xl shadow space-y-5 mb-6">
                            <AccordionGroup>
                                {statusPageResources.filter(
                                    (resources: StatusPageResource) => {
                                        return !resources.statusPageGroupId;
                                    }
                                ).length > 0 ? (
                                    <Accordion
                                        key={Math.random()}
                                        title={undefined}
                                        isLastElement={
                                            resourceGroups.length === 0
                                        }
                                    >
                                        {getMonitorOverviewListInGroup(null)}
                                    </Accordion>
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
                                                    <Accordion
                                                        key={i}
                                                        rightElement={getRightAccordionElement(
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
                                                        title={
                                                            resourceGroup.name!
                                                        }
                                                        description={
                                                            resourceGroup.description!
                                                        }
                                                    >
                                                        {getMonitorOverviewListInGroup(
                                                            resourceGroup
                                                        )}
                                                    </Accordion>
                                                );
                                            }
                                        )}
                                </div>
                            </AccordionGroup>
                        </div>
                    )}

                    {/* Load Active Incident */}
                    {activeIncidentsInIncidentGroup.length > 0 && (
                        <div id="incidents-list mt-2">
                            <Section title="Active Incidents" />
                            {activeIncidentsInIncidentGroup.map(
                                (incidentGroup: IncidentGroup, i: number) => {
                                    return (
                                        <EventItem
                                            {...getIncidentEventItem({
                                                incident:
                                                    incidentGroup.incident,
                                                incidentPublicNotes:
                                                    incidentGroup.publicNotes ||
                                                    [],
                                                incidentStateTimelines:
                                                    incidentGroup.incidentStateTimelines,
                                                statusPageResources:
                                                    incidentGroup.incidentResources,
                                                monitorsInGroup:
                                                    incidentGroup.monitorsInGroup,
                                                isPreviewPage:
                                                    StatusPageUtil.isPreviewPage(),
                                                isSummary: true,
                                            })}
                                            isDetailItem={false}
                                            key={i}
                                        />
                                    );
                                }
                            )}
                        </div>
                    )}

                    {/* Load Active ScheduledEvent */}
                    {activeScheduledMaintenanceEventsInScheduledMaintenanceGroup &&
                        activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.length >
                        0 && (
                            <div id="scheduled-events-list mt-2">
                                <Section title="Scheduled Maintenance Events" />
                                {activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.map(
                                    (
                                        scheduledEventGroup: ScheduledMaintenanceGroup,
                                        i: number
                                    ) => {
                                        return (
                                            <EventItem
                                                key={i}
                                                {...getScheduledEventEventItem({
                                                    scheduledMaintenance:
                                                        scheduledEventGroup.scheduledMaintenance,
                                                    scheduledMaintenanceEventsPublicNotes:
                                                        scheduledEventGroup.publicNotes ||
                                                        [],
                                                    scheduledMaintenanceStateTimelines:
                                                        scheduledEventGroup.scheduledMaintenanceStateTimelines,
                                                    statusPageResources:
                                                        scheduledEventGroup.scheduledEventResources,
                                                    monitorsInGroup:
                                                        scheduledEventGroup.monitorsInGroup,
                                                    isPreviewPage:
                                                        StatusPageUtil.isPreviewPage(),
                                                    isSummary: true,
                                                })}
                                                isDetailItem={false}
                                            />
                                        );
                                    }
                                )}
                            </div>
                        )}

                    {activeIncidentsInIncidentGroup.length === 0 &&
                        activeScheduledMaintenanceEventsInScheduledMaintenanceGroup.length ===
                        0 &&
                        statusPageResources.length === 0 &&
                        activeAnnouncements.length === 0 &&
                        !isLoading &&
                        !error && (
                            <EmptyState
                                id="overview-empty-state"
                                icon={IconProp.CheckCircle}
                                title={'Everything looks great'}
                                description="No resources added to this status page yet. Please add some resources from the dashboard."
                            />
                        )}
                </div>
            ) : (
                <></>
            )}
        </Page>
    );
};

export default Overview;
