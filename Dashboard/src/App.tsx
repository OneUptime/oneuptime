import React, { useState, useEffect } from 'react';
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
import Home from './Pages/Home/Home';
import NotOperationalMonitors from './Pages/Home/NotOperationalMonitors';
import OngoingScheduledEvents from './Pages/Home/OngoingScheduledMaintenance';

import useAsyncEffect from 'use-async-effect';

import Logs from './Pages/Logs/Logs';
import Navigation from 'CommonUI/src/Utils/Navigation';
import RouteMap from './Utils/RouteMap';
import PageMap from './Utils/PageMap';
import {
    ACCOUNTS_URL,
    BILLING_ENABLED,
    DASHBOARD_API_URL,
} from 'CommonUI/src/Config';

import ActiveIncidents from './Pages/Global/ActiveIncidents';
import ProjectInvitations from './Pages/Global/ProjectInvitations';

import SettingsDangerZone from './Pages/Settings/DangerZone';

// User Profile
import UserProfileOverview from './Pages/Global/UserProfile/Index';
import UserProfilePicture from './Pages/Global/UserProfile/Picture';
import UserProfilePassword from './Pages/Global/UserProfile/Password';

// On-Call Duty
import OnCallDutyPoliciesPage from './Pages/OnCallDuty/OnCallDutyPolicies';
import OnCallDutyExecutionLogs from './Pages/OnCallDuty/OnCallDutyExecutionLogs';
import OnCallDutyPolicyExecutionLogTimeline from './Pages/OnCallDuty/OnCallDutyExecutionLogView';
import OnCallDutyPolicyView from './Pages/OnCallDuty/OnCallDutyPolicy/Index';
import OnCallDutyPolicyViewDelete from './Pages/OnCallDuty/OnCallDutyPolicy/Delete';
import OnCallDutyPolicyViewLogs from './Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogs';
import OnCallDutyPolicyViewLogsView from './Pages/OnCallDuty/OnCallDutyPolicy/ExecutionLogView';
import OnCallDutyPolicyViewEscalation from './Pages/OnCallDuty/OnCallDutyPolicy/Escalation';
import OnCallDutyPolicyViewCustomFields from './Pages/OnCallDuty/OnCallDutyPolicy/CustomFields';

// On Call Schedules

import OnCallDutySchedules from './Pages/OnCallDuty/OnCallDutySchedules';
import OnCallDutyScheduleView from './Pages/OnCallDuty/OnCallDutySchedule/Index';
import OnCallDutyScheduleViewDelete from './Pages/OnCallDuty/OnCallDutySchedule/Delete';
import OnCallDutyScheduleViewLayers from './Pages/OnCallDuty/OnCallDutySchedule/Layers';

// Monitor Groups.
import MonitorGroups from './Pages/MonitorGroup/MonitorGroups';
import MonitorGroupView from './Pages/MonitorGroup/View/Index';
import MonitorGroupViewDelete from './Pages/MonitorGroup/View/Delete';
import MonitorGroupViewMonitors from './Pages/MonitorGroup/View/Monitors';
import MonitorGroupViewIncidents from './Pages/MonitorGroup/View/Incidents';
import MonitorGroupViewOwners from './Pages/MonitorGroup/View/Owners';

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
import URL from 'Common/Types/API/URL';

//Routes
import InitRoutes from './Routes/InitRoutes';
import TelemetryRoutes from './Routes/TelemetryRoutes';
import MonitorsRoutes from './Routes/MonitorsRoutes';
import WorkflowRoutes from './Routes/WorkflowRoutes';
import StatusPagesRoutes from './Routes/StatusPagesRoutes';
import IncidentsRoutes from './Routes/IncidentsRoutes';
import ScheduledMaintenanceEventsRoutes from './Routes/ScheduleMaintenaceEventsRoutes';
import SettingsRoutes from './Routes/SettingsRoutes';

const App: () => JSX.Element = () => {
    Navigation.setNavigateHook(useNavigate());
    Navigation.setLocation(useLocation());
    Navigation.setParams(useParams());

    if (!User.isLoggedIn()) {
        if (Navigation.getQueryStringByName('sso_token')) {
            Navigation.navigate(
                URL.fromString(ACCOUNTS_URL.toString()).addQueryParam(
                    'sso',
                    'true'
                )
            );
        } else {
            Navigation.navigate(URL.fromString(ACCOUNTS_URL.toString()));
        }
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

    const fetchProjects: () => Promise<void> = async (): Promise<void> => {
        setLoading(true);

        // get list of projects.
        try {
            const result: ListResult<Project> = await ModelAPI.getList<Project>(
                Project,
                {},
                50,
                0,
                {},
                {},

                {
                    isMultiTenantRequest: true,
                    overrideRequestUrl: URL.fromString(
                        DASHBOARD_API_URL.toString()
                    ).addRoute('/project/list-user-projects'),
                }
            );
            setProjects(result.data);
        } catch (err) {
            setError(API.getFriendlyMessage(err));
        }

        setLoading(false);
    };

    useAsyncEffect(async () => {
        await fetchProjects();
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
                    path="/*"
                    element={
                        <InitRoutes
                            {...commonPageProps}
                            projects={projects}
                            isLoading={isLoading}
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
                {/* Telemetry */}
                <PageRoute
                    path={RouteMap[PageMap.TELEMETRY_ROOT]?.toString() || ''}
                    element={<TelemetryRoutes {...commonPageProps} />}
                />

                {/* Monitors */}
                <PageRoute
                    path={RouteMap[PageMap.MONITORS_ROOT]?.toString() || ''}
                    element={<MonitorsRoutes {...commonPageProps} />}
                />

                {/* Workflows  */}
                <PageRoute
                    path={RouteMap[PageMap.WORKFLOWS_ROOT]?.toString() || ''}
                    element={<WorkflowRoutes {...commonPageProps} />}
                />

                {/* Status Pages */}
                <PageRoute
                    path={RouteMap[PageMap.STATUS_PAGES_ROOT]?.toString() || ''}
                    element={<StatusPagesRoutes {...commonPageProps} />}
                />

                {/* Incidents */}
                <PageRoute
                    path={RouteMap[PageMap.INCIDENTS_ROOT]?.toString() || ''}
                    element={<IncidentsRoutes {...commonPageProps} />}
                />

                {/* Scheduled Events */}

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT
                        ]?.toString() || ''
                    }
                    element={
                        <ScheduledMaintenanceEventsRoutes
                            {...commonPageProps}
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
                    path={RouteMap[PageMap.SETTINGS_ROOT]?.toString() || ''}
                    element={<SettingsRoutes {...commonPageProps} />}
                />

                {/* As this one has dependencies with the selected project and etc, we need to put it here for now. */}
                <PageRoute
                    path={
                        RouteMap[PageMap.SETTINGS_DANGERZONE]?.toString() || ''
                    }
                    element={
                        <SettingsDangerZone
                            onProjectDeleted={async () => {
                                setSelectedProject(null);
                                setProjects([]);
                                await fetchProjects();
                                Navigation.navigate(RouteMap[PageMap.INIT]!);
                            }}
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.SETTINGS_DANGERZONE] as Route
                            }
                        />
                    }
                />

                {/* On-Call Schedules */}

                <PageRoute
                    path={
                        RouteMap[PageMap.ON_CALL_DUTY_SCHEDULES]?.toString() ||
                        ''
                    }
                    element={
                        <OnCallDutySchedules
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_SCHEDULES
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyScheduleView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_SCHEDULE_VIEW
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyScheduleViewDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_DELETE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS
                        ]?.toString() || ''
                    }
                    element={
                        <OnCallDutyScheduleViewLayers
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS
                                ] as Route
                            }
                        />
                    }
                />

                {/* On-Call Duty */}

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
                                    PageMap.USER_SETTINGS_ON_CALL_LOGS_TIMELINE
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

                {/** Monitor Groups */}

                <PageRoute
                    path={RouteMap[PageMap.MONITOR_GROUPS]?.toString() || ''}
                    element={
                        <MonitorGroups
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_GROUPS] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[PageMap.MONITOR_GROUP_VIEW]?.toString() || ''
                    }
                    element={
                        <MonitorGroupView
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.MONITOR_GROUP_VIEW_DELETE
                        ]?.toString() || ''
                    }
                    element={
                        <MonitorGroupViewDelete
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITOR_GROUP_VIEW_DELETE
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.MONITOR_GROUP_VIEW_MONITORS
                        ]?.toString() || ''
                    }
                    element={
                        <MonitorGroupViewMonitors
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITOR_GROUP_VIEW_MONITORS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.MONITOR_GROUP_VIEW_INCIDENTS
                        ]?.toString() || ''
                    }
                    element={
                        <MonitorGroupViewIncidents
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITOR_GROUP_VIEW_INCIDENTS
                                ] as Route
                            }
                        />
                    }
                />

                <PageRoute
                    path={
                        RouteMap[
                            PageMap.MONITOR_GROUP_VIEW_OWNERS
                        ]?.toString() || ''
                    }
                    element={
                        <MonitorGroupViewOwners
                            {...commonPageProps}
                            pageRoute={
                                RouteMap[
                                    PageMap.MONITOR_GROUP_VIEW_OWNERS
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
