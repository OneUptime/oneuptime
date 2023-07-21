import React, { FunctionComponent, useState, useEffect } from 'react';
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

import Workflows from './Pages/Workflow/Workflows';
import WorkflowsVariables from './Pages/Workflow/Variable';
import WorkflowsLogs from './Pages/Workflow/Logs';
import WorkflowLogs from './Pages/Workflow/View/Logs';
import WorkflowDelete from './Pages/Workflow/View/Delete';
import WorkflowBuilder from './Pages/Workflow/View/Builder';
import WorkflowOverview from './Pages/Workflow/View/Index';
import WorkflowVariables from './Pages/Workflow/View/Variable';

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
import StatusPageViewCustomFields from './Pages/StatusPages/View/CustomFields';
import StatusPageViewSSO from './Pages/StatusPages/View/SSO';
import StatusPageViewPrivateUser from './Pages/StatusPages/View/PrivateUser';
import StatusPageViewOwners from './Pages/StatusPages/View/Owners';
import StatusPageViewAuthenticationSettings from './Pages/StatusPages/View/AuthenticationSettings';
import StatusPageViewCustomSMTP from './Pages/StatusPages/View/CustomSMTP';
import StatusPageViewSettings from './Pages/StatusPages/View/StatusPageSettings';

import Incidents from './Pages/Incidents/Incidents';
import IncidentView from './Pages/Incidents/View/Index';
import IncidentViewDelete from './Pages/Incidents/View/Delete';
import IncidentViewStateTimeline from './Pages/Incidents/View/StateTimeline';
import IncidentInternalNote from './Pages/Incidents/View/InternalNote';
import IncidentPublicNote from './Pages/Incidents/View/PublicNote';
import UnresolvedIncidents from './Pages/Incidents/Unresolved';
import IncidentViewCustomFields from './Pages/Incidents/View/CustomFields';
import IncidentViewOwner from './Pages/Incidents/View/Owners';

import ScheduledMaintenanceEvents from './Pages/ScheduledMaintenanceEvents/ScheduledMaintenanceEvents';
import ScheduledMaintenanceEventView from './Pages/ScheduledMaintenanceEvents/View/Index';
import ScheduledMaintenanceEventViewDelete from './Pages/ScheduledMaintenanceEvents/View/Delete';
import ScheduledMaintenanceEventViewOwner from './Pages/ScheduledMaintenanceEvents/View/Owners';
import ScheduledMaintenanceEventViewStateTimeline from './Pages/ScheduledMaintenanceEvents/View/StateTimeline';
import ScheduledMaintenanceEventInternalNote from './Pages/ScheduledMaintenanceEvents/View/InternalNote';
import ScheduledMaintenanceEventPublicNote from './Pages/ScheduledMaintenanceEvents/View/PublicNote';
import OngoingScheduledMaintenanceEvents from './Pages/ScheduledMaintenanceEvents/Ongoing';
import ScheduledMaintenanceEventsViewCustomFields from './Pages/ScheduledMaintenanceEvents/View/CustomFields';

import Logs from './Pages/Logs/Logs';
import Navigation from 'CommonUI/src/Utils/Navigation';
import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';
import { ACCOUNTS_URL, BILLING_ENABLED } from 'CommonUI/src/Config';
// Settings Pages
import ProjectSettings from './Pages/Settings/ProjectSettings';
import SettingsDangerZone from './Pages/Settings/DangerZone';
import SettingsApiKeys from './Pages/Settings/APIKeys';
import SettingsApiKeyView from './Pages/Settings/APIKeyView';
import SettingLabels from './Pages/Settings/Labels';
import SettingProbes from './Pages/Settings/Probes';
import SettingCustomSMTP from './Pages/Settings/CustomSMTP';
import SettingsTeams from './Pages/Settings/Teams';
import SettingsTeamView from './Pages/Settings/TeamView';
import SettingsMonitors from './Pages/Settings/MonitorStatus';
import SettingsIncidents from './Pages/Settings/IncidentState';
import SettingsScheduledMaintenanceState from './Pages/Settings/ScheduledMaintenanceState';
import SettingsDomains from './Pages/Settings/Domains';
import SettingsIncidentSeverity from './Pages/Settings/IncidentSeverity';
import SettingsBilling from './Pages/Settings/Billing';
import SettingsSSO from './Pages/Settings/SSO';
import SettingsSmsLog from './Pages/Settings/SmsLog';
import SettingsCallLog from './Pages/Settings/CallLog';
import SettingsCallSms from './Pages/Settings/CallSms';
import SettingsInvoices from './Pages/Settings/Invoices';
import MonitorCustomFields from './Pages/Settings/MonitorCustomFields';
import StatusPageCustomFields from './Pages/Settings/StatusPageCustomFields';
import IncidentCustomFields from './Pages/Settings/IncidentCustomFields';
import OnCallDutyPolicyCustomFields from './Pages/Settings/OnCallDutyPolicyCustomFields';
import ScheduledMaintenanceCustomFields from './Pages/Settings/ScheduledMaintenanceCusomFields';

import ActiveIncidents from './Pages/Global/ActiveIncidents';
import ProjectInvitations from './Pages/Global/ProjectInvitations';

// User Profile
import UserProfileOverview from './Pages/Global/UserProfile/Index';
import UserProfilePicture from './Pages/Global/UserProfile/Picture';
import UserProfilePassword from './Pages/Global/UserProfile/Password';

// On Call Duty
import OnCallDutyPoliciesPage from './Pages/OnCallDuty/OnCallDutyPolicies';
import OnCallDutyExecutionLogs from './Pages/OnCallDuty/OnCallDutyExecutionLogs';
import OnCallDutyPolicyExecutionLogTimeline from './Pages/OnCallDuty/OnCallDutyExecutionLogView';
import OnCallDutyPolicyView from './Pages/OnCallDuty/OnCallDutyPolicy/Index';
import OnCallDutyPolicyViewDelete from './Pages/OnCallDuty/OnCallDutyPolicy/Delete';
import OnCallDutyPolicyViewLogs from './Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogs';
import OnCallDutyPolicyViewLogsView from './Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogView';
import OnCallDutyPolicyViewEscalation from './Pages/OnCallDuty/OnCallDutyPolicy/Escalation';
import OnCallDutyPolicyViewCustomFields from './Pages/OnCallDuty/OnCallDutyPolicy/CustomFields';

// Monitors
import MonitorPage from './Pages/Monitor/Monitors';
import MonitorView from './Pages/Monitor/View/Index';
import MonitorViewDelete from './Pages/Monitor/View/Delete';
import MonitorViewCriteria from './Pages/Monitor/View/Criteria';
import MonitorViewStatusTimeline from './Pages/Monitor/View/StatusTimeline';
import MonitorIncidents from './Pages/Monitor/View/Incidents';
import MonitorInoperational from './Pages/Monitor/NotOperationalMonitors';
import MonitorDisabled from './Pages/Monitor/DisabledMonitors';
import MonitorViewCustomFields from './Pages/Monitor/View/CustomFields';
import MonitorViewInterval from './Pages/Monitor/View/Interval';
import MonitorViewProbes from './Pages/Monitor/View/Probes';
import MonitorViewOwner from './Pages/Monitor/View/Owners';
import MonitorViewSettings from './Pages/Monitor/View/Settings';

import User from 'CommonUI/src/Utils/User';
import Logout from './Pages/Logout/Logout';
import ModelAPI, { ListResult } from 'CommonUI/src/Utils/ModelAPI/ModelAPI';
import Project from 'Model/Models/Project';
import PageNotFound from './Pages/PageNotFound/PageNotFound';
import Welcome from './Pages/Onboarding/Welcome';
import GlobalEvents from 'CommonUI/src/Utils/GlobalEvents';
import EventName from './Utils/EventName';

import Sso from './Pages/Onboarding/SSO';
import API from 'CommonUI/src/Utils/API/API';
import BillingPaymentMethod from 'Model/Models/BillingPaymentMethod';
import PageComponentProps from './Pages/PageComponentProps';

import UserSettingsNotificationMethods from './Pages/UserSettings/NotificationMethods';
import UserSettingsNotificationRules from './Pages/UserSettings/OnCallRules';
import UserSettingsNotificationLogs from './Pages/UserSettings/OnCallLogs';
import UserSettingsNotificationLogsTimeline from './Pages/UserSettings/OnCallLogsTimeline';
import UserSettingsNotiifcationSetting from './Pages/UserSettings/NotificationSettings';

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

    const [ispaymentMethodsCountLoading, setPaymentMethodsCountLoading] =
        useState<boolean>(false);
    const [paymentMethodsCount, setPaymentMethodsCount] = useState<
        number | undefined
    >(undefined);

    const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean>(false);

    useAsyncEffect(async () => {
        try {
            if (selectedProject && selectedProject._id && BILLING_ENABLED) {
                setPaymentMethodsCountLoading(true);
                const paymentMethodsCount: number = await ModelAPI.count(
                    BillingPaymentMethod,
                    { projectId: selectedProject._id }
                );

                setPaymentMethodsCount(paymentMethodsCount);

                if (paymentMethodsCount && paymentMethodsCount > 0) {
                    setHasPaymentMethod(true);
                } else {
                    setHasPaymentMethod(false);
                }
            }

            if (!BILLING_ENABLED) {
                setHasPaymentMethod(true);
            }

            setPaymentMethodsCountLoading(false);
        } catch (e) {
            setError(API.getFriendlyMessage(e));
            setPaymentMethodsCountLoading(false);
        }
    }, [selectedProject?._id]);

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

    useEffect(() => {
        GlobalEvents.addEventListener(
            EventName.PROJECT_INVITATIONS_REFRESH,
            fetchProjects
        );

        return () => {
            // on unmount.
            GlobalEvents.removeEventListener(
                EventName.PROJECT_INVITATIONS_REFRESH,
                fetchProjects
            );
        };
    }, []);

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
                    paymentProviderPlanId: true,
                },
                {},

                {
                    isMultiTenantRequest: true,
                }
            );
            setProjects(result.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setLoading(false);
    };

    useAsyncEffect(async () => {
        fetchProjects();
    }, []);

    const commonPageProps: PageComponentProps = {
        currentProject: selectedProject,
        hasPaymentMethod: hasPaymentMethod,
        pageRoute: Navigation.getCurrentRoute(), // this will be overwritten by different pages
    };

    return (
        <MasterPage
            isLoading={isLoading || ispaymentMethodsCountLoading}
            projects={projects}
            error={error}
            paymentMethodsCount={paymentMethodsCount}
            onProjectSelected={onProjectSelected}
            showProjectModal={showProjectModal}
            onProjectModalClose={() => {
                setShowProjectModal(false);
            }}
            selectedProject={selectedProject}
            hideNavBarOn={[RouteMap[PageMap.PROJECT_SSO]!]}
        >
            <Routes>
                <PageRoute
                    path={RouteMap[PageMap.INIT]?.toString() || ''}
                    element={
                        <Init
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.INIT] as Route}
                            projects={projects}
                            isLoadingProjects={isLoading}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INIT_PROJECT]?.toString() || ''}
                    element={
                        <Init
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.INIT_PROJECT] as Route}
                            projects={projects}
                            isLoadingProjects={isLoading}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.WELCOME]?.toString() || ''}
                    element={
                        <Welcome
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.WELCOME] as Route}
                            onClickShowProjectModal={() => {
                                setShowProjectModal(true);
                            }}
                        />
                    }
                />

                {/* Home */}

                <PageRoute
                    path={RouteMap[PageMap.HOME]?.toString() || ''}
                    element={
                        <Home
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.HOME] as Route}
                            projects={projects}
                            isLoadingProjects={isLoading}
                        />
                    }
                />
                <PageRoute
                    path={RouteMap[PageMap.PROJECT_SSO]?.toString() || ''}
                    element={
                        <Sso
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.PROJECT_SSO] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.HOME_NOT_OPERATIONAL_MONITORS
                        ]?.toString() || ''
                    }
                    element={
                        <NotOperationalMonitors
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.HOME_NOT_OPERATIONAL_MONITORS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                        ]?.toString() ||
                        '' ||
                        ''
                    }
                    element={
                        <OngoingScheduledEvents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                                ] as Route
                            }
                        />
                    }
                />

                {/* Monitors */}
                <PageRoute
                    path={RouteMap[PageMap.MONITORS]?.toString() || ''}
                    element={
                        <MonitorPage
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.MONITORS] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITORS_INOPERATIONAL]?.toString() ||
                        ''
                    }
                    element={
                        <MonitorInoperational
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITORS_INOPERATIONAL
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_VIEW_SETTINGS]?.toString() ||
                        ''
                    }
                    element={
                        <MonitorViewSettings
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_VIEW_SETTINGS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.MONITORS_DISABLED]?.toString() || ''}
                    element={
                        <MonitorDisabled
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITORS_DISABLED] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.MONITOR_VIEW]?.toString() || ''}
                    element={
                        <MonitorView
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.MONITOR_VIEW] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_VIEW_OWNERS]?.toString() || ''
                    }
                    element={
                        <MonitorViewOwner
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_VIEW_OWNERS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_VIEW_DELETE]?.toString() || ''
                    }
                    element={
                        <MonitorViewDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.MONITOR_VIEW_STATUS_TIMELINE
                        ]?.toString() || ''
                    }
                    element={
                        <MonitorViewStatusTimeline
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITOR_VIEW_STATUS_TIMELINE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_VIEW_CRITERIA]?.toString() ||
                        ''
                    }
                    element={
                        <MonitorViewCriteria
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_VIEW_INCIDENTS]?.toString() ||
                        ''
                    }
                    element={
                        <MonitorIncidents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITOR_VIEW_INCIDENTS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.MONITOR_VIEW_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <MonitorViewCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITOR_VIEW_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_VIEW_INTERVAL]?.toString() ||
                        ''
                    }
                    element={
                        <MonitorViewInterval
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_VIEW_INTERVAL] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_VIEW_PROBES]?.toString() || ''
                    }
                    element={
                        <MonitorViewProbes
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route
                            }
                        />
                    }
                />

                {/* Workflows  */}

                <PageRoute
                    path={RouteMap[PageMap.WORKFLOWS]?.toString() || ''}
                    element={
                        <Workflows
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.WORKFLOWS] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.WORKFLOWS_VARIABLES]?.toString() || ''
                    }
                    element={
                        <WorkflowsVariables
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.WORKFLOWS_LOGS]?.toString() || ''}
                    element={
                        <WorkflowsLogs
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.WORKFLOWS_LOGS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.WORKFLOW_VARIABLES]?.toString() || ''
                    }
                    element={
                        <WorkflowVariables
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.WORKFLOW_VARIABLES] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.WORKFLOW_BUILDER]?.toString() || ''}
                    element={
                        <WorkflowBuilder
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.WORKFLOW_BUILDER] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.WORKFLOW_VIEW]?.toString() || ''}
                    element={
                        <WorkflowOverview
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.WORKFLOW_VIEW] as Route}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.WORKFLOW_LOGS]?.toString() || ''}
                    element={
                        <WorkflowLogs
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.WORKFLOW_LOGS] as Route}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.WORKFLOW_DELETE]?.toString() || ''}
                    element={
                        <WorkflowDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.WORKFLOW_DELETE] as Route
                            }
                        />
                    }
                />

                {/* Status Pages */}

                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGES]?.toString() || ''}
                    element={
                        <StatusPages
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.STATUS_PAGES] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_SUBSCRIBER_SETTINGS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPageViewSubscriberSettings
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.STATUS_PAGES] as Route}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGE_VIEW]?.toString() || ''}
                    element={
                        <StatusPagesView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.STATUS_PAGE_VIEW] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.STATUS_PAGE_VIEW_DELETE]?.toString() ||
                        ''
                    }
                    element={
                        <StatusPagesViewDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_DELETE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_BRANDING
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewBranding
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_BRANDING
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewCustomHtmlCss
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_CUSTOM_HTML_CSS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewAdvancedOptions
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPageViewCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.STATUS_PAGE_VIEW_OWNERS]?.toString() ||
                        ''
                    }
                    element={
                        <StatusPageViewOwners
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_OWNERS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.STATUS_PAGE_VIEW_SSO]?.toString() || ''
                    }
                    element={
                        <StatusPageViewSSO
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.STATUS_PAGE_VIEW_SSO] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewEmailSubscribers
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_EMAIL_SUBSCRIBERS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPageViewAuthenticationSettings
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_CUSTOM_SMTP
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPageViewCustomSMTP
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_CUSTOM_SMTP
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_SETTINGS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPageViewSettings
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_SETTINGS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPageViewPrivateUser
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewSMSSubscribers
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_SMS_SUBSCRIBERS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_HEADER_STYLE
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewHeaderStyle
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_HEADER_STYLE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewFooterStyle
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_FOOTER_STYLE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewNavBarStyle
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_NAVBAR_STYLE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewWebhookSubscribers
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_WEBHOOK_SUBSCRIBERS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_EMBEDDED
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewEmbedded
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_EMBEDDED
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_RESOURCES
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewResources
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_RESOURCES
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_DOMAINS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewDomains
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_DOMAINS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.STATUS_PAGE_VIEW_GROUPS]?.toString() ||
                        ''
                    }
                    element={
                        <StatusPagesViewGroups
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_GROUPS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPagesViewAnnouncement
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.STATUS_PAGE_VIEW_ANNOUNCEMENTS
                                ] as Route
                            }
                        />
                    }
                />

                {/* Incidents */}

                <PageRoute
                    path={RouteMap[PageMap.INCIDENTS]?.toString() || ''}
                    element={
                        <Incidents
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.INCIDENTS] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.UNRESOLVED_INCIDENTS]?.toString() || ''
                    }
                    element={
                        <UnresolvedIncidents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.UNRESOLVED_INCIDENTS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.INCIDENT_VIEW]?.toString() || ''}
                    element={
                        <IncidentView
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.INCIDENT_VIEW] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.INCIDENT_VIEW_DELETE]?.toString() || ''
                    }
                    element={
                        <IncidentViewDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.INCIDENT_VIEW_DELETE] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.INCIDENT_VIEW_STATE_TIMELINE
                        ]?.toString() || ''
                    }
                    element={
                        <IncidentViewStateTimeline
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.INCIDENT_VIEW_STATE_TIMELINE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.INCIDENT_INTERNAL_NOTE]?.toString() ||
                        ''
                    }
                    element={
                        <IncidentInternalNote
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.INCIDENT_INTERNAL_NOTE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.INCIDENT_VIEW_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <IncidentViewCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.INCIDENT_VIEW_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyViewCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .ON_CALL_DUTY_POLICY_VIEW_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.INCIDENT_PUBLIC_NOTE]?.toString() || ''
                    }
                    element={
                        <IncidentPublicNote
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.INCIDENT_PUBLIC_NOTE] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.INCIDENT_VIEW_OWNERS]?.toString() || ''
                    }
                    element={
                        <IncidentViewOwner
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.INCIDENT_VIEW_OWNERS] as Route
                            }
                        />
                    }
                />

                {/* Scheduled Events */}

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_EVENTS
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEvents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SCHEDULED_MAINTENANCE_EVENTS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                        ]?.toString() || ''
                    }
                    element={
                        <OngoingScheduledMaintenanceEvents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SCHEDULED_MAINTENANCE_VIEW
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventsViewCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .SCHEDULED_MAINTENANCE_VIEW_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventViewDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SCHEDULED_MAINTENANCE_VIEW_DELETE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventViewOwner
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SCHEDULED_MAINTENANCE_VIEW_OWNERS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventViewStateTimeline
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .SCHEDULED_MAINTENANCE_VIEW_STATE_TIMELINE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventInternalNote
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SCHEDULED_MAINTENANCE_INTERNAL_NOTE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventPublicNote
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SCHEDULED_MAINTENANCE_PUBLIC_NOTE
                                ] as Route
                            }
                        />
                    }
                />

                {/* Logs */}

                <PageRoute
                    path={RouteMap[PageMap.LOGS]?.toString() || ''}
                    element={
                        <Logs
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.LOGS] as Route}
                        />
                    }
                />

                {/* Settings Routes */}

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS]?.toString() || ''}
                    element={
                        <ProjectSettings
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.SETTINGS] as Route}
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_SMS_LOGS]?.toString() || ''}
                    element={
                        <SettingsSmsLog
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_SMS_LOGS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_CALL_LOGS]?.toString() || ''
                    }
                    element={
                        <SettingsCallLog
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_CALL_LOGS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_CALL_SMS]?.toString() || ''}
                    element={
                        <SettingsCallSms
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_CALL_SMS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_DANGERZONE]?.toString() || ''
                    }
                    element={
                        <SettingsDangerZone
                            onProjectDeleted={() => {
                                setSelectedProject(null);
                                setProjects([]);
                                fetchProjects();
                                Navigation.navigate(RouteMap[PageMap.INIT]!);
                            }}
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_DANGERZONE] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_MONITORS_STATUS
                        ]?.toString() || ''
                    }
                    element={
                        <SettingsMonitors
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_MONITORS_STATUS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_INCIDENTS_STATE
                        ]?.toString() || ''
                    }
                    element={
                        <SettingsIncidents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_INCIDENTS_STATE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
                        ]?.toString() || ''
                    }
                    element={
                        <SettingsScheduledMaintenanceState
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_SCHEDULED_MAINTENANCE_STATE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_SSO]?.toString() || ''}
                    element={
                        <SettingsSSO
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.SETTINGS_SSO] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_INCIDENTS_SEVERITY
                        ]?.toString() || ''
                    }
                    element={
                        <SettingsIncidentSeverity
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_INCIDENTS_SEVERITY
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_DOMAINS]?.toString() || ''}
                    element={
                        <SettingsDomains
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_DOMAINS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_CUSTOM_SMTP]?.toString() || ''
                    }
                    element={
                        <SettingCustomSMTP
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_CUSTOM_SMTP] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_APIKEYS]?.toString() || ''}
                    element={
                        <SettingsApiKeys
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_APIKEYS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_APIKEY_VIEW]?.toString() || ''
                    }
                    element={
                        <SettingsApiKeyView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_APIKEY_VIEW] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <MonitorCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_MONITOR_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <StatusPageCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_STATUS_PAGE_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .SETTINGS_SCHEDULED_MAINTENANCE_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <IncidentCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_INCIDENT_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyCustomFields
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .SETTINGS_ON_CALL_DUTY_POLICY_CUSTOM_FIELDS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_BILLING]?.toString() || ''}
                    element={
                        <SettingsBilling
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_BILLING] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SETTINGS_BILLING_INVOICES
                        ]?.toString() || ''
                    }
                    element={
                        <SettingsInvoices
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.SETTINGS_BILLING_INVOICES
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_LABELS]?.toString() || ''}
                    element={
                        <SettingLabels
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_LABELS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_PROBES]?.toString() || ''}
                    element={
                        <SettingProbes
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_PROBES] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.SETTINGS_TEAMS]?.toString() || ''}
                    element={
                        <SettingsTeams
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_TEAMS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_TEAM_VIEW]?.toString() || ''
                    }
                    element={
                        <SettingsTeamView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_TEAM_VIEW] as Route
                            }
                        />
                    }
                />

                {/* On Call Duty */}

                <PageRoute
                    path={RouteMap[PageMap.ON_CALL_DUTY]?.toString() || ''}
                    element={
                        <OnCallDutyPoliciesPage
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.ON_CALL_DUTY] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_EXECUTION_LOGS
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyExecutionLogs
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_EXECUTION_LOGS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyExecutionLogTimeline
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_EXECUTION_LOGS_TIMELINE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.ON_CALL_DUTY_POLICIES]?.toString() ||
                        ''
                    }
                    element={
                        <OnCallDutyPoliciesPage
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.ON_CALL_DUTY_POLICIES] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_POLICY_VIEW
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyViewDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_POLICY_VIEW_DELETE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyViewEscalation
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyViewLogs
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOGS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyPolicyViewLogsView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .ON_CALL_DUTY_POLICY_VIEW_EXECUTION_LOG_VIEW
                                ] as Route
                            }
                        />
                    }
                />

                {/* Misc Routes */}
                <PageRoute
                    path={RouteMap[PageMap.LOGOUT]?.toString() || ''}
                    element={
                        <Logout
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.LOGOUT] as Route}
                        />
                    }
                />

                {/* Global Routes */}
                <PageRoute
                    path={
                        RouteMap[PageMap.USER_PROFILE_PICTURE]?.toString() || ''
                    }
                    element={
                        <UserProfilePicture
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.USER_PROFILE_PICTURE] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.USER_PROFILE_OVERVIEW]?.toString() ||
                        ''
                    }
                    element={
                        <UserProfileOverview
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.USER_PROFILE_PASSWORD]?.toString() ||
                        ''
                    }
                    element={
                        <UserProfilePassword
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.USER_PROFILE_PASSWORD] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.PROJECT_INVITATIONS]?.toString() || ''
                    }
                    element={
                        <ProjectInvitations
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.PROJECT_INVITATIONS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={RouteMap[PageMap.ACTIVE_INCIDENTS]?.toString() || ''}
                    element={
                        <ActiveIncidents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.ACTIVE_INCIDENTS] as Route
                            }
                        />
                    }
                />

                {/* User Settings */}

                <PageRoute
                    path={RouteMap[PageMap.USER_SETTINGS]?.toString() || ''}
                    element={
                        <UserSettingsNotificationMethods
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.USER_SETTINGS] as Route}
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.USER_SETTINGS_ON_CALL_LOGS
                        ]?.toString() || ''
                    }
                    element={
                        <UserSettingsNotificationLogs
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.USER_SETTINGS_ON_CALL_LOGS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE
                        ]?.toString() || ''
                    }
                    element={
                        <UserSettingsNotificationLogsTimeline
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap
                                        .USER_SETTINGS_ON_CALL_LOGS_TIMELINE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS
                        ]?.toString() || ''
                    }
                    element={
                        <UserSettingsNotiifcationSetting
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.USER_SETTINGS_NOTIFICATION_SETTINGS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.USER_SETTINGS_NOTIFICATION_METHODS
                        ]?.toString() || ''
                    }
                    element={
                        <UserSettingsNotificationMethods
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.USER_SETTINGS_NOTIFICATION_METHODS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.USER_SETTINGS_ON_CALL_RULES
                        ]?.toString() || ''
                    }
                    element={
                        <UserSettingsNotificationRules
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.USER_SETTINGS_ON_CALL_RULES
                                ] as Route
                            }
                        />
                    }
                />

                {/* 👇️ only match this when no other routes match */}
                <PageRoute
                    path="*"
                    element={
                        <PageNotFound
                            {...commonPageProps}
                            pageRoute={RouteMap[PageMap.LOGOUT] as Route}
                        />
                    }
                />
            </Routes>
        </MasterPage>
    );
};

export default App;
