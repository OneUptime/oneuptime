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
import AggregateModel from "Common/Types/BaseDatabase/AggregatedModel";
import { ChartSeries } from "Common/Types/Metrics/MetricQueryConfigData";

const KubernetesClusterPodDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const podName: string = Navigation.getLastParam()?.toString() || "";

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

  const getContainerSeries = (data: AggregateModel): ChartSeries => {
    const attributes: Record<string, unknown> =
      (data["attributes"] as Record<string, unknown>) || {};
    const containerName: string =
      (attributes["k8s.container.name"] as string) || "Unknown Container";
    return { title: containerName };
  };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "container_cpu",
      title: "Container CPU Utilization",
      description: `CPU utilization for containers in pod ${podName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "container.cpu.utilization",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
          "k8s.pod.name": podName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getContainerSeries,
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "container_memory",
      title: "Container Memory Usage",
      description: `Memory usage for containers in pod ${podName}`,
      legend: "Memory",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "container.memory.usage",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
          "k8s.pod.name": podName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getContainerSeries,
  };

  const podCpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_cpu",
      title: "Pod CPU Utilization",
      description: `CPU utilization for pod ${podName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
          "k8s.pod.name": podName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const podMemoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "pod_memory",
      title: "Pod Memory Usage",
      description: `Memory usage for pod ${podName}`,
      legend: "Memory",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "k8s.cluster.name": clusterIdentifier,
          "k8s.pod.name": podName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  const [metricViewData, setMetricViewData] = useState<MetricViewData>({
    startAndEndDate: startAndEndDate,
    queryConfigs: [podCpuQuery, podMemoryQuery, cpuQuery, memoryQuery],
    formulaConfigs: [],
  });

  return (
    <Fragment>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <InfoCard title="Pod Name" value={podName || "Unknown"} />
        <InfoCard title="Cluster" value={clusterIdentifier} />
      </div>

      <Card
        title={`Pod Metrics: ${podName}`}
        description="CPU, memory, and container-level resource usage for this pod over the last 6 hours."
      >
        <MetricView
          data={metricViewData}
          hideQueryElements={true}
          onChange={(data: MetricViewData) => {
            setMetricViewData({
              ...data,
              queryConfigs: [podCpuQuery, podMemoryQuery, cpuQuery, memoryQuery],
              formulaConfigs: [],
            });
          }}
        />
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterPodDetail;
