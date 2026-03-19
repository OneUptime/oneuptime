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
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import KubernetesLogsTab from "../../../Components/Kubernetes/KubernetesLogsTab";

const KubernetesClusterContainerDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const containerName: string = Navigation.getLastParam()?.toString() || "";

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
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "container_memory",
      title: "Container Memory Usage",
      description: `Memory usage for container ${containerName}`,
      legend: "Memory",
      legendUnit: "bytes",
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
  };

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <InfoCard title="Container Name" value={containerName || "Unknown"} />
            <InfoCard title="Cluster" value={clusterIdentifier} />
          </div>
        </div>
      ),
    },
    {
      name: "Logs",
      children: (
        <Card title="Container Logs" description="Logs for this container from the last 6 hours.">
          <KubernetesLogsTab
            clusterIdentifier={clusterIdentifier}
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
          description="CPU and memory usage for this container over the last 6 hours."
        >
          <KubernetesMetricsTab
            queryConfigs={[cpuQuery, memoryQuery]}
          />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      <div className="mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <InfoCard title="Container" value={containerName || "Unknown"} />
          <InfoCard title="Cluster" value={clusterIdentifier} />
        </div>
      </div>

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterContainerDetail;
