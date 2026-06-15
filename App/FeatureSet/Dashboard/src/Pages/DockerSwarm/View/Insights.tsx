import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import DockerSwarmCluster from "Common/Models/DatabaseModels/DockerSwarmCluster";
import Card from "Common/UI/Components/Card/Card";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { formatBytes } from "../Utils/DockerSwarmResourceUtils";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import InBetween from "Common/Types/BaseDatabase/InBetween";

/*
 * Curated MetricView presets sharing one time-range state — explicitly
 * NOT computed recommendations (the Proxmox Insights precedent,
 * Pages/Proxmox/View/Insights.tsx). Every section scopes to this cluster
 * the SAME way Pages/DockerSwarm/View/Metrics.tsx does: by the single
 * `resource.docker.swarm.cluster.name` resource attribute that the
 * OneUptime Docker Swarm agent stamps. There is NO container.runtime
 * attribute and there are NO docker_swarm_* / pve_* metrics — the only
 * metrics that arrive are the docker_stats receiver's container.* series
 * (container.cpu.utilization, container.memory.usage.total,
 * container.memory.percent, container.pids.count, container.uptime), so
 * the presets below target those names verbatim. `container.cpu.utilization`
 * is already a host-CPU percentage (0–100), so unlike Proxmox's
 * pve_cpu_usage_ratio it needs no ×100 transform.
 */

interface MetricSpec {
  variable: string;
  title: string;
  description: string;
  legend: string;
  legendUnit: string;
  metricName: string;
  aggregation: AggregationType;
  yAxisFormatter?: (value: number) => string;
}

function buildQuery(
  spec: MetricSpec,
  clusterName: string,
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: spec.variable,
      title: spec.title,
      description: spec.description,
      legend: spec.legend,
      legendUnit: spec.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: spec.metricName,
        attributes: {
          "resource.docker.swarm.cluster.name": clusterName,
        },
        aggegationType: spec.aggregation,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: spec.yAxisFormatter,
  };
}

function buildMetricViewData(
  queries: Array<MetricQueryConfigData>,
  startAndEndDate: InBetween<Date>,
): MetricViewData {
  return {
    startAndEndDate,
    queryConfigs: queries,
    formulaConfigs: [],
  };
}

interface SectionProps {
  title: string;
  description: string;
  icon: IconProp;
  data: MetricViewData;
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (newTimeRange: RangeStartAndEndDateTime) => void;
}

const InsightsSection: FunctionComponent<SectionProps> = (
  props: SectionProps,
): ReactElement => {
  return (
    <Card
      title={
        <div className="flex items-center gap-2">
          <Icon icon={props.icon} className="h-5 w-5 text-gray-500" />
          <span>{props.title}</span>
        </div>
      }
      description={props.description}
      rightElement={
        <RangeStartAndEndDateView
          dashboardStartAndEndDate={props.timeRange}
          onChange={props.onTimeRangeChange}
        />
      }
    >
      <MetricView
        data={props.data}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        onChange={() => {}}
      />
    </Card>
  );
};

/*
 * Cluster-wide CPU and memory pressure. Avg aggregation grouped by the
 * datapoint attributes gives one line per container (task), so spikes on
 * any single task stay visible rather than being averaged away.
 */
function getComputeQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "cluster_cpu_utilization",
        title: "Cluster CPU Utilization",
        description:
          "container.cpu.utilization (host-CPU percent), one line per task.",
        legend: "CPU",
        legendUnit: "%",
        metricName: "container.cpu.utilization",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "cluster_memory_percent",
        title: "Cluster Memory Utilization",
        description:
          "container.memory.percent (percent of each task's memory limit), one line per task.",
        legend: "Memory",
        legendUnit: "%",
        metricName: "container.memory.percent",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
  ];
}

/*
 * Absolute memory bytes used per task, formatted as KiB/MiB/GiB on the
 * y axis via the shared formatBytes helper.
 */
function getMemoryQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "cluster_memory_usage",
        title: "Task Memory Usage",
        description: "container.memory.usage.total (bytes), one line per task.",
        legend: "Memory",
        legendUnit: "",
        metricName: "container.memory.usage.total",
        aggregation: AggregationType.Avg,
        yAxisFormatter: formatBytes,
      },
      cluster,
    ),
  ];
}

/*
 * "Top tasks" views: Max aggregation grouped by the datapoint attributes
 * (resource.container.name distinguishes each task) keeps the hottest task
 * from being diluted by idle ones — the same convention the Docker monitor
 * alert templates use (Content/en/monitor/docker-monitor.md).
 */
function getTopTaskQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "top_tasks_cpu",
        title: "Top Tasks by CPU",
        description:
          "Peak container.cpu.utilization per task (Max), so the busiest tasks stand out.",
        legend: "CPU",
        legendUnit: "%",
        metricName: "container.cpu.utilization",
        aggregation: AggregationType.Max,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "top_tasks_memory",
        title: "Top Tasks by Memory",
        description:
          "Peak container.memory.usage.total per task (Max), so the hungriest tasks stand out.",
        legend: "Memory",
        legendUnit: "",
        metricName: "container.memory.usage.total",
        aggregation: AggregationType.Max,
        yAxisFormatter: formatBytes,
      },
      cluster,
    ),
  ];
}

/*
 * Process counts per task. A runaway pid count is an early signal of a
 * fork bomb or a leaking worker pool before memory pressure shows up.
 */
function getProcessQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "task_pids",
        title: "Task Process Count",
        description: "container.pids.count (processes per task).",
        legend: "Processes",
        legendUnit: "",
        metricName: "container.pids.count",
        aggregation: AggregationType.Avg,
      },
      cluster,
    ),
  ];
}

const DockerSwarmClusterInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<DockerSwarmCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_HOUR,
  });

  const [startAndEndDate, setStartAndEndDate] = useState<InBetween<Date>>(
    RangeStartAndEndDateTimeUtil.getStartAndEndDate({
      range: TimeRange.PAST_ONE_HOUR,
    }),
  );

  const handleTimeRangeChange: (
    newTimeRange: RangeStartAndEndDateTime,
  ) => void = useCallback((newTimeRange: RangeStartAndEndDateTime): void => {
    setTimeRange(newTimeRange);
    setStartAndEndDate(
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(newTimeRange),
    );
  }, []);

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: DockerSwarmCluster | null = await ModelAPI.getItem({
        modelType: DockerSwarmCluster,
        id: modelId,
        select: {
          name: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster?.name) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterName: string = cluster.name;

  const computeData: MetricViewData = buildMetricViewData(
    getComputeQueries(clusterName),
    startAndEndDate,
  );
  const memoryData: MetricViewData = buildMetricViewData(
    getMemoryQueries(clusterName),
    startAndEndDate,
  );
  const topTaskData: MetricViewData = buildMetricViewData(
    getTopTaskQueries(clusterName),
    startAndEndDate,
  );
  const processData: MetricViewData = buildMetricViewData(
    getProcessQueries(clusterName),
    startAndEndDate,
  );

  return (
    <Fragment>
      <InsightsSection
        title="Compute"
        description="CPU and memory utilization across every task running in the cluster."
        icon={IconProp.CPUChip}
        data={computeData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Memory"
        description="Absolute memory bytes used per task across the cluster."
        icon={IconProp.Database}
        data={memoryData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Top Tasks"
        description="Peak CPU and memory per task so the busiest workloads stand out."
        icon={IconProp.Cube}
        data={topTaskData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Processes"
        description="Process (PID) count per task — a runaway count is an early signal of a fork bomb or leaking worker pool."
        icon={IconProp.List}
        data={processData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />
    </Fragment>
  );
};

export default DockerSwarmClusterInsights;
