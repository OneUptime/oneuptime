import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";

const CONTAINER_ID_ATTR: string = "resource.container.id";
const CONTAINER_IMAGE_ATTR: string = "resource.container.image.name";

const DockerHostContainerDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const containerName: string = Navigation.getLastParamAsString();

  const [host, setHost] = useState<DockerHost | null>(null);
  const [containerId, setContainerId] = useState<string>("");
  const [containerImage, setContainerImage] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  // Metrics time range + view state (same pattern as KubernetesMetricsTab)
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
    queryConfigs: [],
    formulaConfigs: [],
  });

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: DockerHost | null = await ModelAPI.getItem({
        modelType: DockerHost,
        id: modelId,
        select: {
          hostIdentifier: true,
          name: true,
        },
      });

      if (!item?.hostIdentifier) {
        setError("Host not found.");
        setIsLoading(false);
        return;
      }

      setHost(item);

      // Look up the container's id + image from recent docker_stats metrics.
      // filelog-ingested logs only carry resource.container.id (not name), so
      // we resolve the name -> id mapping here so the Logs tab can filter
      // precisely to THIS container.
      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveMinutes(endDate, -10);
      const projectId: string = ProjectUtil.getCurrentProjectId()!.toString();

      // Same pattern as Containers.tsx — using an `any`-typed query object
      // avoids a TS2589 "excessively deep type instantiation" error on the
      // AnalyticsModelAPI generic select inference when combined with the
      // attributes map filter.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metricQuery: any = {
        modelType: Metric,
        query: {
          projectId: projectId,
          name: "container.cpu.utilization",
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "resource.host.name": item.hostIdentifier,
            "resource.container.runtime": "docker",
            "resource.container.name": containerName,
          },
        },
        limit: 1,
        skip: 0,
        select: {
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };

      const result: ListResult<Metric> =
        await AnalyticsModelAPI.getList<Metric>(metricQuery);

      if (result.data.length > 0) {
        const attrs: Record<string, unknown> =
          (result.data[0]!.attributes as Record<string, unknown>) || {};
        setContainerId((attrs[CONTAINER_ID_ATTR] as string) || "");
        setContainerImage((attrs[CONTAINER_IMAGE_ATTR] as string) || "");
      }
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [containerName]);

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange);
    setMetricViewData((prev: MetricViewData) => {
      return {
        ...prev,
        startAndEndDate: dateRange,
      };
    });
  }, []);

  const logQuery: Query<Log> = useMemo(() => {
    const attributeFilters: Record<string, string> = {
      "resource.host.name": host?.hostIdentifier || "",
      "resource.container.runtime": "docker",
    };

    // filelog records the container id (not name) from the file path.
    // If we resolved it from docker_stats metrics, filter exactly.
    if (containerId) {
      attributeFilters["resource.container.id"] = containerId;
    }

    // Cast via `any` to sidestep a TS2589 depth error on Query<Log>.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = { attributes: attributeFilters };
    return q as Query<Log>;
  }, [host?.hostIdentifier, containerId]);

  const metricQueryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const hostIdentifier: string = host?.hostIdentifier || "";

    const commonAttributes: Record<string, string> = {
      "resource.host.name": hostIdentifier,
      "resource.container.runtime": "docker",
      "resource.container.name": containerName,
    };

    const cpuQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "container_cpu",
        title: "CPU Utilization",
        description: `CPU utilization for ${containerName}`,
        legend: "CPU %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.cpu.utilization",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const memPctQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "container_memory_percent",
        title: "Memory Usage",
        description: `Memory usage percentage for ${containerName}`,
        legend: "Memory %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.memory.percent",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    return [cpuQuery, memPctQuery];
  }, [host?.hostIdentifier, containerName]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard title="Container Name" value={containerName || "—"} />
            <InfoCard title="Image" value={containerImage || "unknown"} />
            <InfoCard
              title="Container ID"
              value={containerId ? containerId.substring(0, 12) : "unavailable"}
            />
            <InfoCard title="Host" value={host.hostIdentifier || "—"} />
          </div>
        </div>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Container Metrics: ${containerName}`}
          description="CPU and memory usage for this container."
        >
          <div>
            <div className="flex items-center justify-end mb-4">
              <RangeStartAndEndDateView
                dashboardStartAndEndDate={timeRange}
                onChange={handleTimeRangeChange}
              />
            </div>
            <MetricView
              data={{
                ...metricViewData,
                queryConfigs: metricQueryConfigs,
              }}
              hideQueryElements={true}
              hideStartAndEndDate={true}
              hideCardInCharts={true}
              onChange={(data: MetricViewData) => {
                setMetricViewData({
                  ...data,
                  queryConfigs: metricQueryConfigs,
                  formulaConfigs: [],
                });
              }}
            />
          </div>
        </Card>
      ),
    },
    {
      name: "Logs",
      children: (
        <Card
          title="Container Logs"
          description={
            containerId
              ? "Live OpenTelemetry logs for this container."
              : "Showing logs for this Docker host. Specific container filtering is unavailable until the agent reports container metadata."
          }
        >
          <DashboardLogsViewer
            id={`docker-container-logs-${containerName}`}
            logQuery={logQuery}
            showFilters={true}
            enableRealtime={true}
            noLogsMessage="No logs found for this container. Make sure the Docker agent's filelog receiver is collecting logs from /var/lib/docker/containers."
          />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default DockerHostContainerDetail;
