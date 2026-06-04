import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
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
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "../Utils/KubernetesCpuUtils";
import useNodeAllocatableCpu from "../Utils/useNodeAllocatableCpu";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
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
  transformValue?: (value: number, dataPoint: AggregatedModel) => number;
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

function getNetworkQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "node_network_rx",
        title: "Network Receive",
        description: "Bytes received per node across the cluster.",
        legend: "Received",
        legendUnit: "",
        metricName: "k8s.node.network.io.receive",
        aggregation: AggregationType.Sum,
        yAxisFormatter: KubernetesResourceUtils.formatBytesForChart,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "node_network_tx",
        title: "Network Transmit",
        description: "Bytes transmitted per node across the cluster.",
        legend: "Transmitted",
        legendUnit: "",
        metricName: "k8s.node.network.io.transmit",
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

  const nodeData: MetricViewData = buildMetricViewData(
    getNodeQueries(clusterIdentifier),
    startAndEndDate,
  );
  const networkData: MetricViewData = buildMetricViewData(
    getNetworkQueries(clusterIdentifier),
    startAndEndDate,
  );
  const podData: MetricViewData = buildMetricViewData(
    getPodQueries(clusterIdentifier),
    startAndEndDate,
  );

  return (
    <Fragment>
      <InsightsSection
        title="Compute & Storage"
        description="CPU, memory and filesystem usage across all nodes in the cluster."
        icon={IconProp.CPUChip}
        data={nodeData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Network"
        description="Inbound and outbound network traffic across all nodes."
        icon={IconProp.Signal}
        data={networkData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Pods"
        description="CPU and memory usage aggregated across all pods in the cluster."
        icon={IconProp.Circle}
        data={podData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />
    </Fragment>
  );
};

export default KubernetesClusterInsights;
