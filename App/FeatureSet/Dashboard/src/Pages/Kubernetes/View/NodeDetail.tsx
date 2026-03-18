import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
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

const KubernetesClusterNodeDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const nodeName: string = Navigation.getLastParam()?.toString() || "";

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -6);
  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [],
    formulaConfigs: [],
  });

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

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_cpu",
      title: "CPU Utilization",
      description: `CPU utilization for node ${nodeName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_memory",
      title: "Memory Usage",
      description: `Memory usage for node ${nodeName}`,
      legend: "Memory",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const filesystemQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_filesystem",
      title: "Filesystem Usage",
      description: `Filesystem usage for node ${nodeName}`,
      legend: "Filesystem",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.filesystem.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const networkRxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_network_rx",
      title: "Network Receive",
      description: `Network bytes received for node ${nodeName}`,
      legend: "Network RX",
      legendUnit: "bytes/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.network.io.receive",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const networkTxQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_network_tx",
      title: "Network Transmit",
      description: `Network bytes transmitted for node ${nodeName}`,
      legend: "Network TX",
      legendUnit: "bytes/s",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.network.io.transmit",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.node.name": nodeName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  return (
    <Fragment>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <InfoCard title="Node Name" value={nodeName || "Unknown"} />
        <InfoCard title="Cluster" value={clusterIdentifier} />
      </div>

      <Card
        title={`Node Metrics: ${nodeName}`}
        description="CPU, memory, filesystem, and network usage for this node over the last 6 hours."
      >
        <MetricView
          data={{
            ...metricViewData,
            queryConfigs: [
              cpuQuery,
              memoryQuery,
              filesystemQuery,
              networkRxQuery,
              networkTxQuery,
            ],
          }}
          hideQueryElements={true}
          onChange={(data: MetricViewData) => {
            setMetricViewData({
              ...data,
              queryConfigs: [
                cpuQuery,
                memoryQuery,
                filesystemQuery,
                networkRxQuery,
                networkTxQuery,
              ],
              formulaConfigs: [],
            });
          }}
        />
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterNodeDetail;
