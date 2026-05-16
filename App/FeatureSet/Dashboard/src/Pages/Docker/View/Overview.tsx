import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import OsVersionDisplay, {
  getOsVersionPrimary,
} from "Common/UI/Components/OsVersionDisplay/OsVersionDisplay";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

interface TopContainerRow {
  name: string;
  cpuPercent: number;
  memoryPercent: number;
}

interface OverviewStats {
  containerCount: number;
  runningCount: number;
  avgCpu: number | null;
  maxCpu: number | null;
  avgMemory: number | null;
  maxMemory: number | null;
  topByCpu: Array<TopContainerRow>;
  topByMemory: Array<TopContainerRow>;
}

const CONTAINER_NAME_ATTR: string = "resource.container.name";

const formatPercent: (value: number | null) => string = (
  value: number | null,
): string => {
  if (value === null || !isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(1)}%`;
};

const DockerHostOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [host, setHost] = useState<DockerHost | null>(null);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState<boolean>(true);
  const [statsError, setStatsError] = useState<string>("");

  const fetchStats: PromiseVoidFunction = async (): Promise<void> => {
    setIsStatsLoading(true);
    setStatsError("");
    try {
      const item: DockerHost | null = await ModelAPI.getItem({
        modelType: DockerHost,
        id: modelId,
        select: {
          name: true,
          hostIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          osType: true,
          osVersion: true,
        },
      });

      if (!item?.hostIdentifier) {
        setStatsError("Host not found.");
        setIsStatsLoading(false);
        return;
      }

      setHost(item);

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -5);

      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const buildQuery: (metricName: string) => any = (metricName: string) => {
        return {
          modelType: Metric,
          query: {
            projectId: projectId,
            name: metricName,
            time: new InBetween<Date>(startDate, endDate),
            attributes: {
              "resource.host.name": item.hostIdentifier,
              "resource.container.runtime": "docker",
            },
          },
          limit: 1000,
          skip: 0,
          select: {
            time: true,
            value: true,
            attributes: true,
          },
          sort: {
            time: SortOrder.Descending,
          },
          requestOptions: {},
        };
      };

      const [cpuResult, memResult]: [ListResult<Metric>, ListResult<Metric>] =
        await Promise.all([
          AnalyticsModelAPI.getList<Metric>(
            buildQuery("container.cpu.utilization"),
          ),
          AnalyticsModelAPI.getList<Metric>(
            buildQuery("container.memory.percent"),
          ),
        ]);

      const latestCpu: Map<string, number> = new Map();
      for (const metric of cpuResult.data) {
        const attrs: Record<string, unknown> =
          (metric.attributes as Record<string, unknown>) || {};
        const name: string = (attrs[CONTAINER_NAME_ATTR] as string) || "";
        if (!name || latestCpu.has(name)) {
          continue;
        }
        if (metric.value !== undefined) {
          latestCpu.set(name, Number(metric.value));
        }
      }

      const latestMem: Map<string, number> = new Map();
      for (const metric of memResult.data) {
        const attrs: Record<string, unknown> =
          (metric.attributes as Record<string, unknown>) || {};
        const name: string = (attrs[CONTAINER_NAME_ATTR] as string) || "";
        if (!name || latestMem.has(name)) {
          continue;
        }
        if (metric.value !== undefined) {
          latestMem.set(name, Number(metric.value));
        }
      }

      const names: Set<string> = new Set([
        ...latestCpu.keys(),
        ...latestMem.keys(),
      ]);

      const rows: Array<TopContainerRow> = [];
      for (const name of names) {
        rows.push({
          name: name,
          cpuPercent: latestCpu.get(name) ?? 0,
          memoryPercent: latestMem.get(name) ?? 0,
        });
      }

      const cpuValues: Array<number> = Array.from(latestCpu.values());
      const memValues: Array<number> = Array.from(latestMem.values());

      const avg: (arr: Array<number>) => number | null = (
        arr: Array<number>,
      ): number | null => {
        if (arr.length === 0) {
          return null;
        }
        return (
          arr.reduce((a: number, b: number) => {
            return a + b;
          }, 0) / arr.length
        );
      };
      const max: (arr: Array<number>) => number | null = (
        arr: Array<number>,
      ): number | null => {
        if (arr.length === 0) {
          return null;
        }
        return Math.max(...arr);
      };

      const topByCpu: Array<TopContainerRow> = [...rows]
        .sort((a: TopContainerRow, b: TopContainerRow) => {
          return b.cpuPercent - a.cpuPercent;
        })
        .slice(0, 5);

      const topByMemory: Array<TopContainerRow> = [...rows]
        .sort((a: TopContainerRow, b: TopContainerRow) => {
          return b.memoryPercent - a.memoryPercent;
        })
        .slice(0, 5);

      setStats({
        containerCount: names.size,
        runningCount: names.size,
        avgCpu: avg(cpuValues),
        maxCpu: max(cpuValues),
        avgMemory: avg(memValues),
        maxMemory: max(memValues),
        topByCpu: topByCpu,
        topByMemory: topByMemory,
      });
    } catch (err) {
      setStatsError(API.getFriendlyMessage(err));
    }
    setIsStatsLoading(false);
  };

  useEffect(() => {
    fetchStats().catch((err: Error) => {
      setStatsError(API.getFriendlyMessage(err));
    });
  }, []);

  const containersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_HOST_VIEW_CONTAINERS] as Route,
    { modelId: modelId },
  );

  const metricsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_HOST_VIEW_METRICS] as Route,
    { modelId: modelId },
  );

  const logsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.DOCKER_HOST_VIEW_LOGS] as Route,
    { modelId: modelId },
  );

  const renderHero: () => ReactElement | null = (): ReactElement | null => {
    if (!host) {
      return null;
    }

    const status: string = (host.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = host.lastSeenAt;
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.fromNow(lastSeenAt)
      : "never";

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    const displayName: string =
      (host.name as string | undefined) ||
      (host.hostIdentifier as string | undefined) ||
      "Untitled Docker host";

    const hostIdentifier: string =
      (host.hostIdentifier as string | undefined) || "";

    const specChips: Array<{
      icon: IconProp;
      label: string;
    }> = [];

    if (stats && stats.containerCount > 0) {
      specChips.push({
        icon: IconProp.Cube,
        label: `${stats.containerCount} container${stats.containerCount === 1 ? "" : "s"}`,
      });
    }
    if (host.osType) {
      specChips.push({
        icon: IconProp.Cog,
        label: String(host.osType),
      });
    }
    if (host.osVersion) {
      const osVersionLabel: string = getOsVersionPrimary(
        String(host.osVersion),
      );
      if (osVersionLabel) {
        specChips.push({
          icon: IconProp.Info,
          label: osVersionLabel,
        });
      }
    }

    const statusBadgeClass: string = isConnected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : "bg-amber-50 text-amber-700 ring-amber-200";
    const statusDotClass: string = isConnected
      ? "bg-emerald-500"
      : "bg-amber-500";
    const statusLabel: string = isConnected
      ? "Connected"
      : status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : "Disconnected";

    return (
      <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="relative">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-sky-50 via-white to-white"
            aria-hidden="true"
          />
          <div className="relative px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4 min-w-0">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white ring-1 ring-inset ring-sky-200 shadow-sm">
                  <Icon
                    icon={IconProp.Docker}
                    className="h-6 w-6 text-sky-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-semibold text-gray-900 truncate">
                      {displayName}
                    </h1>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${statusBadgeClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`}
                      />
                      {statusLabel}
                    </span>
                  </div>
                  {hostIdentifier && (
                    <div className="mt-1 truncate font-mono text-sm text-gray-500">
                      {hostIdentifier}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-gray-400">
                    Last seen {lastSeenText}
                  </div>
                </div>
              </div>
            </div>

            {specChips.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {specChips.map(
                  (
                    chip: { icon: IconProp; label: string },
                    idx: number,
                  ): ReactElement => {
                    return (
                      <span
                        key={`spec-${idx}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                      >
                        <Icon
                          icon={chip.icon}
                          className="h-3 w-3 text-gray-500"
                        />
                        <span className="font-medium">{chip.label}</span>
                      </span>
                    );
                  },
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSummaryCards: () => ReactElement = (): ReactElement => {
    if (isStatsLoading) {
      return (
        <div className="mb-6">
          <PageLoader isVisible={true} />
        </div>
      );
    }

    if (statsError) {
      return (
        <div className="mb-6">
          <ErrorMessage message={statsError} />
        </div>
      );
    }

    const s: OverviewStats | null = stats;
    if (!s) {
      return <Fragment />;
    }

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <InfoCard
          title="Containers"
          value={String(s.containerCount)}
          onClick={() => {
            Navigation.navigate(containersRoute);
          }}
        />
        <InfoCard title="Avg CPU" value={formatPercent(s.avgCpu)} />
        <InfoCard title="Peak CPU" value={formatPercent(s.maxCpu)} />
        <InfoCard title="Avg Memory" value={formatPercent(s.avgMemory)} />
        <InfoCard title="Peak Memory" value={formatPercent(s.maxMemory)} />
      </div>
    );
  };

  const renderTopContainers: () => ReactElement = (): ReactElement => {
    if (
      !stats ||
      (stats.topByCpu.length === 0 && stats.topByMemory.length === 0)
    ) {
      return <Fragment />;
    }

    const renderList: (
      title: string,
      rows: Array<TopContainerRow>,
      metric: "cpu" | "memory",
    ) => ReactElement = (
      title: string,
      rows: Array<TopContainerRow>,
      metric: "cpu" | "memory",
    ): ReactElement => {
      return (
        <Card
          title={title}
          description={`Top ${rows.length} containers by ${metric === "cpu" ? "CPU" : "memory"} usage (last 5 minutes).`}
        >
          <div className="divide-y divide-gray-200">
            {rows.length === 0 ? (
              <div className="py-4 text-sm text-gray-500">
                No data available yet.
              </div>
            ) : (
              rows.map((row: TopContainerRow) => {
                const value: number =
                  metric === "cpu" ? row.cpuPercent : row.memoryPercent;
                const detailRoute: Route = RouteUtil.populateRouteParams(
                  RouteMap[PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL] as Route,
                  { modelId: modelId, subModelId: row.name },
                );
                return (
                  <div
                    key={`${metric}-${row.name}`}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <Link
                        to={detailRoute}
                        className="text-sm font-medium text-indigo-600 hover:text-indigo-900 truncate block"
                      >
                        {row.name}
                      </Link>
                    </div>
                    <div className="text-sm font-semibold text-gray-900">
                      {formatPercent(value)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      );
    };

    return (
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {renderList("Top CPU Consumers", stats.topByCpu, "cpu")}
        {renderList("Top Memory Consumers", stats.topByMemory, "memory")}
      </div>
    );
  };

  const renderQuickLinks: () => ReactElement = (): ReactElement => {
    return (
      <Card
        title="Quick Links"
        description="Jump to key views for this Docker host."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Link
            to={containersRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">
              Containers
            </div>
            <div className="text-xs text-gray-500">
              Live list of running containers with CPU, memory, and network.
            </div>
          </Link>
          <Link
            to={metricsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Metrics</div>
            <div className="text-xs text-gray-500">
              Aggregated CPU, memory, network, and process charts.
            </div>
          </Link>
          <Link
            to={logsRoute}
            className="rounded-lg border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="text-sm font-semibold text-gray-900">Logs</div>
            <div className="text-xs text-gray-500">
              Structured container logs ingested via OpenTelemetry.
            </div>
          </Link>
        </div>
      </Card>
    );
  };

  return (
    <Fragment>
      {renderHero()}
      {renderSummaryCards()}
      {renderTopContainers()}
      <div className="mb-6">{renderQuickLinks()}</div>
      <CardModelDetail<DockerHost>
        name="Docker Host Details"
        cardProps={{
          title: "Docker Host Details",
          description: "Overview of this Docker host.",
        }}
        modelDetailProps={{
          modelType: DockerHost,
          id: "docker-host-details",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Name",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.name);
              },
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.description);
              },
            },
            {
              field: {
                hostIdentifier: true,
              },
              title: "Host Identifier",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.hostIdentifier);
              },
            },
            {
              field: {
                otelCollectorStatus: true,
              },
              title: "Collector Status",
              fieldType: FieldType.Text,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.otelCollectorStatus);
              },
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.lastSeenAt);
              },
            },
            {
              field: {
                osType: true,
              },
              title: "OS Type",
              fieldType: FieldType.Element,
              getElement: (item: DockerHost): ReactElement => {
                const osType: string | undefined =
                  (item.osType as string | undefined) ?? undefined;
                if (!osType) {
                  return <span className="text-sm text-gray-400">—</span>;
                }
                return (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-50 text-slate-700 text-sm font-medium ring-1 ring-inset ring-slate-200 capitalize">
                    {osType}
                  </span>
                );
              },
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.osType);
              },
            },
            {
              field: {
                osVersion: true,
              },
              title: "OS Version",
              fieldType: FieldType.Element,
              getElement: (item: DockerHost): ReactElement => {
                const osVersion: string | undefined =
                  (item.osVersion as string | undefined) ?? undefined;
                if (!osVersion) {
                  return <span className="text-sm text-gray-400">—</span>;
                }
                return <OsVersionDisplay text={osVersion} />;
              },
              showIf: (item: DockerHost): boolean => {
                return Boolean(item.osVersion);
              },
            },
            {
              field: {
                labels: {
                  name: true,
                  color: true,
                },
              },
              title: "Labels",
              fieldType: FieldType.Element,
              getElement: (item: DockerHost): ReactElement => {
                return (
                  <LabelsElement labels={item["labels"] as Array<Label>} />
                );
              },
              showIf: (item: DockerHost): boolean => {
                const labels: Array<Label> | undefined =
                  (item.labels as Array<Label> | undefined) ?? undefined;
                return Array.isArray(labels) && labels.length > 0;
              },
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default DockerHostOverview;
