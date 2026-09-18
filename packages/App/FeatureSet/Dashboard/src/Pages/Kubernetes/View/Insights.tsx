import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
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
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesNetworkThroughputChart from "./KubernetesNetworkThroughputChart";
import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "../Utils/KubernetesCpuUtils";
import useNodeAllocatableCpu from "../Utils/useNodeAllocatableCpu";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";

interface MetricSpec {
  variable: string;
  title: string;
  description: string;
  legend: string;
  legendUnit: string;
  metricName: string;
  aggregation: AggregationType;
  yAxisFormatter?: (value: number) => string;
  transformValue?:
    | ((value: number, dataPoint: AggregatedModel) => number)
    | undefined;
}

function buildQuery(
  spec: MetricSpec,
  clusterIdentifier: string,
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
          "resource.k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: spec.aggregation,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    yAxisValueFormatter: spec.yAxisFormatter,
    transformValue: spec.transformValue,
  };
}

function getSectionTitle(icon: IconProp, title: string): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <Icon icon={icon} className="h-5 w-5 text-gray-500" />
      <span>{title}</span>
    </div>
  );
}

function getNodeQueries(
  cluster: string,
  allocatable: NodeAllocatableCpu | null,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "node_cpu_utilization",
        title: "Node CPU Utilization",
        description:
          "CPU usage as a percentage of allocatable CPU, broken down per node.",
        legend: "CPU",
        legendUnit: "%",
        metricName: "k8s.node.cpu.utilization",
        aggregation: AggregationType.Avg,
        transformValue: allocatable
          ? KubernetesCpuUtils.makeCpuPercentTransform(allocatable)
          : undefined,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "node_memory_usage",
        title: "Node Memory Usage",
        description:
          "Memory bytes used across all nodes, broken down per node.",
        legend: "Memory",
        legendUnit: "",
        metricName: "k8s.node.memory.usage",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "node_filesystem_usage",
        title: "Node Filesystem Usage",
        description:
          "Filesystem bytes used across all nodes, broken down per node.",
        legend: "Filesystem",
        legendUnit: "",
        metricName: "k8s.node.filesystem.usage",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
  ];
}

function getPodQueries(
  cluster: string,
  allocatable: NodeAllocatableCpu | null,
): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "pod_cpu_utilization",
        title: "Pod CPU Utilization",
        description:
          "CPU usage as a percentage of node allocatable CPU, per pod.",
        legend: "Pod CPU",
        legendUnit: "%",
        metricName: "k8s.pod.cpu.utilization",
        aggregation: AggregationType.Avg,
        transformValue: allocatable
          ? KubernetesCpuUtils.makeCpuPercentTransform(allocatable)
          : undefined,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "pod_memory_usage",
        title: "Pod Memory Usage",
        description:
          "Memory bytes used across all pods in the cluster, summed across pods.",
        legend: "Pod Memory",
        legendUnit: "",
        metricName: "k8s.pod.memory.usage",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
  ];
}

const KubernetesClusterInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
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
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
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

  // Per-node allocatable CPU — denominator for the true CPU% transform.
  const allocatable: NodeAllocatableCpu | null = useNodeAllocatableCpu(
    cluster?.clusterIdentifier || undefined,
  );

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterIdentifier: string = cluster.clusterIdentifier || "";

  return (
    <Fragment>
      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.CPUChip, "Compute & Storage")}
        description="CPU, memory and filesystem usage across all nodes in the cluster."
        queryConfigs={getNodeQueries(clusterIdentifier, allocatable)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Signal, "Network")}
        description="Per-second inbound and outbound network throughput across all nodes."
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      >
        <KubernetesNetworkThroughputChart
          clusterIdentifier={clusterIdentifier}
          startDate={startAndEndDate.startValue}
          endDate={startAndEndDate.endValue}
        />
      </EmbeddedMetricCard>

      <EmbeddedMetricCard
        title={getSectionTitle(IconProp.Circle, "Pods")}
        description="CPU and memory usage aggregated across all pods in the cluster."
        queryConfigs={getPodQueries(clusterIdentifier, allocatable)}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
        startAndEndDate={startAndEndDate}
      />
    </Fragment>
  );
};

export default KubernetesClusterInsights;
