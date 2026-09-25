import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "Common/Models/DatabaseModels/DatabaseServerEndpoint";
import Service from "Common/Models/DatabaseModels/Service";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Includes from "Common/Types/BaseDatabase/Includes";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import OneUptimeDate from "Common/Types/Date";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import { getDatabaseServerDiscoverySourceLabel } from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import ResourceOverview, {
  ResourceOverviewChip,
  ResourceOverviewDetailRow,
  ResourceOverviewQuickLink,
  ResourceOverviewTile,
} from "../../../Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../Components/TelemetryResource/ChartCard";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh from "../../../Components/TelemetryResource/useAutoRefresh";
import DatabaseServerUnscopedBanner from "../../../Components/DatabaseServer/DatabaseServerUnscopedBanner";
import DatabaseCallingServicesCard from "../../../Components/DatabaseServer/DatabaseCallingServicesCard";
import DatabaseEngineMetricsSection from "../../../Components/DatabaseServer/DatabaseEngineMetricsSection";
import DatabaseRuntimeSection from "../../../Components/DatabaseServer/DatabaseRuntimeSection";
import { getDatabaseRunsOnRoute } from "../../../Components/DatabaseServer/DatabaseRunsOnLink";
import { DATABASE_METRIC_DESCRIPTIONS } from "../../../Components/DatabaseServer/DatabaseMetricDescriptions";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import {
  DatabaseServerScopeSource,
  getDatabaseServerEndpointScopeKeys,
  getDatabaseServerFormattedEndpoints,
  getDatabaseServerInstanceMemberKeys,
  getDatabaseServerMemberScopeKeys,
  getDatabaseServerScopeKeys,
  isDatabaseServerScoped,
  isDatabaseServerScopedByIdOnly,
} from "../Utils/DatabaseTelemetryScope";
import {
  DatabaseCallingService,
  DatabaseCallingServices,
  DatabaseEngineMetricResult,
  DatabaseQueryMetrics,
  DatabaseTimePoint,
  EMPTY_DATABASE_CALLING_SERVICES,
  EMPTY_DATABASE_QUERY_METRICS,
  fetchDatabaseCallingServices,
  fetchDatabaseEngineMetrics,
  fetchDatabaseMetricSeries,
  fetchDatabaseQueryMetrics,
} from "../Utils/DatabaseServerTelemetryQueries";
import {
  DATABASE_LIVENESS_DESCRIPTION,
  DATABASE_NOT_FOUND_MESSAGE,
  DATABASE_RUNTIME_METRICS,
  DatabaseEngineMetricsStatus,
  DatabaseHeaderIdentifier,
  DatabaseLivenessStatus,
  DatabaseRuntimePlatform,
  formatDatabaseCount,
  getDatabaseEngineLabel,
  getDatabaseEngineMetricsStatus,
  getDatabaseEngineMetricsStatusLabel,
  getDatabaseHeaderIdentifier,
  getDatabaseLivenessLabel,
  getDatabaseLivenessStatus,
  getDatabaseLivenessTone,
  getDatabaseRunsOnLabel,
  getDatabaseRuntimePlatform,
  getDatabaseWorkloadLabel,
  isDatabaseServerFound,
  isDatabaseServerLive,
} from "../Utils/DatabaseServerPresentation";

const DEFAULT_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.PAST_ONE_HOUR,
};

function formatErrorRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
}

function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  if (value < 1000) {
    return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

/*
 * A database's Overview, in three sections:
 *
 *   1. Queries from applications — rate, errors and p95 of the CLIENT spans
 *      that name one of its endpoints, and the services that send them.
 *   2. Runtime — for a database on Kubernetes / Docker / Podman: where it
 *      runs and its pods' / containers' CPU and memory.
 *   3. Engine metrics — the engine's own curated metrics (gauges, and
 *      counters as per-second rates), or a "not connected" card.
 *
 * Every query goes through Utils/DatabaseServerTelemetryQueries, scoped by
 * the database's entity keys. With no keys at all the page issues no
 * telemetry query and shows the "no telemetry scope yet" banner; a database
 * whose only key is its row key (no endpoint, no members) says above the
 * overview that only data sent with its id can show.
 */
const DatabaseServerOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [databaseServer, setDatabaseServer] = useState<DatabaseServer | null>(
    null,
  );
  const [endpoints, setEndpoints] = useState<Array<string>>([]);
  const [queryMetrics, setQueryMetrics] = useState<DatabaseQueryMetrics>(
    EMPTY_DATABASE_QUERY_METRICS,
  );
  const [callingServices, setCallingServices] =
    useState<DatabaseCallingServices>(EMPTY_DATABASE_CALLING_SERVICES);
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [engineMetrics, setEngineMetrics] = useState<
    Array<DatabaseEngineMetricResult>
  >([]);
  const [cpuSeries, setCpuSeries] = useState<Array<DatabaseTimePoint>>([]);
  const [memorySeries, setMemorySeries] = useState<Array<DatabaseTimePoint>>(
    [],
  );
  const [telemetryLoading, setTelemetryLoading] = useState<boolean>(true);
  const [chartWindow, setChartWindow] = useState<{
    start: Date;
    end: Date;
  } | null>(null);
  const [timeRange, setTimeRange] =
    useState<RangeStartAndEndDateTime>(DEFAULT_RANGE);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string>("");

  const fetchModel: (showLoader: boolean) => Promise<void> = async (
    showLoader: boolean,
  ): Promise<void> => {
    if (showLoader) {
      setIsLoading(true);
      setError("");
    } else {
      setIsRefreshing(true);
    }
    try {
      const [item, endpointResult]: [
        DatabaseServer | null,
        ListResult<DatabaseServerEndpoint>,
      ] = await Promise.all([
        ModelAPI.getItem<DatabaseServer>({
          modelType: DatabaseServer,
          id: modelId,
          select: {
            name: true,
            description: true,
            projectId: true,
            dbSystem: true,
            dbVersion: true,
            serverAddress: true,
            serverPort: true,
            discoverySource: true,
            otelCollectorStatus: true,
            collectorLastSeenAt: true,
            agentVersion: true,
            lastSeenAt: true,
            memberEntityKeys: true,
            instanceCount: true,
            kubernetesClusterId: true,
            kubernetesCluster: { name: true, clusterIdentifier: true },
            kubernetesNamespace: true,
            workloadKind: true,
            workloadName: true,
            dockerHostId: true,
            dockerHost: { name: true },
            podmanHostId: true,
            podmanHost: { name: true },
            labels: { name: true, color: true },
          },
        }),
        ModelAPI.getList<DatabaseServerEndpoint>({
          modelType: DatabaseServerEndpoint,
          query: { databaseServerId: modelId },
          select: { endpoint: true, isPrimary: true },
          sort: { isPrimary: SortOrder.Descending },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        }),
      ]);

      // A deleted or unknown id comes back as an empty model, not null.
      if (!item || !isDatabaseServerFound(item)) {
        if (showLoader) {
          setError(DATABASE_NOT_FOUND_MESSAGE);
        }
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      setDatabaseServer(item);
      setEndpoints(
        (endpointResult.data || [])
          .map((row: DatabaseServerEndpoint): string => {
            return (row.endpoint || "").toString();
          })
          .filter((value: string): boolean => {
            return value.trim().length > 0;
          }),
      );
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
    } catch (err) {
      /*
       * Keep stale data visible on a background refresh; only the initial
       * load surfaces a page-level error.
       */
      if (showLoader) {
        setError(API.getFriendlyMessage(err));
      }
    }
    setIsLoading(false);
    setIsRefreshing(false);
  };

  useEffect(() => {
    fetchModel(true).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  useEffect(() => {
    const item: DatabaseServer | null = databaseServer;
    if (!item) {
      return;
    }

    const source: DatabaseServerScopeSource = {
      projectId: item.projectId || ProjectUtil.getCurrentProjectId(),
      // The row key: engine metrics linked by oneuptime.database.server.id.
      id: modelId,
      endpoints: endpoints,
      dbSystem: item.dbSystem,
      memberEntityKeys: item.memberEntityKeys,
    };
    const allKeys: Array<string> = getDatabaseServerScopeKeys(source);
    const endpointKeys: Array<string> =
      getDatabaseServerEndpointScopeKeys(source);
    const memberKeys: Array<string> = getDatabaseServerMemberScopeKeys(source);

    /*
     * No keys: nothing is this database's yet, and an unscoped query would
     * chart the whole project. Leave every section empty.
     */
    if (!isDatabaseServerScoped(allKeys)) {
      setQueryMetrics(EMPTY_DATABASE_QUERY_METRICS);
      setCallingServices(EMPTY_DATABASE_CALLING_SERVICES);
      setEngineMetrics([]);
      setCpuSeries([]);
      setMemorySeries([]);
      setTelemetryLoading(false);
      return;
    }

    const range: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const start: Date = range.startValue;
    const end: Date = range.endValue;
    setChartWindow({ start, end });
    setTelemetryLoading(true);

    const projectId: ObjectID | null =
      item.projectId || ProjectUtil.getCurrentProjectId();
    const catalog: Array<DatabaseServerMetricDefinition> =
      getDatabaseServerMetrics(item.dbSystem);
    const platform: DatabaseRuntimePlatform | null =
      getDatabaseRuntimePlatform(item);

    // A slow wide-range fetch must not overwrite a newer, narrower one.
    let ignore: boolean = false;

    Promise.all([
      fetchDatabaseQueryMetrics({ projectId, keys: endpointKeys, start, end }),
      fetchDatabaseCallingServices({
        projectId,
        keys: endpointKeys,
        start,
        end,
      }),
      fetchDatabaseEngineMetrics({
        projectId,
        keys: allKeys,
        start,
        end,
        metrics: catalog,
      }),
      platform
        ? fetchDatabaseMetricSeries({
            projectId,
            keys: memberKeys,
            start,
            end,
            metricName: DATABASE_RUNTIME_METRICS[platform].cpu.metricName,
            aggregationType: DATABASE_RUNTIME_METRICS[platform].cpu.aggregation,
          })
        : Promise.resolve([]),
      platform
        ? fetchDatabaseMetricSeries({
            projectId,
            keys: memberKeys,
            start,
            end,
            metricName: DATABASE_RUNTIME_METRICS[platform].memory.metricName,
            aggregationType:
              DATABASE_RUNTIME_METRICS[platform].memory.aggregation,
          })
        : Promise.resolve([]),
    ])
      .then(
        async ([queries, services, engine, cpu, memory]: [
          DatabaseQueryMetrics,
          DatabaseCallingServices,
          Array<DatabaseEngineMetricResult>,
          Array<DatabaseTimePoint>,
          Array<DatabaseTimePoint>,
        ]): Promise<void> => {
          if (ignore) {
            return;
          }
          setQueryMetrics(queries);
          setCallingServices(services);
          setEngineMetrics(engine);
          setCpuSeries(cpu);
          setMemorySeries(memory);
          setTelemetryLoading(false);

          const ids: Array<string> = services.services.map(
            (service: DatabaseCallingService): string => {
              return service.serviceId;
            },
          );
          if (ids.length === 0) {
            return;
          }
          try {
            const result: ListResult<Service> = await ModelAPI.getList<Service>(
              {
                modelType: Service,
                query: {
                  _id: new Includes(
                    ids.map((id: string): ObjectID => {
                      return new ObjectID(id);
                    }),
                  ),
                },
                select: { _id: true, name: true },
                sort: {},
                skip: 0,
                limit: ids.length,
              },
            );
            if (ignore) {
              return;
            }
            const names: Record<string, string> = {};
            for (const service of result.data || []) {
              const id: string = service._id?.toString() || "";
              if (id && service.name) {
                names[id] = service.name;
              }
            }
            setServiceNames(names);
          } catch {
            // Names are decoration; the rows keep their ids.
          }
        },
      )
      .catch(() => {
        if (!ignore) {
          setTelemetryLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [databaseServer, endpoints, timeRange]);

  const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh({
    storageKey: "database-overview-auto-refresh-interval",
    onRefresh: (): void => {
      fetchModel(false).catch(() => {});
    },
  });

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!databaseServer) {
    return <ErrorMessage message={DATABASE_NOT_FOUND_MESSAGE} />;
  }

  const r: DatabaseServer = databaseServer;
  const m: DatabaseQueryMetrics = queryMetrics;
  const source: DatabaseServerScopeSource = {
    projectId: r.projectId || ProjectUtil.getCurrentProjectId(),
    id: modelId,
    endpoints: endpoints,
    dbSystem: r.dbSystem,
    memberEntityKeys: r.memberEntityKeys,
  };
  const isScoped: boolean = isDatabaseServerScoped(
    getDatabaseServerScopeKeys(source),
  );
  // Only its row key: only data sent with its id can show.
  const isIdOnly: boolean = isDatabaseServerScopedByIdOnly(source);
  /*
   * Pods / containers only: a Deployment-backed database also has its
   * Deployment's key among its members, which is no pod.
   */
  const memberCount: number = getDatabaseServerInstanceMemberKeys({
    ...source,
    kubernetesClusterIdentifier: r.kubernetesCluster?.clusterIdentifier,
    kubernetesNamespace: r.kubernetesNamespace,
    workloadKind: r.workloadKind,
    workloadName: r.workloadName,
  }).length;
  const formattedEndpoints: Array<string> =
    getDatabaseServerFormattedEndpoints(source);

  const engineLabel: string = getDatabaseEngineLabel(r.dbSystem);
  const engineStatus: DatabaseEngineMetricsStatus =
    getDatabaseEngineMetricsStatus(r);
  const platform: DatabaseRuntimePlatform | null =
    getDatabaseRuntimePlatform(r);
  const runsOn: string = getDatabaseRunsOnLabel(r);
  const workload: string = getDatabaseWorkloadLabel(r);
  // Its endpoint — or, for a workload with none, the workload, so labelled.
  const headerIdentifier: DatabaseHeaderIdentifier | null =
    getDatabaseHeaderIdentifier(r, formattedEndpoints);
  // Seen by any source lately — deliberately not the engine-metrics words.
  const liveness: DatabaseLivenessStatus = getDatabaseLivenessStatus(
    r.lastSeenAt,
  );
  const hasQueries: boolean = m.total > 0;
  // The cluster / host page, when the database runs on one.
  const runsOnRoute: Route | null = getDatabaseRunsOnRoute(r);

  const populate: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, { modelId });
  };

  const chips: Array<ResourceOverviewChip> = [
    {
      icon: IconProp.Database,
      label: r.dbVersion ? `${engineLabel} ${r.dbVersion}` : engineLabel,
    },
    {
      icon: IconProp.Search,
      label: getDatabaseServerDiscoverySourceLabel(r.discoverySource),
    },
    {
      icon: IconProp.ChartBar,
      label: `Engine metrics: ${getDatabaseEngineMetricsStatusLabel(engineStatus)}`,
    },
  ];
  if (platform) {
    chips.push({ icon: IconProp.Cube, label: runsOn });
  }

  const tiles: Array<ResourceOverviewTile> = [
    {
      title: "Queries",
      value: hasQueries ? formatDatabaseCount(m.total) : "—",
      icon: IconProp.Workflow,
      iconColor: "sky",
      loading: telemetryLoading,
      sublabel: "from applications, selected range",
      to: populate(PageMap.DATABASE_SERVER_VIEW_TRACES),
      description: DATABASE_METRIC_DESCRIPTIONS.queries,
    },
    {
      title: "Error rate",
      value: formatErrorRate(m.errorRatePercent),
      icon: IconProp.Alert,
      iconColor: "rose",
      loading: telemetryLoading,
      sublabel: hasQueries
        ? `${formatDatabaseCount(m.errors)} failed queries`
        : undefined,
      percent: m.errorRatePercent,
      higherIsBetter: false,
      thresholds: { warn: 1, danger: 5 },
      description: DATABASE_METRIC_DESCRIPTIONS.errorRate,
    },
    {
      title: "p95 query latency",
      value: formatMs(m.p95DurationMs),
      icon: IconProp.Clock,
      iconColor: "emerald",
      loading: telemetryLoading,
      sublabel: "every query in the range, as the applications measure it",
      description: DATABASE_METRIC_DESCRIPTIONS.p95Latency,
    },
    {
      title: "Calling services",
      value: telemetryLoading
        ? "—"
        : formatDatabaseCount(callingServices.total),
      icon: IconProp.SquareStack,
      iconColor: "violet",
      loading: telemetryLoading,
      sublabel: "services that queried it",
      description: DATABASE_METRIC_DESCRIPTIONS.callingServices,
    },
  ];

  const charts: ReactElement = (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ChartCard
        title="Queries from applications"
        description={DATABASE_METRIC_DESCRIPTIONS.queriesChart}
        icon={IconProp.Workflow}
        iconColor="sky"
        series={
          [
            { seriesName: "Queries", data: m.countSeries },
            { seriesName: "Errors", data: m.errorSeries },
          ] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`database-${modelId.toString()}`}
        showLegend={true}
        loading={telemetryLoading && m.countSeries.length === 0}
      />
      <ChartCard
        title="p95 query latency"
        description={DATABASE_METRIC_DESCRIPTIONS.p95Chart}
        icon={IconProp.Clock}
        iconColor="emerald"
        series={
          [{ seriesName: "p95", data: m.p95Series }] as Array<SeriesPoint>
        }
        windowStart={chartWindow?.start ?? null}
        windowEnd={chartWindow?.end ?? null}
        syncId={`database-${modelId.toString()}`}
        yLegend="ms"
        yFormatter={(value: number): string => {
          return formatMs(value);
        }}
        loading={telemetryLoading && m.p95Series.length === 0}
      />
    </div>
  );

  const quickLinks: Array<ResourceOverviewQuickLink> = [
    {
      title: "Traces",
      description: "The queries applications send this database",
      to: populate(PageMap.DATABASE_SERVER_VIEW_TRACES),
      icon: IconProp.Workflow,
    },
    {
      title: "Logs",
      description: "Engine logs, query samples and pod / container logs",
      to: populate(PageMap.DATABASE_SERVER_VIEW_LOGS),
      icon: IconProp.Terminal,
    },
    {
      title: "Metrics",
      description: "Every engine and client metric for this database",
      to: populate(PageMap.DATABASE_SERVER_VIEW_METRICS),
      icon: IconProp.ChartBar,
    },
    {
      title: "Endpoints",
      description: "The host:port names this database is matched by",
      to: populate(PageMap.DATABASE_SERVER_VIEW_ENDPOINTS),
      icon: IconProp.Link,
    },
    {
      title: "Owners",
      description: "Who is responsible for this database",
      to: populate(PageMap.DATABASE_SERVER_VIEW_OWNERS),
      icon: IconProp.Team,
    },
  ];
  if (runsOnRoute) {
    quickLinks.unshift({
      title: runsOn,
      description:
        platform === DatabaseRuntimePlatform.Kubernetes
          ? "The Kubernetes cluster this database runs on"
          : "The container host this database runs on",
      to: runsOnRoute,
      icon: IconProp.Cube,
    });
  }

  const detailRows: Array<ResourceOverviewDetailRow> = [
    { label: "Engine (db.system.name)", value: r.dbSystem },
    { label: "Version", value: r.dbVersion },
    {
      label: "Discovered from",
      value: getDatabaseServerDiscoverySourceLabel(r.discoverySource),
    },
    {
      label: "Endpoints",
      value: formattedEndpoints.join(", ") || undefined,
      mono: true,
    },
    { label: "Runs on", value: platform ? runsOn : undefined },
    { label: "Workload", value: workload || undefined, mono: true },
    {
      label: "Engine metrics",
      value: getDatabaseEngineMetricsStatusLabel(engineStatus),
    },
    { label: "Agent version", value: r.agentVersion },
    {
      label: "Engine metrics last received",
      value: r.collectorLastSeenAt
        ? OneUptimeDate.getDateAsLocalFormattedString(r.collectorLastSeenAt)
        : undefined,
    },
    { label: "Database ID", value: modelId.toString(), mono: true },
  ];

  return (
    <Fragment>
      {!isScoped || isIdOnly ? (
        <div className="mb-6">
          <DatabaseServerUnscopedBanner
            modelId={modelId}
            variant={isScoped ? "id-only" : "unscoped"}
          />
        </div>
      ) : (
        <></>
      )}

      <ResourceOverview
        icon={IconProp.Database}
        title={(r.name as string) || engineLabel}
        identifier={headerIdentifier?.value || ""}
        identifierLabel={headerIdentifier?.label || "endpoint"}
        status={isDatabaseServerLive(r.lastSeenAt) ? "active" : "inactive"}
        statusLabel={getDatabaseLivenessLabel(liveness)}
        statusTone={getDatabaseLivenessTone(liveness)}
        statusDescription={DATABASE_LIVENESS_DESCRIPTION}
        lastSeenAt={r.lastSeenAt}
        description={r.description as string}
        chips={chips}
        tiles={tiles}
        charts={charts}
        controls={
          <AutoRefreshControl
            autoRefreshInterval={autoRefreshInterval}
            onAutoRefreshIntervalChange={setAutoRefreshInterval}
            onManualRefresh={(): void => {
              fetchModel(false).catch(() => {});
            }}
            isRefreshing={isRefreshing}
            lastRefreshedAt={lastRefreshedAt}
            timeRangePicker={
              <TelemetryTimeRangePicker
                value={timeRange}
                onChange={(value: RangeStartAndEndDateTime): void => {
                  setTimeRange(value);
                }}
              />
            }
          />
        }
        quickLinks={quickLinks}
        detailRows={detailRows}
        labels={r.labels}
      />

      <div className="mt-6">
        <ResourceActivityCards
          modelId={modelId}
          resourceQueryKey="databaseServers"
          refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
          incidentsRoute={populate(PageMap.DATABASE_SERVER_VIEW_INCIDENTS)}
          alertsRoute={populate(PageMap.DATABASE_SERVER_VIEW_ALERTS)}
          scheduledMaintenanceRoute={populate(
            PageMap.DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE,
          )}
        />
      </div>

      <div className="mt-6">
        <DatabaseCallingServicesCard
          services={callingServices.services}
          totalServices={callingServices.total}
          serviceNames={serviceNames}
          isLoading={telemetryLoading}
        />
      </div>

      {platform ? (
        <div className="mt-6">
          <DatabaseRuntimeSection
            modelId={modelId}
            platform={platform}
            source={r}
            instanceCount={
              typeof r.instanceCount === "number" ? r.instanceCount : null
            }
            memberCount={memberCount}
            cpuSeries={cpuSeries}
            memorySeries={memorySeries}
            isLoading={telemetryLoading}
            windowStart={chartWindow?.start ?? null}
            windowEnd={chartWindow?.end ?? null}
          />
        </div>
      ) : (
        <></>
      )}

      <div className="mt-6">
        <DatabaseEngineMetricsSection
          modelId={modelId}
          engineLabel={engineLabel}
          status={engineStatus}
          hasCatalog={getDatabaseServerMetrics(r.dbSystem).length > 0}
          dbSystem={r.dbSystem}
          lastReceivedAt={
            r.collectorLastSeenAt ? new Date(r.collectorLastSeenAt) : null
          }
          results={engineMetrics}
          isLoading={telemetryLoading && isScoped}
          windowStart={chartWindow?.start ?? null}
          windowEnd={chartWindow?.end ?? null}
        />
      </div>
    </Fragment>
  );
};

export default DatabaseServerOverview;
