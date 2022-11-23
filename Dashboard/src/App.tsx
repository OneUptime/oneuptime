import React, { FunctionComponent, useState } from 'react';
import Route from 'Common/Types/API/Route';
import {
    Routes,
    Route as PageRoute,
    useNavigate,
    useLocation,
    useParams,
} from 'react-router-dom';
import MasterPage from './Components/MasterPage/MasterPage';
// Pages
import Init from './Pages/Init/Init';

import Home from './Pages/Home/Home';
import NotOperationalMonitors from './Pages/Home/NotOperationalMonitors';
import OngoingScheduledEvents from './Pages/Home/OngingScheduledMaintenance';

import useAsyncEffect from 'use-async-effect';

import StatusPages from './Pages/StatusPages/StatusPages';
import StatusPagesView from './Pages/StatusPages/View/Index';
import StatusPagesViewDelete from './Pages/StatusPages/View/Delete';
import StatusPagesViewBranding from './Pages/StatusPages/View/Branding';
import StatusPagesViewEmailSubscribers from './Pages/StatusPages/View/EmailSubscribers';
import StatusPagesViewSMSSubscribers from './Pages/StatusPages/View/SMSSubscribers';
import StatusPagesViewWebhookSubscribers from './Pages/StatusPages/View/WebhookSubscribers';
import StatusPagesViewEmbedded from './Pages/StatusPages/View/Embedded';
import StatusPagesViewDomains from './Pages/StatusPages/View/Domains';
import StatusPagesViewResources from './Pages/StatusPages/View/Resources';
import StatusPagesViewAnnouncement from './Pages/StatusPages/View/Announcements';
import StatusPagesViewAdvancedOptions from './Pages/StatusPages/View/AdvancedOptions';
import StatusPagesViewCustomHtmlCss from './Pages/StatusPages/View/CustomHtmlCss';
import StatusPagesViewHeaderStyle from './Pages/StatusPages/View/HeaderStyle';
import StatusPagesViewFooterStyle from './Pages/StatusPages/View/FooterStyle';
import StatusPagesViewNavBarStyle from './Pages/StatusPages/View/NavBarStyle';
import StatusPagesViewGroups from './Pages/StatusPages/View/Groups';
import StatusPageViewSubscriberSettings from './Pages/StatusPages/View/SubscriberSettings';

import StatusPageViewPrivateUser from './Pages/StatusPages/View/PrivateUser';

import Incidents from './Pages/Incidents/Incidents';
import IncidentView from './Pages/Incidents/View/Index';
import IncidentViewDelete from './Pages/Incidents/View/Delete';
import IncidentViewStateTimeline from './Pages/Incidents/View/StateTimeline';
import IncidentInternalNote from './Pages/Incidents/View/InternalNote';
import IncidentPublicNote from './Pages/Incidents/View/PublicNote';
import UnresolvedIncidents from './Pages/Incidents/Unresolved';

import ScheduledMaintenanceEvents from './Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents';
import ScheduledMaintenanceEventView from './Pages/ScheduledMaintenanceEvents/View/Index';
import ScheduledMaintenanceEventViewDelete from './Pages/ScheduledMaintenanceEvents/View/Delete';
import ScheduledMaintenanceEventViewStateTimeline from './Pages/ScheduledMaintenanceEvents/View/StateTimeline';
import ScheduledMaintenanceEventInternalNote from './Pages/ScheduledMaintenanceEvents/View/InternalNote';
import ScheduledMaintenanceEventPublicNote from './Pages/ScheduledMaintenanceEvents/View/PublicNote';
import OngoingScheduledMaintenanceEvents from './Pages/ScheduledMaintenanceEvents/Ongoing';

import Logs from './Pages/Logs/Logs';
import Navigation from 'CommonUI/src/Utils/Navigation';
import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';
import { ACCOUNTS_URL } from 'CommonUI/src/Config';
// Settings Pages
import ProjectSettings from './Pages/Settings/ProjectSettings';
import SettingsDangerZone from './Pages/Settings/DangerZone';
import SettingsApiKeys from './Pages/Settings/APIKeys';
import SettingsApiKeyView from './Pages/Settings/APIKeyView';
import SettingLabels from './Pages/Settings/Labels';
import SettingCustomSMTP from './Pages/Settings/CustomSMTP';
import SettingsTeams from './Pages/Settings/Teams';
import SettingsTeamView from './Pages/Settings/TeamView';
import SettingsMonitors from './Pages/Settings/MonitorStatus';
import SettingsIncidents from './Pages/Settings/IncidentState';
import SettingsScheduledMaintenanceState from './Pages/Settings/ScheduledMaintenanceState';
import SettingsDomains from './Pages/Settings/Domains';
import SettingsIncidentSeverity from './Pages/Settings/IncidentSeverity';
import SettingsBilling from './Pages/Settings/Billing';
import SettingsInvoices from './Pages/Settings/Invoices';

// On Call Duty
import OnCallDutyPage from './Pages/OnCallDuty/OnCallDuties';

// Monitors
import MonitorPage from './Pages/Monitor/Monitors';
import MonitorView from './Pages/Monitor/View/Index';
import MonitorViewDelete from './Pages/Monitor/View/Delete';
import MonitorViewStatusTimeline from './Pages/Monitor/View/StatusTimeline';
import MonitorIncidents from './Pages/Monitor/View/Incidents';
import MonitorInoperational from './Pages/Monitor/NotOperationalMonitors';

// Import CSS
import 'CommonUI/src/Styles/theme.scss';
import User from 'CommonUI/src/Utils/User';
import Logout from './Pages/Logout/Logout';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import Project from 'Model/Models/Project';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import PageNotFound from './Pages/PageNotFound/PageNotFound';
import Welcome from './Pages/Onboarding/Welcome';

const App: FunctionComponent = () => {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());

    if (!User.isLoggedIn()) {
        Navigation.navigate(ACCOUNTS_URL);
    }

    const [isLoading, setLoading] = useState<boolean>(true);
    const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
    const [error, setError] = useState<string>('');
    const [projects, setProjects] = useState<Array<Project>>([]);

    const [selectedProject, setSelectedProject] = useState<Project | null>(
        null
    );

    const onProjectSelected: (project: Project) => void = (
        project: Project
    ): void => {
        setSelectedProject(project);

        if (
            projects.filter((i: Project) => {
                return i && i._id === project._id;
            }).length === 0
        ) {
            setProjects([...projects, project]);
        }

        const currentRoute: Route = Navigation.getCurrentRoute();

        if (!currentRoute.toString().includes(project._id!)) {
            Navigation.navigate(new Route('/dashboard/' + project._id));
        }
    };

    const fetchProjects: Function = async (): Promise<void> => {
        setLoading(true);

        // get list of projects.
        try {
            const result: ListResult<Project> = await ModelAPI.getList<Project>(
                Project,
                {},
                50,
                0,
                {
                    name: true,
                    _id: true,
                    trialEndsAt: true,
                    paymentProviderPlanId: true
                },
                {},
                {},
                {
                    isMultiTenantRequest: true,
                }
            );
            setProjects(result.data);
        } catch (err) {
            setError(
                (err as HTTPErrorResponse).message ||
                'Server Error. Please try again'
            );
        }

        setLoading(false);
    };

    useAsyncEffect(async () => {
        fetchProjects();
    }, []);

    return (
        <MasterPage
            isLoading={isLoading}
            projects={projects}
            error={error}
            onProjectSelected={onProjectSelected}
            onProjectRequestAccepted={() => {
                fetchProjects();
            }}
            onProjectRequestRejected={() => {
                fetchProjects();
            }}
            showProjectModal={showProjectModal}
            onProjectModalClose={() => {
                setShowProjectModal(false);
            }}
            selectedProject={selectedProject}
        >
            <Routes>
                <PageRoute
                    path={RouteMap[PageMap.INIT]?.toString()}
                    element={
                        <Init
                            pageRoute={RouteMap[PageMap.INIT] as Route}
                            currentProject={selectedProject}
                            projects={projects}
                            isLoadingProjects={isLoading}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INIT_PROJECT]?.toString()}
                    element={
                        <Init
                            pageRoute={RouteMap[PageMap.INIT_PROJECT] as Route}
                            currentProject={selectedProject}
                            projects={projects}
                            isLoadingProjects={isLoading}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.WELCOME]?.toString()}
                    element={
                        <Welcome
                            pageRoute={RouteMap[PageMap.WELCOME] as Route}
                            currentProject={selectedProject}
                            onClickShowProjectModal={() => {
                                setShowProjectModal(true);
                            }}
                        />
                    }
                />

                {/* Home */}

                <PageRoute
                    path={RouteMap[PageMap.HOME]?.toString()}
                    element={
                        <Home
                            pageRoute={RouteMap[PageMap.HOME] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.HOME_NOT_OPERATIONAL_MONITORS
                    ]?.toString()}
                    element={
                        <NotOperationalMonitors
                            pageRoute={
                                RouteMap[
                                PageMap.HOME_NOT_OPERATIONAL_MONITORS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                    ]?.toString()}
                    element={
                        <OngoingScheduledEvents
                            pageRoute={
                                RouteMap[
                                PageMap
                                    .HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* Monitors */}
                <PageRoute
                    path={RouteMap[PageMap.MONITORS]?.toString()}
                    element={
                        <MonitorPage
                            pageRoute={RouteMap[PageMap.MONITORS] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.MONITORS_INOPERATIONAL]?.toString()}
                    element={
                        <MonitorInoperational
                            pageRoute={
                                RouteMap[
                                PageMap.MONITORS_INOPERATIONAL
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.MONITOR_VIEW]?.toString()}
                    element={
                        <MonitorView
                            pageRoute={RouteMap[PageMap.MONITOR_VIEW] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.MONITOR_VIEW_DELETE]?.toString()}
                    element={
                        <MonitorViewDelete
                            pageRoute={
                                RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.MONITOR_VIEW_STATUS_TIMELINE
                    ]?.toString()}
                    element={
                        <MonitorViewStatusTimeline
                            pageRoute={
                                RouteMap[
                                PageMap.MONITOR_VIEW_STATUS_TIMELINE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.MONITOR_VIEW_INCIDENTS]?.toString()}
                    element={
                        <MonitorIncidents
                            pageRoute={
                                RouteMap[
                                PageMap.MONITOR_VIEW_INCIDENTS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* Status Pages */}

                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGES]?.toString()}
                    element={
                        <StatusPages
                            pageRoute={RouteMap[PageMap.STATUS_PAGES] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS
                    ]?.toString()}
                    element={
                        <StatusPageViewSubscriberSettings
                            pageRoute={RouteMap[PageMap.STATUS_PAGES] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGE_VIEW]?.toString()}
                    element={
                        <StatusPagesView
                            pageRoute={
                                RouteMap[PageMap.STATUS_PAGE_VIEW] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE]?.toString()}
                    element={
                        <StatusPagesViewDelete
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_DELETE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_BRANDING
                    ]?.toString()}
                    element={
                        <StatusPagesViewBranding
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_BRANDING
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS
                    ]?.toString()}
                    element={
                        <StatusPagesViewCustomHtmlCss
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS
                    ]?.toString()}
                    element={
                        <StatusPagesViewAdvancedOptions
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS
                    ]?.toString()}
                    element={
                        <StatusPagesViewEmailSubscribers
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS
                    ]?.toString()}
                    element={
                        <StatusPageViewPrivateUser
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS
                    ]?.toString()}
                    element={
                        <StatusPagesViewSMSSubscribers
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_HEADER_STYLE
                    ]?.toString()}
                    element={
                        <StatusPagesViewHeaderStyle
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_HEADER_STYLE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE
                    ]?.toString()}
                    element={
                        <StatusPagesViewFooterStyle
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE
                    ]?.toString()}
                    element={
                        <StatusPagesViewNavBarStyle
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                    ]?.toString()}
                    element={
                        <StatusPagesViewWebhookSubscribers
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_EMBEDDED
                    ]?.toString()}
                    element={
                        <StatusPagesViewEmbedded
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_EMBEDDED
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_RESOURCES
                    ]?.toString()}
                    element={
                        <StatusPagesViewResources
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_RESOURCES
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_DOMAINS
                    ]?.toString()}
                    element={
                        <StatusPagesViewDomains
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_DOMAINS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGE_VIEW_GROUPS]?.toString()}
                    element={
                        <StatusPagesViewGroups
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_GROUPS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                    ]?.toString()}
                    element={
                        <StatusPagesViewAnnouncement
                            pageRoute={
                                RouteMap[
                                PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* Incidents */}

                <PageRoute
                    path={RouteMap[PageMap.INCIDENTS]?.toString()}
                    element={
                        <Incidents
                            pageRoute={RouteMap[PageMap.INCIDENTS] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.UNRESOLVED_INCIDENTS]?.toString()}
                    element={
                        <UnresolvedIncidents
                            pageRoute={
                                RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_VIEW]?.toString()}
                    element={
                        <IncidentView
                            pageRoute={RouteMap[PageMap.INCIDENT_VIEW] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_VIEW_DELETE]?.toString()}
                    element={
                        <IncidentViewDelete
                            pageRoute={
                                RouteMap[PageMap.INCIDENT_VIEW_DELETE] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.INCIDENT_VIEW_STATE_TIMELINE
                    ]?.toString()}
                    element={
                        <IncidentViewStateTimeline
                            pageRoute={
                                RouteMap[
                                PageMap.INCIDENT_VIEW_STATE_TIMELINE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_INTERNAL_NOTE]?.toString()}
                    element={
                        <IncidentInternalNote
                            pageRoute={
                                RouteMap[
                                PageMap.INCIDENT_INTERNAL_NOTE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_PUBLIC_NOTE]?.toString()}
                    element={
                        <IncidentPublicNote
                            pageRoute={
                                RouteMap[PageMap.INCIDENT_PUBLIC_NOTE] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* Scheduled Events */}

                <PageRoute
                    path={RouteMap[
                        PageMap.SCHEDULED_MAINTENANCE_EVENTS
                    ]?.toString()}
                    element={
                        <ScheduledMaintenanceEvents
                            pageRoute={
                                RouteMap[
                                PageMap.SCHEDULED_MAINTENANCE_EVENTS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                    ]?.toString()}
                    element={
                        <OngoingScheduledMaintenanceEvents
                            pageRoute={
                                RouteMap[
                                PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SCHEDULED_MAINTENANCE_VIEW
                    ]?.toString()}
                    element={
                        <ScheduledMaintenanceEventView
                            pageRoute={
                                RouteMap[
                                PageMap.SCHEDULED_MAINTENANCE_VIEW
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE
                    ]?.toString()}
                    element={
                        <ScheduledMaintenanceEventViewDelete
                            pageRoute={
                                RouteMap[
                                PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
                    ]?.toString()}
                    element={
                        <ScheduledMaintenanceEventViewStateTimeline
                            pageRoute={
                                RouteMap[
                                PageMap
                                    .SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE
                    ]?.toString()}
                    element={
                        <ScheduledMaintenanceEventInternalNote
                            pageRoute={
                                RouteMap[
                                PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
                    ]?.toString()}
                    element={
                        <ScheduledMaintenanceEventPublicNote
                            pageRoute={
                                RouteMap[
                                PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* Logs */}

                <PageRoute
                    path={RouteMap[PageMap.LOGS]?.toString()}
                    element={
                        <Logs
                            pageRoute={RouteMap[PageMap.LOGS] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* Settings Routes */}

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS]?.toString()}
                    element={
                        <ProjectSettings
                            pageRoute={RouteMap[PageMap.SETTINGS] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_DANGERZONE]?.toString()}
                    element={
                        <SettingsDangerZone
                            onProjectDeleted={() => {
                                setSelectedProject(null);
                                setProjects([]);
                                fetchProjects();
                                Navigation.navigate(RouteMap[PageMap.INIT]!);
                            }}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_DANGERZONE] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SETTINGS_MONITORS_STATUS
                    ]?.toString()}
                    element={
                        <SettingsMonitors
                            pageRoute={
                                RouteMap[
                                PageMap.SETTINGS_MONITORS_STATUS
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SETTINGS_INCIDENTS_STATE
                    ]?.toString()}
                    element={
                        <SettingsIncidents
                            pageRoute={
                                RouteMap[
                                PageMap.SETTINGS_INCIDENTS_STATE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
                    ]?.toString()}
                    element={
                        <SettingsScheduledMaintenanceState
                            pageRoute={
                                RouteMap[
                                PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SETTINGS_INCIDENTS_SEVERITY
                    ]?.toString()}
                    element={
                        <SettingsIncidentSeverity
                            pageRoute={
                                RouteMap[
                                PageMap.SETTINGS_INCIDENTS_SEVERITY
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_DOMAINS]?.toString()}
                    element={
                        <SettingsDomains
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_DOMAINS] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_CUSTOM_SMTP]?.toString()}
                    element={
                        <SettingCustomSMTP
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_CUSTOM_SMTP] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_APIKEYS]?.toString()}
                    element={
                        <SettingsApiKeys
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_APIKEY_VIEW]?.toString()}
                    element={
                        <SettingsApiKeyView
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_BILLING]?.toString()}
                    element={
                        <SettingsBilling
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_BILLING] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[
                        PageMap.SETTINGS_BILLING_INVOICES
                    ]?.toString()}
                    element={
                        <SettingsInvoices
                            pageRoute={
                                RouteMap[
                                PageMap.SETTINGS_BILLING_INVOICES
                                ] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_LABELS]?.toString()}
                    element={
                        <SettingLabels
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_LABELS] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_TEAMS]?.toString()}
                    element={
                        <SettingsTeams
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_TEAMS] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_TEAM_VIEW]?.toString()}
                    element={
                        <SettingsTeamView
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* On Call Duty */}

                <PageRoute
                    path={RouteMap[PageMap.ON_CALL_DUTY]?.toString()}
                    element={
                        <OnCallDutyPage
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route
                            }
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* Misc Routes */}
                <PageRoute
                    path={RouteMap[PageMap.LOGOUT]?.toString()}
                    element={
                        <Logout
                            pageRoute={RouteMap[PageMap.LOGOUT] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />

                {/* 👇️ only match this when no other routes match */}
                <PageRoute
                    path="*"
                    element={
                        <PageNotFound
                            pageRoute={RouteMap[PageMap.LOGOUT] as Route}
                            currentProject={selectedProject}
                        />
                    }
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
