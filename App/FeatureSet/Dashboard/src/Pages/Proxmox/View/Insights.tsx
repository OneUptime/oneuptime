import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
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
import ProxmoxRateChart from "../../../Components/Proxmox/ProxmoxRateChart";
import { formatBytes } from "../Utils/ProxmoxResourceUtils";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";
import InBetween from "Common/Types/BaseDatabase/InBetween";

/*
 * Curated MetricView presets sharing one time-range state — explicitly
 * NOT computed recommendations (Pages/Kubernetes/View/Insights.tsx
 * precedent). Sections scope node vs guest vs storage series via the
 * `pve.scope` datapoint attribute stamped by the agent's OTTL
 * transform (WI-1) — agents installed from the current config always
 * have it.
 */

interface MetricSpec {
  variable: string;
  title: string;
  description: string;
  legend: string;
  legendUnit: string;
  metricName: string;
  aggregation: AggregationType;
  scope?: "node" | "guest" | "storage" | undefined;
  yAxisFormatter?: (value: number) => string;
  transformValue?:
    | ((value: number, dataPoint: AggregatedModel) => number)
    | undefined;
}

function buildQuery(
  spec: MetricSpec,
  clusterName: string,
): MetricQueryConfigData {
  const attributes: Record<string, string> = {
    "resource.proxmox.cluster.name": clusterName,
  };
  if (spec.scope) {
    attributes["pve.scope"] = spec.scope;
  }
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
        attributes: attributes,
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
  data?: MetricViewData | undefined;
  children?: ReactElement | undefined;
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
      {props.children ??
        (props.data ? (
          <MetricView
            data={props.data}
            hideQueryElements={true}
            hideStartAndEndDate={true}
            hideCardInCharts={true}
            onChange={() => {}}
          />
        ) : undefined)}
    </Card>
  );
};

const ratioToPercent: (value: number) => number = (value: number): number => {
  return value * 100;
};

function getComputeQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "node_cpu_ratio",
        title: "Node CPU Utilization",
        description:
          "CPU usage percent (pve_cpu_usage_ratio × 100), broken down per node.",
        legend: "CPU",
        legendUnit: "%",
        metricName: "pve_cpu_usage_ratio",
        aggregation: AggregationType.Avg,
        scope: "node",
        transformValue: ratioToPercent,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "node_memory_usage",
        title: "Node Memory Usage",
        description: "Memory bytes used, broken down per node.",
        legend: "Memory",
        legendUnit: "",
        metricName: "pve_memory_usage_bytes",
        aggregation: AggregationType.Avg,
        scope: "node",
        yAxisFormatter: formatBytes,
      },
      cluster,
    ),
  ];
}

function getGuestQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "guest_cpu_ratio",
        title: "Guest CPU Utilization",
        description:
          "CPU usage percent (pve_cpu_usage_ratio × 100), broken down per guest.",
        legend: "Guest CPU",
        legendUnit: "%",
        metricName: "pve_cpu_usage_ratio",
        aggregation: AggregationType.Avg,
        scope: "guest",
        transformValue: ratioToPercent,
      },
      cluster,
    ),
    buildQuery(
      {
        variable: "guest_memory_usage",
        title: "Guest Memory Usage",
        description: "Memory bytes used, broken down per guest.",
        legend: "Guest Memory",
        legendUnit: "",
        metricName: "pve_memory_usage_bytes",
        aggregation: AggregationType.Avg,
        scope: "guest",
        yAxisFormatter: formatBytes,
      },
      cluster,
    ),
  ];
}

function getStorageQueries(cluster: string): Array<MetricQueryConfigData> {
  return [
    buildQuery(
      {
        variable: "storage_usage",
        title: "Storage Usage",
        description: "Disk bytes used, broken down per storage volume.",
        legend: "Used",
        legendUnit: "",
        metricName: "pve_disk_usage_bytes",
        aggregation: AggregationType.Avg,
        scope: "storage",
        yAxisFormatter: formatBytes,
      },
      cluster,
    ),
  ];
}

const ProxmoxClusterInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
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
      const item: ProxmoxCluster | null = await ModelAPI.getItem({
        modelType: ProxmoxCluster,
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
  const guestData: MetricViewData = buildMetricViewData(
    getGuestQueries(clusterName),
    startAndEndDate,
  );
  const storageData: MetricViewData = buildMetricViewData(
    getStorageQueries(clusterName),
    startAndEndDate,
  );

  return (
    <Fragment>
      <InsightsSection
        title="Compute"
        description="CPU and memory usage across all nodes in the cluster."
        icon={IconProp.CPUChip}
        data={computeData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Guests"
        description="CPU and memory usage across all VMs and containers."
        icon={IconProp.Cube}
        data={guestData}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      />

      <InsightsSection
        title="Storage"
        description="Storage volume usage plus per-second disk read/write throughput across the cluster."
        icon={IconProp.Database}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      >
        <div className="space-y-6">
          <MetricView
            data={storageData}
            hideQueryElements={true}
            hideStartAndEndDate={true}
            hideCardInCharts={true}
            onChange={() => {}}
          />
          <div>
            <div className="mb-2 text-sm font-medium text-gray-700">
              Disk Throughput
            </div>
            <ProxmoxRateChart
              clusterName={clusterName}
              series={[
                { metricName: "pve_disk_read_bytes", label: "Read" },
                { metricName: "pve_disk_write_bytes", label: "Write" },
              ]}
              startDate={startAndEndDate.startValue}
              endDate={startAndEndDate.endValue}
              syncId={`proxmox-insights-${modelId.toString()}`}
            />
          </div>
        </div>
      </InsightsSection>

      <InsightsSection
        title="Network"
        description="Per-second inbound and outbound network throughput summed across all guests."
        icon={IconProp.Signal}
        timeRange={timeRange}
        onTimeRangeChange={handleTimeRangeChange}
      >
        <ProxmoxRateChart
          clusterName={clusterName}
          series={[
            { metricName: "pve_network_receive_bytes", label: "Receive" },
            { metricName: "pve_network_transmit_bytes", label: "Transmit" },
          ]}
          startDate={startAndEndDate.startValue}
          endDate={startAndEndDate.endValue}
          syncId={`proxmox-insights-${modelId.toString()}`}
        />
      </InsightsSection>
    </Fragment>
  );
};

export default ProxmoxClusterInsights;
