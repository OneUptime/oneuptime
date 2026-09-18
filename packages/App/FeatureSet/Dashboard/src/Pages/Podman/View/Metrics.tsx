import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import EmbeddedMetricCard from "../../../Components/Metrics/EmbeddedMetricCard";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";

const PodmanHostMetrics: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [host, setHost] = useState<PodmanHost | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: PodmanHost | null = await ModelAPI.getItem({
        modelType: PodmanHost,
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

  const queryConfigs: Array<MetricQueryConfigData> = useMemo(() => {
    const hostIdentifier: string = host?.hostIdentifier || "";

    const commonAttributes: Record<string, string> = {
      "resource.host.name": hostIdentifier,
      "resource.container.runtime": "podman",
    };

    const cpuMax: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_cpu_max",
        title: "Hottest Container CPU Utilization",
        description:
          "Peak CPU utilization across all containers on this host (% of one core).",
        legend: "Max CPU %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.cpu.utilization",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const cpuAvg: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_cpu_avg",
        title: "Average Container CPU Utilization",
        description:
          "Average CPU utilization across all containers on this host.",
        legend: "Avg CPU %",
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

    const memMax: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_mem_max",
        title: "Hottest Container Memory Usage",
        description:
          "Peak memory usage (% of limit) across all containers on this host.",
        legend: "Max Memory %",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.memory.percent",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    const memTotal: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_mem_total",
        title: "Total Container Memory Usage",
        description:
          "Total memory used by all containers on this host (bytes).",
        legend: "Total Memory",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.memory.usage.total",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const netRx: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_net_rx",
        title: "Network Receive (cumulative)",
        description: "Total bytes received across all containers.",
        legend: "RX",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.network.io.usage.rx_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const netTx: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_net_tx",
        title: "Network Transmit (cumulative)",
        description: "Total bytes transmitted across all containers.",
        legend: "TX",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.network.io.usage.tx_bytes",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Sum,
          aggregateBy: {},
        },
      },
    };

    const pidsMax: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "host_pids_max",
        title: "Peak Container Process Count",
        description:
          "Highest number of processes observed inside any container.",
        legend: "Max PIDs",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: "container.pids.count",
          attributes: commonAttributes,
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    };

    return [cpuMax, cpuAvg, memMax, memTotal, netRx, netTx, pidsMax];
  }, [host?.hostIdentifier]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!host) {
    return <ErrorMessage message="Host not found." />;
  }

  return (
    <EmbeddedMetricCard
      title="Podman Host Metrics"
      description="Live CPU, memory, network, and process metrics aggregated across every container on this host. Use the time range selector to zoom in or out."
      queryConfigs={queryConfigs}
    />
  );
};

export default PodmanHostMetrics;
