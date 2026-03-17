import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
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
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { ChartSeries } from "Common/Types/Metrics/MetricQueryConfigData";

const KubernetesClusterOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

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
          name: true,
          clusterIdentifier: true,
          provider: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          nodeCount: true,
          podCount: true,
          namespaceCount: true,
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

  // Time range: past 6 hours
  const endDate: Date = OneUptimeDate.getCurrentDate();
  const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -6);
  const startAndEndDate: InBetween<Date> = new InBetween(startDate, endDate);

  const getNodeSeries = (data: AggregateModel): ChartSeries => {
    const attributes: Record<string, unknown> =
      (data["attributes"] as Record<string, unknown>) || {};
    const nodeName: string =
      (attributes["k8s.node.name"] as string) || "Unknown Node";
    return { title: nodeName };
  };

  // CPU utilization metric query
  const cpuQueryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_cpu",
      title: "Node CPU Utilization",
      description: "CPU utilization across cluster nodes",
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.cpu.utilization",
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
    getSeries: getNodeSeries,
  };

  // Memory utilization metric query
  const memoryQueryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "node_memory",
      title: "Node Memory Usage",
      description: "Memory usage across cluster nodes",
      legend: "Memory",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.node.memory.usage",
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
    getSeries: getNodeSeries,
  };

  // Pod CPU usage
  const podCpuQueryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_cpu",
      title: "Pod CPU Usage (Top Consumers)",
      description: "CPU usage by pod across the cluster",
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
    getSeries: (data: AggregateModel): ChartSeries => {
      const attributes: Record<string, unknown> =
        (data["attributes"] as Record<string, unknown>) || {};
      const podName: string =
        (attributes["k8s.pod.name"] as string) || "Unknown Pod";
      const namespace: string =
        (attributes["k8s.namespace.name"] as string) || "";
      return { title: namespace ? `${namespace}/${podName}` : podName };
    },
  };

  // Pod Memory usage
  const podMemoryQueryConfig: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_memory",
      title: "Pod Memory Usage (Top Consumers)",
      description: "Memory usage by pod across the cluster",
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
    getSeries: (data: AggregateModel): ChartSeries => {
      const attributes: Record<string, unknown> =
        (data["attributes"] as Record<string, unknown>) || {};
      const podName: string =
        (attributes["k8s.pod.name"] as string) || "Unknown Pod";
      const namespace: string =
        (attributes["k8s.namespace.name"] as string) || "";
      return { title: namespace ? `${namespace}/${podName}` : podName };
    },
  };

  const [metricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [
      cpuQueryConfig,
      memoryQueryConfig,
      podCpuQueryConfig,
      podMemoryQueryConfig,
    ],
    formulaConfigs: [],
  });

  const statusColor: string =
    cluster.otelCollectorStatus === "connected"
      ? "text-green-600"
      : "text-red-600";

  return (
    <Fragment>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <InfoCard
          title="Nodes"
          value={
            <span className="text-2xl font-semibold">
              {cluster.nodeCount?.toString() || "0"}
            </span>
          }
        />
        <InfoCard
          title="Pods"
          value={
            <span className="text-2xl font-semibold">
              {cluster.podCount?.toString() || "0"}
            </span>
          }
        />
        <InfoCard
          title="Namespaces"
          value={
            <span className="text-2xl font-semibold">
              {cluster.namespaceCount?.toString() || "0"}
            </span>
          }
        />
        <InfoCard
          title="Agent Status"
          value={
            <span className={`text-2xl font-semibold ${statusColor}`}>
              {cluster.otelCollectorStatus === "connected"
                ? "Connected"
                : "Disconnected"}
            </span>
          }
        />
      </div>

      {/* Cluster Details */}
      <CardModelDetail<KubernetesCluster>
        name="Cluster Overview"
        cardProps={{
          title: "Cluster Details",
          description: "Basic information about this Kubernetes cluster.",
        }}
        isEditable={false}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: KubernetesCluster,
          id: "kubernetes-cluster-overview",
          modelId: modelId,
          fields: [
            {
              field: {
                name: true,
              },
              title: "Cluster Name",
              fieldType: FieldType.Text,
            },
            {
              field: {
                clusterIdentifier: true,
              },
              title: "Cluster Identifier",
              fieldType: FieldType.Text,
            },
            {
              field: {
                provider: true,
              },
              title: "Provider",
              fieldType: FieldType.Text,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
            },
          ],
        }}
      />

      {/* Resource Utilization Charts */}
      <Card
        title="Resource Utilization"
        description="CPU and memory usage trends across the cluster over the last 6 hours."
      >
        <MetricView
          data={metricViewData}
          hideQueryElements={true}
          onChange={() => {}}
        />
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterOverview;
