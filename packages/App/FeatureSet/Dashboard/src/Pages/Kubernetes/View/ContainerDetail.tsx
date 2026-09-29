import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import MetricQueryConfigData, {
  ChartSeries,
} from "Common/Types/Metrics/MetricQueryConfigData";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import React, {
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
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import KubernetesLogsTab from "../../../Components/Kubernetes/KubernetesLogsTab";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "../Utils/KubernetesCpuUtils";
import useNodeAllocatableCpu from "../Utils/useNodeAllocatableCpu";

const KubernetesClusterContainerDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const containerName: string = Navigation.getLastParamAsString();

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
          /*
           * The name is display-only: the Logs tab's locked cluster chip
           * reads it instead of the machine identifier.
           */
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

  const getSeries: (data: AggregateModel) => ChartSeries = (
    data: AggregateModel,
  ): ChartSeries => {
    const attributes: Record<string, unknown> =
      (data["attributes"] as Record<string, unknown>) || {};
    const name: string =
      (attributes["resource.k8s.container.name"] as string) ||
      "Unknown Container";
    return { title: name };
  };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "container_cpu",
      title: "Container CPU Utilization",
      description: `CPU utilization for container ${containerName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "container.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.container.name": containerName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getSeries,
    transformValue: allocatable
      ? KubernetesCpuUtils.makeCpuPercentTransform(allocatable)
      : undefined,
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "container_memory",
      title: "Container Memory Usage",
      description: `Memory usage for container ${containerName}`,
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "container.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.container.name": containerName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getSeries,
    yAxisValueFormatter: KubernetesResourceUtils.formatBytesForChart,
  };

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard
              title="Container Name"
              value={containerName || "Unknown"}
            />
            <InfoCard title="Cluster" value={clusterIdentifier} />
          </div>
        </div>
      ),
    },
    {
      name: "Logs",
      children: (
        <Card
          title="Container Logs"
          description="Logs for this container in the selected time range (the past hour by default)."
        >
          {/*
           * No pod on this page: the empty podName is dropped from the
           * filter (see buildKubernetesLogsAttributeFilters), so the tab
           * scopes by cluster + container rather than asking for logs that
           * carry no pod name at all.
           */}
          <KubernetesLogsTab
            clusterIdentifier={clusterIdentifier}
            clusterName={cluster.name}
            podName=""
            containerName={containerName}
          />
        </Card>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Container Metrics: ${containerName}`}
          description="CPU and memory usage for this container over the selected time range (the past hour by default)."
        >
          <KubernetesMetricsTab queryConfigs={[cpuQuery, memoryQuery]} />
        </Card>
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterContainerDetail;
