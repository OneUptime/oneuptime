import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ProxmoxCluster from "Common/Models/DatabaseModels/ProxmoxCluster";
import Card from "Common/UI/Components/Card/Card";
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
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import RangeStartAndEndDateView from "Common/UI/Components/Date/RangeStartAndEndDateView";

const ProxmoxClusterMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<ProxmoxCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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
      const item: ProxmoxCluster | null = await ModelAPI.getItem({
        modelType: ProxmoxCluster,
        id: modelId,
        select: {
          name: true,
        },
      });

      if (!item?.name) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

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

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const clusterName: string = cluster?.name || "";

    const commonAttributes: Record<string, string> = {
      "resource.proxmox.cluster.name": clusterName,
    };

    const cpuMax: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_cpu_max",
        title: "Hottest Resource CPU Usage",
        description:
          "Peak CPU usage ratio (0–1) across all nodes and guests in this cluster.",
        legend: "Max CPU ratio",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "pve_cpu_usage_ratio",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const cpuAvg: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_cpu_avg",
        title: "Average CPU Usage",
        description:
          "Average CPU usage ratio (0–1) across all nodes and guests in this cluster.",
        legend: "Avg CPU ratio",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "pve_cpu_usage_ratio",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Avg,
          aggregateBy: {},
        },
      },
    };

    const memTotal: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_mem_total",
        title: "Total Memory Usage",
        description:
          "Total memory used across all nodes and guests in this cluster (bytes).",
        legend: "Total Memory",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "pve_memory_usage_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const diskTotal: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_disk_total",
        title: "Total Disk Usage",
        description:
          "Total disk space used across all storage volumes in this cluster (bytes).",
        legend: "Total Disk",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "pve_disk_usage_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const netRx: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_net_rx",
        title: "Network Receive (cumulative)",
        description: "Total bytes received across all guests in this cluster.",
        legend: "RX",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "pve_network_receive_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const netTx: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_net_tx",
        title: "Network Transmit (cumulative)",
        description:
          "Total bytes transmitted across all guests in this cluster.",
        legend: "TX",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "pve_network_transmit_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const resourcesUp: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "cluster_resources_up",
        title: "Resources Up",
        description:
          "Number of Proxmox resources (nodes and guests) reporting as up.",
        legend: "Up",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "pve_up",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    return [cpuMax, cpuAvg, memTotal, diskTotal, netRx, netTx, resourcesUp];
  }, [cluster?.name]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Card
      title="Proxmox Cluster Metrics"
      description="Live CPU, memory, disk, network, and availability metrics aggregated across this Proxmox cluster. Use the time range selector to zoom in or out."
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
            queryConfigs: queryConfigs,
          }}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          hideCardInCharts={true}
          onChange={(data: MetricViewData) => {
            setMetricViewData({
              ...data,
              queryConfigs: queryConfigs,
              formulaConfigs: [],
            });
          }}
        />
      </div>
    </Card>
  );
};

export default ProxmoxClusterMetrics;
