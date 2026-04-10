import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import Label from "Common/Models/DatabaseModels/Label";
import LabelsElement from "Common/UI/Components/Label/Labels";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import Card from "Common/UI/Components/Card/Card";
import AlertBanner, {
  AlertBannerType,
} from "Common/UI/Components/AlertBanner/AlertBanner";
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
          hostIdentifier: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
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
      const buildQuery: (metricName: string) => any = (
        metricName: string,
      ) => {
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
        return arr.reduce((a: number, b: number) => a + b, 0) / arr.length;
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
        .sort(
          (a: TopContainerRow, b: TopContainerRow) =>
            b.cpuPercent - a.cpuPercent,
        )
        .slice(0, 5);

      const topByMemory: Array<TopContainerRow> = [...rows]
        .sort(
          (a: TopContainerRow, b: TopContainerRow) =>
            b.memoryPercent - a.memoryPercent,
        )
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

  const renderAgentBanner: () => ReactElement | null = (): ReactElement | null => {
    if (!host) {
      return null;
    }

    const status: string = (host.otelCollectorStatus as string) || "";
    const lastSeenAt: Date | undefined = host.lastSeenAt;
    const lastSeenText: string = lastSeenAt
      ? OneUptimeDate.getDateAsLocalFormattedString(lastSeenAt)
      : "never";

    const isConnected: boolean =
      status.toLowerCase() === "connected" || status.toLowerCase() === "active";

    if (isConnected) {
      return (
        <AlertBanner
          title={`Docker agent connected — last seen ${lastSeenText}`}
          type={AlertBannerType.Success}
        />
      );
    }

    return (
      <AlertBanner
        title={`Docker agent is ${status || "disconnected"} — last seen ${lastSeenText}`}
        type={AlertBannerType.Warning}
      />
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
    if (!stats || (stats.topByCpu.length === 0 && stats.topByMemory.length === 0)) {
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
      {renderAgentBanner()}
      {renderSummaryCards()}
      {renderTopContainers()}
      <div className="mb-6">{renderQuickLinks()}</div>
      <CardModelDetail<DockerHost>
        name="Docker Host Details"
        cardProps={{
          title: "Docker Host Details",
          description: "Overview of this Docker host.",
        }}
        isEditable={true}
        editButtonText="Edit Host"
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
            },
            {
              field: {
                description: true,
              },
              title: "Description",
              fieldType: FieldType.Text,
            },
            {
              field: {
                hostIdentifier: true,
              },
              title: "Host Identifier",
              fieldType: FieldType.Text,
            },
            {
              field: {
                otelCollectorStatus: true,
              },
              title: "Collector Status",
              fieldType: FieldType.Text,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                osType: true,
              },
              title: "OS Type",
              fieldType: FieldType.Text,
            },
            {
              field: {
                osVersion: true,
              },
              title: "OS Version",
              fieldType: FieldType.Text,
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
            },
          ],
        }}
      />
    </Fragment>
  );
};

export default DockerHostOverview;
