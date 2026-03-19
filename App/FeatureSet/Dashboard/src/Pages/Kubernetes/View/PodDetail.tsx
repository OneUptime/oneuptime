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
import KubernetesOverviewTab from "../../../Components/Kubernetes/KubernetesOverviewTab";
import KubernetesContainersTab from "../../../Components/Kubernetes/KubernetesContainersTab";
import KubernetesEventsTab from "../../../Components/Kubernetes/KubernetesEventsTab";
import KubernetesLogsTab from "../../../Components/Kubernetes/KubernetesLogsTab";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import { KubernetesPodObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";

const KubernetesClusterPodDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const podName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [podObject, setPodObject] = useState<KubernetesPodObject | null>(null);
  const [isLoadingObject, setIsLoadingObject] = useState<boolean>(true);

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

  // Fetch the K8s pod object for overview/containers tabs
  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchPodObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesPodObject | null =
          await fetchLatestK8sObject<KubernetesPodObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "pods",
            resourceName: podName,
          });
        setPodObject(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchPodObject().catch(() => {});
  }, [cluster?.clusterIdentifier, podName]);

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

  const getContainerSeries: (data: AggregateModel) => ChartSeries = (
    data: AggregateModel,
  ): ChartSeries => {
    const attributes: Record<string, unknown> =
      (data["attributes"] as Record<string, unknown>) || {};
    const containerName: string =
      (attributes["resource.k8s.container.name"] as string) ||
      "Unknown Container";
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
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.pod.name": podName,
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
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.pod.name": podName,
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
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.pod.name": podName,
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
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.pod.name": podName,
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
  };

  // Build overview summary fields from pod object
  const summaryFields: Array<{ title: string; value: string | ReactElement }> =
    [
      { title: "Pod Name", value: podName },
      { title: "Cluster", value: clusterIdentifier },
    ];

  if (podObject) {
    summaryFields.push(
      {
        title: "Namespace",
        value: podObject.metadata.namespace || "default",
      },
      {
        title: "Status",
        value: (
          <span
            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded ${
              podObject.status.phase === "Running"
                ? "bg-green-50 text-green-700"
                : podObject.status.phase === "Succeeded"
                  ? "bg-blue-50 text-blue-700"
                  : podObject.status.phase === "Failed"
                    ? "bg-red-50 text-red-700"
                    : "bg-yellow-50 text-yellow-700"
            }`}
          >
            {podObject.status.phase || "Unknown"}
          </span>
        ),
      },
      { title: "Node", value: podObject.spec.nodeName || "N/A" },
      { title: "Pod IP", value: podObject.status.podIP || "N/A" },
      { title: "Host IP", value: podObject.status.hostIP || "N/A" },
      {
        title: "Service Account",
        value: podObject.spec.serviceAccountName || "default",
      },
      {
        title: "Created",
        value: podObject.metadata.creationTimestamp || "N/A",
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={podObject?.metadata.labels || {}}
          annotations={podObject?.metadata.annotations || {}}
          conditions={podObject?.status.conditions}
          ownerReferences={podObject?.metadata.ownerReferences}
          isLoading={isLoadingObject}
        />
      ),
    },
    {
      name: "Containers",
      children: podObject ? (
        <KubernetesContainersTab
          containers={podObject.spec.containers}
          initContainers={podObject.spec.initContainers}
          containerStatuses={podObject.status.containerStatuses}
          initContainerStatuses={podObject.status.initContainerStatuses}
        />
      ) : isLoadingObject ? (
        <PageLoader isVisible={true} />
      ) : (
        <div className="text-gray-500 text-sm p-4">
          Container details not yet available. Ensure the kubernetes-agent Helm
          chart has resourceSpecs.enabled set to true.
        </div>
      ),
    },
    {
      name: "Events",
      children: (
        <Card
          title="Pod Events"
          description="Kubernetes events for this pod in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="Pod"
            resourceName={podName}
            namespace={podObject?.metadata.namespace}
          />
        </Card>
      ),
    },
    {
      name: "Logs",
      children: (
        <Card
          title="Application Logs"
          description="Container logs for this pod from the last 6 hours."
        >
          <KubernetesLogsTab
            clusterIdentifier={clusterIdentifier}
            podName={podName}
            namespace={podObject?.metadata.namespace}
          />
        </Card>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Pod Metrics: ${podName}`}
          description="CPU, memory, and container-level resource usage for this pod over the last 6 hours."
        >
          <KubernetesMetricsTab
            queryConfigs={[podCpuQuery, podMemoryQuery, cpuQuery, memoryQuery]}
          />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      <div className="mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <InfoCard title="Pod Name" value={podName || "Unknown"} />
          <InfoCard title="Cluster" value={clusterIdentifier} />
        </div>
      </div>

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterPodDetail;
