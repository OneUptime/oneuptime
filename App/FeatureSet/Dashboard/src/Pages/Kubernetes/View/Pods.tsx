import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MetricView from "../../../Components/Metrics/MetricView";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import OneUptimeDate from "Common/Types/Date";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { ChartSeries } from "Common/Types/Metrics/MetricQueryConfigData";

const KubernetesClusterPods: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

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

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -6);
  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  const getPodSeries = (data: AggregateModel): ChartSeries => {
    const attributes: Record<string, unknown> =
      (data["attributes"] as Record<string, unknown>) || {};
    const podName: string =
      (attributes["k8s.pod.name"] as string) || "Unknown Pod";
    const namespace: string =
      (attributes["k8s.namespace.name"] as string) || "";
    return { title: namespace ? `${namespace}/${podName}` : podName };
  };

  const podCpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_cpu",
      title: "Pod CPU Utilization",
      description: "CPU utilization by pod",
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getPodSeries,
  };

  const podMemoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_memory",
      title: "Pod Memory Usage",
      description: "Memory usage by pod",
      legend: "Memory",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getPodSeries,
  };

  const podNetworkRxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_network_rx",
      title: "Pod Network Receive",
      description: "Network bytes received by pod",
      legend: "Network RX",
      legendUnit: "bytes/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.network.io.receive",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getPodSeries,
  };

  const podNetworkTxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_network_tx",
      title: "Pod Network Transmit",
      description: "Network bytes transmitted by pod",
      legend: "Network TX",
      legendUnit: "bytes/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.network.io.transmit",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getPodSeries,
  };

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [
      podCpuQuery,
      podMemoryQuery,
      podNetworkRxQuery,
      podNetworkTxQuery,
    ],
    formulaConfigs: [],
  });

  return (
    <Fragment>
      <MetricView
        data={metricViewData}
        hideQueryElements={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData({
            ...data,
            queryConfigs: [
              podCpuQuery,
              podMemoryQuery,
              podNetworkRxQuery,
              podNetworkTxQuery,
            ],
            formulaConfigs: [],
          });
        }}
      />
    </Fragment>
  );
};

export default KubernetesClusterPods;
