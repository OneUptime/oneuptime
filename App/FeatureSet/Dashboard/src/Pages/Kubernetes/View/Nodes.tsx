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

const KubernetesClusterNodes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [metricViewData, setMetricViewData] = useState<MetricViewData | null>(
    null,
  );

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

  useEffect(() => {
    if (!cluster) {
      return;
    }

    const clusterIdentifier: string = cluster.clusterIdentifier || "";
    const endDate: Date = OneUptimeDate.getCurrentDate();
    const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -6);
    const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

    const getNodeSeries = (data: AggregateModel): ChartSeries => {
      const attributes: Record<string, unknown> =
        (data["attributes"] as Record<string, unknown>) || {};
      const nodeName: string =
        (attributes["resource.k8s.node.name"] as string) || "Unknown Node";
      return { title: nodeName };
    };

    const nodeCpuQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "node_cpu",
        title: "Node CPU Utilization",
        description: "CPU utilization by node",
        legend: "CPU",
        legendUnit: "%",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.node.cpu.utilization",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
      getSeries: getNodeSeries,
    };

    const nodeMemoryQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "node_memory",
        title: "Node Memory Usage",
        description: "Memory usage by node",
        legend: "Memory",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.node.memory.usage",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
      getSeries: getNodeSeries,
    };

    const nodeFilesystemQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "node_filesystem",
        title: "Node Filesystem Usage",
        description: "Filesystem usage by node",
        legend: "Filesystem",
        legendUnit: "bytes",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.node.filesystem.usage",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
      getSeries: getNodeSeries,
    };

    const nodeNetworkRxQuery: MetricQueryConfigData = {
      metricAliasData: {
        metricVariable: "node_network_rx",
        title: "Node Network Receive",
        description: "Network bytes received by node",
        legend: "Network RX",
        legendUnit: "bytes/s",
      },
      metricQueryData: {
        filterData: {
          metricName: "k8s.node.network.io",
          attributes: {
            "resource.k8s.cluster.name": clusterIdentifier,
            "metricAttributes.direction": "receive",
          },
          aggegationType: AggregationType.Avg,
          aggregateBy: {},
        },
        groupBy: {
          attributes: true,
        },
      },
      getSeries: getNodeSeries,
    };

    setMetricViewData({
      startAndEndDate: startAndEndDate,
      queryConfigs: [
        nodeCpuQuery,
        nodeMemoryQuery,
        nodeFilesystemQuery,
        nodeNetworkRxQuery,
      ],
      formulaConfigs: [],
    });
  }, [cluster]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster || !metricViewData) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Fragment>
      <MetricView
        data={metricViewData}
        hideQueryElements={true}
        onChange={(data: MetricViewData) => {
          setMetricViewData({
            ...data,
            queryConfigs: metricViewData.queryConfigs,
            formulaConfigs: [],
          });
        }}
      />
    </Fragment>
  );
};

export default KubernetesClusterNodes;
