import AIChatPanel from "./Components/AIChat/AIChatPanel";
import DashboardCommandPalette from "./Components/CommandPalette/DashboardCommandPalette";
import MasterPage from "./Components/MasterPage/MasterPage";
import UseTimezoneInitElement from "./Components/UserTimezone/UserTimezoneInit";
import EventName from "./Utils/EventName";
import PageMap from "./Utils/PageMap";
import {
  ProjectSelectionNavigationDecision,
  getProjectSelectionNavigationDecision,
} from "./Utils/ProjectNavigation";
import RouteMap from "./Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import ProjectColorUtil from "Common/UI/Utils/ProjectColor";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "Common/UI/Utils/GlobalConfig";
import BillingPaymentMethod from "Common/Models/DatabaseModels/BillingPaymentMethod";
import Project from "Common/Models/DatabaseModels/Project";
import React, { useEffect, useState, Suspense, lazy } from "react";
import {
  Route as PageRoute,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import useAsyncEffect from "use-async-effect";
import PageComponentProps from "./Pages/PageComponentProps";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorBoundary from "Common/UI/Components/ErrorBoundary";
import { RoutesProps } from "./Types/RoutesProps";

// Static page imports
import Welcome from "./Pages/Onboarding/Welcome";
import Home from "./Pages/Home/Home";
import AICopilot from "./Pages/AICopilot/AICopilot";
import Sso from "./Pages/Onboarding/SSO";
import NotOperationalMonitors from "./Pages/Home/NotOperationalMonitors";
import HomeActiveAlerts from "./Pages/Home/ActiveAlerts";
import OngoingScheduledEvents from "./Pages/Home/OngoingScheduledMaintenance";
import HomeActiveEpisodes from "./Pages/Home/ActiveEpisodes";
import HomeActiveIncidentEpisodes from "./Pages/Home/ActiveIncidentEpisodes";
import SettingsDangerZone from "./Pages/Settings/DangerZone";
import Logout from "./Pages/Logout/Logout";
import UserProfilePicture from "./Pages/Global/UserProfile/Picture";
import UserProfileOverview from "./Pages/Global/UserProfile/Index";
import UserProfilePassword from "./Pages/Global/UserProfile/Password";
import UseTwoFactorAuth from "./Pages/Global/UserProfile/TwoFactorAuth";
import UserProfileDelete from "./Pages/Global/UserProfile/DeleteAccount";
import ProjectInvitations from "./Pages/Global/ProjectInvitations";
import ActiveIncidents from "./Pages/Global/ActiveIncidents";
import ActiveAlerts from "./Pages/Global/ActiveAlerts";
import ActiveAlertEpisodes from "./Pages/Global/ActiveAlertEpisodes";
import ActiveIncidentEpisodes from "./Pages/Global/ActiveIncidentEpisodes";
import MyOnCallPolicies from "./Pages/Global/MyOnCallPolicies";
import PageNotFound from "./Pages/PageNotFound/PageNotFound";

/*
 * Lazy-loaded route bundles. Each section lazy()-imports its OWN module so a
 * navigation only downloads that section's pages. These previously all pointed
 * at the Routes/AllRoutes barrel ("all routes in one bundle to minimize chunk
 * count"), which made the first navigation into ANY section download every
 * page of the app in one multi-megabyte chunk. esbuild's code splitting hoists
 * shared code into common chunks, chunk names are content-hashed (so the
 * service worker's cache-first policy for /dist/ stays correct), and the
 * ErrorBoundary below already catches a lazy chunk that 404s after a deploy,
 * so per-section chunks are safe.
 */
type LazyRoutes = React.LazyExoticComponent<
  React.FunctionComponent<PageComponentProps>
>;

const InitRoutes: React.LazyExoticComponent<
  React.FunctionComponent<RoutesProps>
> = lazy(() => {
  return import("./Routes/InitRoutes");
});

const LogsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/LogsRoutes");
});
const SecurityEventsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/SecurityEventsRoutes");
});
const MetricsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/MetricsRoutes");
});
const TracesRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/TracesRoutes");
});
const ExceptionsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/ExceptionsRoutes");
});
const LlmRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/LlmRoutes");
});
const InventoryRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/InventoryRoutes");
});
const TopologyRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/TopologyRoutes");
});
const ProfilesRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/ProfilesRoutes");
});
const IncidentsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/IncidentsRoutes");
});
// The next two module file names differ from their component names.
const AlertsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/AlertRoutes");
});
const ScheduledMaintenanceEventsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/ScheduleMaintenanceEventsRoutes");
});
const OnCallDutyRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/OnCallDutyRoutes");
});
const MonitorsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/MonitorsRoutes");
});
const MonitorGroupRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/MonitorGroupRoutes");
});
const WorkflowRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/WorkflowRoutes");
});
const RunbookRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/RunbookRoutes");
});
const StatusPagesRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/StatusPagesRoutes");
});
const DashboardRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/DashboardRoutes");
});
const ServiceRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/ServiceRoutes");
});
const KubernetesRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/KubernetesRoutes");
});
const DockerRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/DockerRoutes");
});
const NetworkDeviceRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/NetworkDeviceRoutes");
});
const NetworkSiteRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/NetworkSiteRoutes");
});
const SloRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/SloRoutes");
});
const PodmanRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/PodmanRoutes");
});
const ProxmoxRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/ProxmoxRoutes");
});
const IoTRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/IoTRoutes");
});
const DockerSwarmRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/DockerSwarmRoutes");
});
const CephRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/CephRoutes");
});
const HostRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/HostRoutes");
});
const ServerlessRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/ServerlessRoutes");
});
const CloudResourceRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/CloudResourceRoutes");
});
const RumApplicationRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/RumApplicationRoutes");
});
const CodeRepositoryRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/CodeRepositoryRoutes");
});
const AIAgentTasksRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/AIAgentTasksRoutes");
});
const AIInsightsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/AIInsightsRoutes");
});
const SettingsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/SettingsRoutes");
});
const UserSettingsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/UserSettingsRoutes");
});
const UsersRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/UsersRoutes");
});
const TeamsRoutes: LazyRoutes = lazy(() => {
  return import("./Routes/TeamsRoutes");
});

const App: () => JSX.Element = () => {
  const location: ReturnType<typeof useLocation> = useLocation();

  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(location);
  Navigation.setParams(useParams());

  const [isLoading, setLoading] = useState<boolean>(true);
  const [showProjectModal, setShowProjectModal] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [projects, setProjects] = useState<Array<Project>>([]);

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const [paymentMethodsCount, setPaymentMethodsCount] = useState<
    number | undefined
  >(undefined);

  const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean>(false);

  /*
   * Deliberately a BACKGROUND fetch: this count must never feed MasterPage's
   * isLoading. Gating on it unmounted the entire app (header, navbar, page)
   * behind a full-screen loader for one count query on every project
   * selection, and the remount re-fired every mount-time request. Consumers
   * already tolerate the count arriving late — Header renders its add-card
   * nag only once paymentMethodsCount !== undefined.
   */
  useAsyncEffect(async () => {
    try {
      if (selectedProject && selectedProject._id) {
        ProjectUtil.setCurrentProject(selectedProject);
      }

      if (selectedProject && selectedProject._id && BILLING_ENABLED) {
        const paymentMethodsCount: number = await ModelAPI.count({
          modelType: BillingPaymentMethod,
          query: { projectId: selectedProject._id },
        });

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
    } catch (e) {
      setError(API.getFriendlyMessage(e));
    }
  }, [selectedProject?._id]);

  /*
   * Mark the dashboard with the selected project's colour.
   *
   * Kept apart from the effect above, and deliberately swallowing its own
   * errors: the colour is decoration, and a failed lookup must never surface
   * as a page-level error or block the dashboard from rendering. Falling back
   * to no colour is a complete, correct outcome.
   */
  useAsyncEffect(async () => {
    try {
      const globalVars: GlobalConfigVars = await GlobalConfigUtil.fetchVars();

      ProjectColorUtil.setColor(
        ProjectColorUtil.resolve({
          projectColor: selectedProject?.color?.toString() || null,
          defaultProjectColor: globalVars.defaultProjectColor,
        }),
      );
    } catch {
      // Keep whatever is already painted.
    }
  }, [selectedProject?._id, selectedProject?.color?.toString()]);

  const onProjectSelected: (project: Project) => void = (
    project: Project,
  ): void => {
    /*
     * Captured BEFORE setSelectedProject: the in-memory id is what separates
     * a fresh boot (null — login, reload, auto-select) from an actual switch
     * between two projects inside this document.
     */
    const previousProjectId: string | null =
      selectedProject?._id?.toString() || null;

    setSelectedProject(project);

    if (
      projects.filter((i: Project) => {
        return i && i._id === project._id;
      }).length === 0
    ) {
      setProjects([...projects, project]);
    }

    const currentRoute: Route = Navigation.getCurrentRoute();

    const decision: ProjectSelectionNavigationDecision =
      getProjectSelectionNavigationDecision({
        currentRoute: currentRoute.toString(),
        selectedProjectId: project._id?.toString(),
        previousProjectId: previousProjectId,
      });

    if (decision.shouldNavigate) {
      ProjectUtil.setCurrentProject(project);

      /*
       * forceNavigate (a full document reload) ONLY when switching between
       * two different projects, where the reload resets mounted components
       * still holding the old project's state. The first selection after
       * login/reload stays an in-app (SPA) navigation — a full reload there
       * re-ran the whole boot and threw away every in-flight request.
       */
      Navigation.navigate(new Route(decision.routePath), {
        forceNavigate: decision.forceNavigate,
      });
    }
  };

  useEffect(() => {
    GlobalEvents.addEventListener(
      EventName.PROJECT_INVITATIONS_REFRESH,
      fetchProjects,
    );

    return () => {
      // on unmount.
      GlobalEvents.removeEventListener(
        EventName.PROJECT_INVITATIONS_REFRESH,
        fetchProjects,
      );
    };
  }, []);

  const fetchProjects: PromiseVoidFunction = async (): Promise<void> => {
    setLoading(true);

    // get list of projects.
    try {
      const result: ListResult<Project> = await ModelAPI.getList<Project>({
        modelType: Project,
        query: {},
        limit: 50,
        skip: 0,
        select: {},
        sort: {},

        requestOptions: {
          isMultiTenantRequest: true,
          overrideRequestUrl: URL.fromString(APP_API_URL.toString()).addRoute(
            "/project/list-user-projects",
          ),
        },
      });
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
      isLoading={isLoading}
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
      <UseTimezoneInitElement />
      <AIChatPanel />
      <DashboardCommandPalette />
      {/*
       * Contain page-level render errors here. Without a boundary a single
       * throwing component (or a lazy chunk that 404s after a deploy) unmounts
       * the whole tree and the user is left on a blank white page. Keying the
       * reset on the pathname means navigating elsewhere clears the error, so
       * one broken page never traps the session.
       */}
      <ErrorBoundary resetKey={location.pathname}>
        <Suspense fallback={<PageLoader isVisible={true} />}>
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
              path={RouteMap[PageMap.WELCOME]?.toString() || ""}
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
              path={RouteMap[PageMap.HOME]?.toString() || ""}
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
              path={RouteMap[PageMap.PROJECT_SSO]?.toString() || ""}
              element={
                <Sso
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.PROJECT_SSO] as Route}
                />
              }
            />

            {/* AI Copilot */}

            <PageRoute
              path={RouteMap[PageMap.AI_COPILOT]?.toString() || ""}
              element={
                <AICopilot
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.AI_COPILOT] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.AI_COPILOT_CONVERSATION]?.toString() || ""}
              element={
                <AICopilot
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.AI_COPILOT_CONVERSATION] as Route}
                />
              }
            />

            <PageRoute
              path={
                RouteMap[PageMap.HOME_NOT_OPERATIONAL_MONITORS]?.toString() ||
                ""
              }
              element={
                <NotOperationalMonitors
                  {...commonPageProps}
                  pageRoute={
                    RouteMap[PageMap.HOME_NOT_OPERATIONAL_MONITORS] as Route
                  }
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.HOME_ACTIVE_ALERTS]?.toString() || ""}
              element={
                <HomeActiveAlerts
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.HOME_ACTIVE_ALERTS] as Route}
                />
              }
            />

            <PageRoute
              path={
                RouteMap[
                  PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                ]?.toString() ||
                "" ||
                ""
              }
              element={
                <OngoingScheduledEvents
                  {...commonPageProps}
                  pageRoute={
                    RouteMap[
                      PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
                    ] as Route
                  }
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.HOME_ACTIVE_EPISODES]?.toString() || ""}
              element={
                <HomeActiveEpisodes
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.HOME_ACTIVE_EPISODES] as Route}
                />
              }
            />

            <PageRoute
              path={
                RouteMap[PageMap.HOME_ACTIVE_INCIDENT_EPISODES]?.toString() ||
                ""
              }
              element={
                <HomeActiveIncidentEpisodes
                  {...commonPageProps}
                  pageRoute={
                    RouteMap[PageMap.HOME_ACTIVE_INCIDENT_EPISODES] as Route
                  }
                />
              }
            />
            {/* Logs */}
            <PageRoute
              path={RouteMap[PageMap.LOGS_ROOT]?.toString() || ""}
              element={<LogsRoutes {...commonPageProps} />}
            />

            {/* Security Events */}
            <PageRoute
              path={RouteMap[PageMap.SECURITY_EVENTS_ROOT]?.toString() || ""}
              element={<SecurityEventsRoutes {...commonPageProps} />}
            />

            {/* Metrics */}
            <PageRoute
              path={RouteMap[PageMap.METRICS_ROOT]?.toString() || ""}
              element={<MetricsRoutes {...commonPageProps} />}
            />

            {/* Traces */}
            <PageRoute
              path={RouteMap[PageMap.TRACES_ROOT]?.toString() || ""}
              element={<TracesRoutes {...commonPageProps} />}
            />

            {/* Profiles */}
            <PageRoute
              path={RouteMap[PageMap.PROFILES_ROOT]?.toString() || ""}
              element={<ProfilesRoutes {...commonPageProps} />}
            />

            {/* Monitors */}
            <PageRoute
              path={RouteMap[PageMap.MONITORS_ROOT]?.toString() || ""}
              element={<MonitorsRoutes {...commonPageProps} />}
            />

            {/* Workflows  */}
            <PageRoute
              path={RouteMap[PageMap.WORKFLOWS_ROOT]?.toString() || ""}
              element={<WorkflowRoutes {...commonPageProps} />}
            />

            {/* Runbooks */}
            <PageRoute
              path={RouteMap[PageMap.RUNBOOKS_ROOT]?.toString() || ""}
              element={<RunbookRoutes {...commonPageProps} />}
            />

            {/* Status Pages */}
            <PageRoute
              path={RouteMap[PageMap.STATUS_PAGES_ROOT]?.toString() || ""}
              element={<StatusPagesRoutes {...commonPageProps} />}
            />

            {/* Dashboards */}
            <PageRoute
              path={RouteMap[PageMap.DASHBOARDS_ROOT]?.toString() || ""}
              element={<DashboardRoutes {...commonPageProps} />}
            />

            {/* Service */}
            <PageRoute
              path={RouteMap[PageMap.SERVICE_ROOT]?.toString() || ""}
              element={<ServiceRoutes {...commonPageProps} />}
            />

            {/* Kubernetes */}
            <PageRoute
              path={RouteMap[PageMap.KUBERNETES_ROOT]?.toString() || ""}
              element={<KubernetesRoutes {...commonPageProps} />}
            />

            {/* Docker */}
            <PageRoute
              path={RouteMap[PageMap.DOCKER_ROOT]?.toString() || ""}
              element={<DockerRoutes {...commonPageProps} />}
            />

            {/* Network Devices */}
            <PageRoute
              path={RouteMap[PageMap.NETWORK_DEVICE_ROOT]?.toString() || ""}
              element={<NetworkDeviceRoutes {...commonPageProps} />}
            />

            {/* Network Sites */}
            <PageRoute
              path={RouteMap[PageMap.NETWORK_SITE_ROOT]?.toString() || ""}
              element={<NetworkSiteRoutes {...commonPageProps} />}
            />

            {/* SLOs */}
            <PageRoute
              path={RouteMap[PageMap.SLOS_ROOT]?.toString() || ""}
              element={<SloRoutes {...commonPageProps} />}
            />

            {/* Podman */}
            <PageRoute
              path={RouteMap[PageMap.PODMAN_ROOT]?.toString() || ""}
              element={<PodmanRoutes {...commonPageProps} />}
            />

            {/* Proxmox */}
            <PageRoute
              path={RouteMap[PageMap.PROXMOX_ROOT]?.toString() || ""}
              element={<ProxmoxRoutes {...commonPageProps} />}
            />

            {/* IoT */}
            <PageRoute
              path={RouteMap[PageMap.IOT_ROOT]?.toString() || ""}
              element={<IoTRoutes {...commonPageProps} />}
            />

            {/* Docker Swarm */}
            <PageRoute
              path={RouteMap[PageMap.DOCKER_SWARM_ROOT]?.toString() || ""}
              element={<DockerSwarmRoutes {...commonPageProps} />}
            />

            {/* Ceph */}
            <PageRoute
              path={RouteMap[PageMap.CEPH_ROOT]?.toString() || ""}
              element={<CephRoutes {...commonPageProps} />}
            />

            {/* Hosts */}
            <PageRoute
              path={RouteMap[PageMap.HOST_ROOT]?.toString() || ""}
              element={<HostRoutes {...commonPageProps} />}
            />

            {/* Serverless Functions */}
            <PageRoute
              path={RouteMap[PageMap.SERVERLESS_ROOT]?.toString() || ""}
              element={<ServerlessRoutes {...commonPageProps} />}
            />

            {/* Cloud Resources */}
            <PageRoute
              path={RouteMap[PageMap.CLOUD_ROOT]?.toString() || ""}
              element={<CloudResourceRoutes {...commonPageProps} />}
            />

            {/* Real User Monitoring */}
            <PageRoute
              path={RouteMap[PageMap.RUM_ROOT]?.toString() || ""}
              element={<RumApplicationRoutes {...commonPageProps} />}
            />

            {/* Code Repository */}
            <PageRoute
              path={RouteMap[PageMap.CODE_REPOSITORY_ROOT]?.toString() || ""}
              element={<CodeRepositoryRoutes {...commonPageProps} />}
            />

            {/* Incidents */}
            <PageRoute
              path={RouteMap[PageMap.INCIDENTS_ROOT]?.toString() || ""}
              element={<IncidentsRoutes {...commonPageProps} />}
            />

            {/* Incidents */}
            <PageRoute
              path={RouteMap[PageMap.ALERTS_ROOT]?.toString() || ""}
              element={<AlertsRoutes {...commonPageProps} />}
            />

            {/* Scheduled Events */}

            <PageRoute
              path={
                RouteMap[
                  PageMap.SCHEDULED_MAINTENANCE_EVENTS_ROOT
                ]?.toString() || ""
              }
              element={
                <ScheduledMaintenanceEventsRoutes {...commonPageProps} />
              }
            />

            {/* Users Routes (top-level) */}
            <PageRoute
              path={RouteMap[PageMap.USERS_ROOT]?.toString() || ""}
              element={<UsersRoutes {...commonPageProps} />}
            />

            {/* Teams Routes (top-level) */}
            <PageRoute
              path={RouteMap[PageMap.TEAMS_ROOT]?.toString() || ""}
              element={<TeamsRoutes {...commonPageProps} />}
            />

            {/* Settings Routes */}

            <PageRoute
              path={RouteMap[PageMap.SETTINGS_ROOT]?.toString() || ""}
              element={<SettingsRoutes {...commonPageProps} />}
            />

            {/* As this one has dependencies with the selected project and etc, we need to put it here for now. */}
            <PageRoute
              path={RouteMap[PageMap.SETTINGS_DANGERZONE]?.toString() || ""}
              element={
                <SettingsDangerZone
                  onProjectDeleted={async () => {
                    setSelectedProject(null);
                    setProjects([]);
                    await fetchProjects();
                    Navigation.navigate(RouteMap[PageMap.INIT]!);
                  }}
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.SETTINGS_DANGERZONE] as Route}
                />
              }
            />

            {/* On-Call Duty */}

            <PageRoute
              path={RouteMap[PageMap.ON_CALL_DUTY_ROOT]?.toString() || ""}
              element={<OnCallDutyRoutes {...commonPageProps} />}
            />

            {/* Misc Routes */}
            <PageRoute
              path={RouteMap[PageMap.LOGOUT]?.toString() || ""}
              element={
                <Logout
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.LOGOUT] as Route}
                />
              }
            />

            {/* Global Routes */}
            <PageRoute
              path={RouteMap[PageMap.USER_PROFILE_PICTURE]?.toString() || ""}
              element={
                <UserProfilePicture
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.USER_PROFILE_PICTURE] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.USER_PROFILE_OVERVIEW]?.toString() || ""}
              element={
                <UserProfileOverview
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.USER_PROFILE_OVERVIEW] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.USER_PROFILE_PASSWORD]?.toString() || ""}
              element={
                <UserProfilePassword
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.USER_PROFILE_PASSWORD] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.USER_TWO_FACTOR_AUTH]?.toString() || ""}
              element={
                <UseTwoFactorAuth
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.USER_TWO_FACTOR_AUTH] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.USER_PROFILE_DELETE]?.toString() || ""}
              element={
                <UserProfileDelete
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.USER_PROFILE_DELETE] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.PROJECT_INVITATIONS]?.toString() || ""}
              element={
                <ProjectInvitations
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.PROJECT_INVITATIONS] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.ACTIVE_INCIDENTS]?.toString() || ""}
              element={
                <ActiveIncidents
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.ACTIVE_INCIDENTS] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.ACTIVE_ALERTS]?.toString() || ""}
              element={
                <ActiveAlerts
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.ACTIVE_ALERTS] as Route}
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.ACTIVE_ALERT_EPISODES]?.toString() || ""}
              element={
                <ActiveAlertEpisodes
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.ACTIVE_ALERT_EPISODES] as Route}
                />
              }
            />

            <PageRoute
              path={
                RouteMap[PageMap.ACTIVE_INCIDENT_EPISODES]?.toString() || ""
              }
              element={
                <ActiveIncidentEpisodes
                  {...commonPageProps}
                  pageRoute={
                    RouteMap[PageMap.ACTIVE_INCIDENT_EPISODES] as Route
                  }
                />
              }
            />

            <PageRoute
              path={RouteMap[PageMap.MY_ON_CALL_POLICIES]?.toString() || ""}
              element={
                <MyOnCallPolicies
                  {...commonPageProps}
                  pageRoute={RouteMap[PageMap.MY_ON_CALL_POLICIES] as Route}
                />
              }
            />

            {/* User Settings */}

            <PageRoute
              path={RouteMap[PageMap.USER_SETTINGS_ROOT]?.toString() || ""}
              element={<UserSettingsRoutes {...commonPageProps} />}
            />

            {/** Monitor Groups */}

            <PageRoute
              path={RouteMap[PageMap.MONITOR_GROUPS_ROOT]?.toString() || ""}
              element={<MonitorGroupRoutes {...commonPageProps} />}
            />

            {/** AI Agent Tasks */}

            <PageRoute
              path={RouteMap[PageMap.AI_AGENT_TASKS_ROOT]?.toString() || ""}
              element={<AIAgentTasksRoutes {...commonPageProps} />}
            />

            {/** AI Insights */}

            <PageRoute
              path={RouteMap[PageMap.AI_INSIGHTS_ROOT]?.toString() || ""}
              element={<AIInsightsRoutes {...commonPageProps} />}
            />

            {/** Exceptions */}

            <PageRoute
              path={RouteMap[PageMap.EXCEPTIONS_ROOT]?.toString() || ""}
              element={<ExceptionsRoutes {...commonPageProps} />}
            />

            {/** AI / LLM Observability */}

            <PageRoute
              path={RouteMap[PageMap.LLM_ROOT]?.toString() || ""}
              element={<LlmRoutes {...commonPageProps} />}
            />

            {/** Inventory (the estate catalog) */}

            <PageRoute
              path={RouteMap[PageMap.INVENTORY_ROOT]?.toString() || ""}
              element={<InventoryRoutes {...commonPageProps} />}
            />

            {/** Topology (service map) */}

            <PageRoute
              path={RouteMap[PageMap.TOPOLOGY_ROOT]?.toString() || ""}
              element={<TopologyRoutes {...commonPageProps} />}
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
        </Suspense>
      </ErrorBoundary>
    </MasterPage>
  );
};

export default App;
