import IncidentsTable from "../../Components/Incident/IncidentsTable";
import IncidentStateUtil from "../../Utils/IncidentState";
import AlertStateUtil from "../../Utils/AlertState";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import Page from "Common/UI/Components/Page/Page";
import API from "Common/UI/Utils/API/API";
import UiAnalytics from "Common/UI/Utils/Analytics";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

export interface ComponentProps extends PageComponentProps {
  isLoadingProjects: boolean;
  projects: Array<Project>;
}

interface DashboardStats {
  activeIncidents: number;
  activeAlerts: number | null;
  inoperationalMonitors: number | null;
  ongoingScheduledMaintenances: number | null;
}

type MetricTone = "rose" | "amber" | "violet" | "slate";

interface MetricCardProps {
  title: string;
  value: number | null;
  description: string;
  icon: IconProp;
  tone: MetricTone;
  route: Route;
  emptyLabel: string;
  unavailableLabel: string;
}

interface QuickLinkProps {
  title: string;
  description: string;
  icon: IconProp;
  route: Route;
}

const metricToneClasses: Record<
  MetricTone,
  { background: string; icon: string; indicator: string; ring: string }
> = {
  rose: {
    background: "bg-rose-50",
    icon: "text-rose-600",
    indicator: "bg-rose-500",
    ring: "ring-rose-100",
  },
  amber: {
    background: "bg-amber-50",
    icon: "text-amber-600",
    indicator: "bg-amber-500",
    ring: "ring-amber-100",
  },
  violet: {
    background: "bg-violet-50",
    icon: "text-violet-600",
    indicator: "bg-rose-500",
    ring: "ring-violet-100",
  },
  slate: {
    background: "bg-slate-100",
    icon: "text-slate-600",
    indicator: "bg-slate-400",
    ring: "ring-slate-200",
  },
};

const getCountOrNull: (
  countPromise: Promise<number>,
) => Promise<number | null> = async (
  countPromise: Promise<number>,
): Promise<number | null> => {
  try {
    return await countPromise;
  } catch {
    return null;
  }
};

const getActiveAlertsCount: (
  projectId: ObjectID,
) => Promise<number | null> = async (
  projectId: ObjectID,
): Promise<number | null> => {
  try {
    const alertStates: Array<AlertState> =
      await AlertStateUtil.getUnresolvedAlertStates(projectId);

    if (alertStates.length === 0) {
      return 0;
    }

    return await ModelAPI.count<Alert>({
      modelType: Alert,
      query: {
        projectId,
        currentAlertStateId: new Includes(
          alertStates.map((state: AlertState) => {
            return state.id!;
          }),
        ),
      },
    });
  } catch {
    return null;
  }
};

const MetricCard: FunctionComponent<MetricCardProps> = (
  props: MetricCardProps,
): ReactElement => {
  const toneClasses: {
    background: string;
    icon: string;
    indicator: string;
    ring: string;
  } = metricToneClasses[props.tone];
  const isUnavailable: boolean = props.value === null;
  const hasItems: boolean = props.value !== null && props.value > 0;

  return (
    <Link
      to={props.route}
      className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition duration-150 hover:-translate-y-px hover:border-gray-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-500">{props.title}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-950 tabular-nums">
            {props.value === null ? "—" : props.value}
          </p>
        </div>
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${toneClasses.background} ${toneClasses.ring}`}
        >
          <Icon icon={props.icon} className={`h-4 w-4 ${toneClasses.icon}`} />
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="truncate text-xs text-gray-500">
          {isUnavailable
            ? props.unavailableLabel
            : hasItems
              ? props.description
              : props.emptyLabel}
        </span>
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isUnavailable
              ? "bg-gray-300"
              : hasItems
                ? toneClasses.indicator
                : "bg-emerald-500"
          }`}
        />
      </div>
    </Link>
  );
};

const MetricCardSkeleton: FunctionComponent = (): ReactElement => {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="space-y-3">
          <div className="h-3 w-24 rounded bg-gray-200" />
          <div className="h-7 w-12 rounded bg-gray-200" />
        </div>
        <div className="h-8 w-8 rounded-lg bg-gray-100" />
      </div>
      <div className="mt-4 h-3 w-20 rounded bg-gray-100" />
    </div>
  );
};

const QuickLink: FunctionComponent<QuickLinkProps> = (
  props: QuickLinkProps,
): ReactElement => {
  return (
    <Link
      to={props.route}
      className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-gray-200 hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors group-hover:text-gray-900">
        <Icon icon={props.icon} className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-800">
          {props.title}
        </span>
        <span className="block truncate text-xs text-gray-500">
          {props.description}
        </span>
      </span>
      <Icon
        icon={IconProp.ChevronRight}
        className="ml-auto h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-gray-500"
      />
    </Link>
  );
};

const Home: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const [unresolvedIncidentStates, setUnresolvedIncidentStates] = useState<
    Array<IncidentState>
  >([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const latestRequestIdRef: React.MutableRefObject<number> = useRef<number>(0);
  const currentProjectIdValue: string =
    props.currentProject?.id?.toString() ||
    ProjectUtil.getCurrentProjectId()?.toString() ||
    "";

  const fetchDashboardData: (projectId: ObjectID) => Promise<void> =
    useCallback(async (projectId: ObjectID): Promise<void> => {
      const requestId: number = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;

      setIsLoading(true);
      setError("");

      try {
        const activeAlertsPromise: Promise<number | null> =
          getActiveAlertsCount(projectId);
        const inoperationalMonitorsPromise: Promise<number | null> =
          getCountOrNull(
            ModelAPI.count<Monitor>({
              modelType: Monitor,
              query: {
                projectId,
                currentMonitorStatus: {
                  isOperationalState: false,
                },
              },
            }),
          );
        const ongoingScheduledMaintenancesPromise: Promise<number | null> =
          getCountOrNull(
            ModelAPI.count<ScheduledMaintenance>({
              modelType: ScheduledMaintenance,
              query: {
                projectId,
                currentScheduledMaintenanceState: {
                  isOngoingState: true,
                },
              },
            }),
          );

        const incidentStates: Array<IncidentState> =
          await IncidentStateUtil.getUnresolvedIncidentStates(projectId);
        const activeIncidents: number = incidentStates.length
          ? await ModelAPI.count<Incident>({
              modelType: Incident,
              query: {
                projectId,
                currentIncidentStateId: new Includes(
                  incidentStates.map((state: IncidentState) => {
                    return state.id!;
                  }),
                ),
              },
            })
          : 0;

        const [
          activeAlerts,
          inoperationalMonitors,
          ongoingScheduledMaintenances,
        ]: [number | null, number | null, number | null] = await Promise.all([
          activeAlertsPromise,
          inoperationalMonitorsPromise,
          ongoingScheduledMaintenancesPromise,
        ]);

        if (requestId === latestRequestIdRef.current) {
          setUnresolvedIncidentStates(incidentStates);
          setStats({
            activeIncidents,
            activeAlerts,
            inoperationalMonitors,
            ongoingScheduledMaintenances,
          });
          setLastUpdatedAt(new Date());
        }
      } catch (err) {
        if (requestId === latestRequestIdRef.current) {
          setError(API.getFriendlyMessage(err));
        }
      }

      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false);
      }
    }, []);

  useEffect(() => {
    latestRequestIdRef.current += 1;

    if (props.isLoadingProjects) {
      setIsLoading(false);
      return;
    }

    if (props.projects.length === 0) {
      Navigation.navigate(RouteMap[PageMap.WELCOME] as Route);
      return;
    }

    setStats(null);
    setUnresolvedIncidentStates([]);
    setLastUpdatedAt(null);

    if (!currentProjectIdValue) {
      setError(t("Project not found."));
      setIsLoading(false);
      return;
    }

    const projectId: ObjectID = new ObjectID(currentProjectIdValue);

    UiAnalytics.capture("dashboard/home", {
      projectId,
    });

    fetchDashboardData(projectId).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, [
    props.isLoadingProjects,
    props.projects.length,
    currentProjectIdValue,
    fetchDashboardData,
    t,
  ]);

  const attentionCount: number = stats
    ? stats.activeIncidents +
      (stats.activeAlerts ?? 0) +
      (stats.inoperationalMonitors ?? 0)
    : 0;
  const hasUnavailableStats: boolean = Boolean(
    stats &&
      Object.values(stats).some((value: number | null) => {
        return value === null;
      }),
  );

  const populatedRoute: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  const quickLinks: Array<QuickLinkProps> = [
    {
      title: t("navbar.items.monitorsTitle"),
      description: t("navbar.items.monitorsDescription"),
      icon: IconProp.AltGlobe,
      route: populatedRoute(PageMap.MONITORS),
    },
    {
      title: t("navbar.items.logsTitle"),
      description: t("navbar.items.logsDescription"),
      icon: IconProp.Logs,
      route: populatedRoute(PageMap.LOGS),
    },
    {
      title: t("navbar.items.metricsTitle"),
      description: t("navbar.items.metricsDescription"),
      icon: IconProp.Heartbeat,
      route: populatedRoute(PageMap.METRICS),
    },
    {
      title: t("navbar.items.tracesTitle"),
      description: t("navbar.items.tracesDescription"),
      icon: IconProp.Waterfall,
      route: populatedRoute(PageMap.TRACES),
    },
    {
      title: t("navbar.items.statusPagesTitle"),
      description: t("navbar.items.statusPagesDescription"),
      icon: IconProp.CheckCircle,
      route: populatedRoute(PageMap.STATUS_PAGES),
    },
    {
      title: t("navbar.items.dashboardsTitle"),
      description: t("navbar.items.dashboardsDescription"),
      icon: IconProp.Grid,
      route: populatedRoute(PageMap.DASHBOARDS),
    },
  ];

  return (
    <Page
      title="Overview"
      breadcrumbLinks={[
        {
          title: "Project",
          to: populatedRoute(PageMap.HOME),
        },
        {
          title: "Overview",
          to: populatedRoute(PageMap.HOME),
        },
      ]}
      className="mb-auto max-w-full px-4 sm:px-6 lg:px-8 xl:px-10 mt-6 h-max"
      headerRight={
        <div className="flex items-center gap-3">
          {stats && (
            <div className="hidden items-center gap-2 text-xs text-gray-500 sm:flex">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  attentionCount > 0
                    ? "bg-rose-500"
                    : hasUnavailableStats
                      ? "bg-gray-300"
                      : "bg-emerald-500"
                }`}
              />
              <span>
                {attentionCount > 0
                  ? `${t("Active")}: ${attentionCount}`
                  : hasUnavailableStats
                    ? t("Unavailable")
                    : t("Operational")}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (!currentProjectIdValue) {
                return;
              }

              fetchDashboardData(new ObjectID(currentProjectIdValue)).catch(
                (err: Error) => {
                  setError(API.getFriendlyMessage(err));
                  setIsLoading(false);
                },
              );
            }}
            disabled={isLoading || !currentProjectIdValue}
            aria-label={`${t("Refresh")} ${t("Overview")}`}
            title={
              lastUpdatedAt
                ? `${t("Updated")} ${lastUpdatedAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : `${t("Refresh")} ${t("Overview")}`
            }
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Icon
              icon={IconProp.Refresh}
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">{t("Refresh")}</span>
          </button>
        </div>
      }
    >
      <div className="space-y-8 pb-10" aria-busy={isLoading}>
        {error && <ErrorMessage message={error} />}

        {!error && (
          <>
            <section aria-labelledby="workspace-pulse-heading">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <h2
                    id="workspace-pulse-heading"
                    className="text-sm font-semibold text-gray-900"
                  >
                    {t("Status")}
                  </h2>
                </div>
                {lastUpdatedAt && (
                  <span className="hidden text-xs text-gray-500 sm:block">
                    {t("Updated")}{" "}
                    {lastUpdatedAt.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {!stats ? (
                  <>
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                    <MetricCardSkeleton />
                  </>
                ) : (
                  stats && (
                    <>
                      <MetricCard
                        title={t("Active Incidents")}
                        value={stats.activeIncidents}
                        description={t("Active")}
                        emptyLabel={t("Nice work! No Active Incidents so far.")}
                        unavailableLabel={t("Unavailable")}
                        icon={IconProp.Alert}
                        tone="rose"
                        route={populatedRoute(PageMap.UNRESOLVED_INCIDENTS)}
                      />
                      <MetricCard
                        title={t("Active Alerts")}
                        value={stats.activeAlerts}
                        description={t("Active")}
                        emptyLabel={t("Nice work! No Active Alerts so far.")}
                        unavailableLabel={t("Unavailable")}
                        icon={IconProp.ExclaimationCircle}
                        tone="amber"
                        route={populatedRoute(PageMap.HOME_ACTIVE_ALERTS)}
                      />
                      <MetricCard
                        title={t("Inoperational Monitors")}
                        value={stats.inoperationalMonitors}
                        description={t("Inoperational")}
                        emptyLabel={t("All monitors in operational state.")}
                        unavailableLabel={t("Unavailable")}
                        icon={IconProp.AltGlobe}
                        tone="violet"
                        route={populatedRoute(
                          PageMap.HOME_NOT_OPERATIONAL_MONITORS,
                        )}
                      />
                      <MetricCard
                        title={t("Ongoing Scheduled Maintenance")}
                        value={stats.ongoingScheduledMaintenances}
                        description={t("Ongoing")}
                        emptyLabel={t("No ongoing events so far.")}
                        unavailableLabel={t("Unavailable")}
                        icon={IconProp.Clock}
                        tone="slate"
                        route={populatedRoute(
                          PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS,
                        )}
                      />
                    </>
                  )
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs">
                <span className="text-gray-500">{t("Activity")}</span>
                <Link
                  to={populatedRoute(PageMap.HOME_ACTIVE_INCIDENT_EPISODES)}
                  className="inline-flex items-center gap-1.5 font-medium text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  <Icon icon={IconProp.SquareStack} className="h-3.5 w-3.5" />
                  {t("Incident Episodes")}
                </Link>
                <Link
                  to={populatedRoute(PageMap.HOME_ACTIVE_EPISODES)}
                  className="inline-flex items-center gap-1.5 font-medium text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  <Icon icon={IconProp.SquareStack3D} className="h-3.5 w-3.5" />
                  {t("Alert Episodes")}
                </Link>
              </div>
            </section>

            <section
              aria-labelledby="quick-access-heading"
              className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 sm:p-4"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <div>
                  <h2
                    id="quick-access-heading"
                    className="text-sm font-semibold text-gray-900"
                  >
                    {t("Quick Links")}
                  </h2>
                </div>
                <span className="hidden items-center gap-1.5 text-[11px] text-gray-500 lg:flex">
                  <span>{t("More")}</span>
                  <kbd className="rounded border border-gray-200 bg-white px-1.5 py-0.5 font-sans text-[10px] text-gray-500 shadow-sm">
                    Ctrl/⌘ K
                  </kbd>
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-3">
                {quickLinks.map((quickLink: QuickLinkProps) => {
                  return <QuickLink key={quickLink.title} {...quickLink} />;
                })}
              </div>
            </section>

            <section aria-labelledby="active-incidents-heading">
              <div className="mb-3 flex items-center justify-between gap-4">
                <div>
                  <h2
                    id="active-incidents-heading"
                    className="text-sm font-semibold text-gray-900"
                  >
                    {t("Active Incidents")}
                  </h2>
                </div>
                <Link
                  to={populatedRoute(PageMap.INCIDENTS)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
                >
                  {t("All Incidents")}
                  <Icon icon={IconProp.ArrowRight} className="h-3 w-3" />
                </Link>
              </div>

              {!stats ? (
                <div
                  aria-hidden="true"
                  className="min-h-40 animate-pulse rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="h-4 w-32 rounded bg-gray-200" />
                  <div className="mt-3 h-3 w-64 max-w-full rounded bg-gray-100" />
                  <div className="mt-6 space-y-3">
                    <div className="h-9 rounded-lg bg-gray-100" />
                    <div className="h-9 rounded-lg bg-gray-100" />
                  </div>
                </div>
              ) : stats.activeIncidents > 0 ? (
                <IncidentsTable
                  query={{
                    projectId: new ObjectID(currentProjectIdValue),
                    currentIncidentStateId: new Includes(
                      unresolvedIncidentStates.map((state: IncidentState) => {
                        return state.id!;
                      }),
                    ),
                  }}
                  noItemsMessage={t("Nice work! No Active Incidents so far.")}
                  title={t("Active Incidents")}
                  description={t(
                    "Here is a list of all the Active Incidents for this project.",
                  )}
                />
              ) : (
                <div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
                  <div className="max-w-sm">
                    <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-inset ring-emerald-100">
                      <Icon
                        icon={IconProp.Check}
                        className="h-4 w-4 text-emerald-600"
                      />
                    </span>
                    <h3 className="mt-3 text-sm font-medium text-gray-900">
                      {t("Nice work! No Active Incidents so far.")}
                    </h3>
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </Page>
  );
};

export default Home;
