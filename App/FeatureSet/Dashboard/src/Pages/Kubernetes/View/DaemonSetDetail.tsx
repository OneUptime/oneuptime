import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";

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
import KubernetesOverviewTab from "../../../Components/Kubernetes/KubernetesOverviewTab";
import KubernetesEventsTab from "../../../Components/Kubernetes/KubernetesEventsTab";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import { KubernetesDaemonSetObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";

const KubernetesClusterDaemonSetDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const daemonSetName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] =
    useState<KubernetesDaemonSetObject | null>(null);
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

  // Fetch the K8s daemonset object for overview tab
  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesDaemonSetObject | null =
          await fetchLatestK8sObject<KubernetesDaemonSetObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "daemonsets",
            resourceName: daemonSetName,
          });
        setObjectData(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, daemonSetName]);

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
    const podName: string =
      (attributes["resource.k8s.pod.name"] as string) || "Unknown Pod";
    return { title: podName };
  };

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "daemonset_cpu",
      title: "Pod CPU Utilization",
      description: `CPU utilization for pods in daemonset ${daemonSetName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.daemonset.name": daemonSetName,
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
      metricVariable: "daemonset_memory",
      title: "Pod Memory Usage",
      description: `Memory usage for pods in daemonset ${daemonSetName}`,
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.daemonset.name": daemonSetName,
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

  // Build overview summary fields from daemonset object
  const summaryFields: Array<{ title: string; value: string | ReactElement }> =
    [
      { title: "Name", value: daemonSetName },
      { title: "Cluster", value: clusterIdentifier },
    ];

  if (objectData) {
    summaryFields.push(
      {
        title: "Namespace",
        value: objectData.metadata.namespace || "default",
      },
      {
        title: "Desired Scheduled",
        value: String(objectData.status.desiredNumberScheduled ?? "N/A"),
      },
      {
        title: "Current Scheduled",
        value: String(objectData.status.currentNumberScheduled ?? "N/A"),
      },
      {
        title: "Number Ready",
        value: (
          <StatusBadge
            text={`${objectData.status.numberReady ?? 0}/${objectData.status.desiredNumberScheduled ?? 0}`}
            type={
              (objectData.status.numberReady ?? 0) >=
              (objectData.status.desiredNumberScheduled ?? 0)
                ? StatusBadgeType.Success
                : (objectData.status.numberReady ?? 0) > 0
                  ? StatusBadgeType.Warning
                  : StatusBadgeType.Danger
            }
          />
        ),
      },
      {
        title: "Number Available",
        value: (
          <StatusBadge
            text={`${objectData.status.numberAvailable ?? 0}/${objectData.status.desiredNumberScheduled ?? 0}`}
            type={
              (objectData.status.numberAvailable ?? 0) >=
              (objectData.status.desiredNumberScheduled ?? 0)
                ? StatusBadgeType.Success
                : (objectData.status.numberAvailable ?? 0) > 0
                  ? StatusBadgeType.Warning
                  : StatusBadgeType.Danger
            }
          />
        ),
      },
      {
        title: "Update Strategy",
        value: objectData.spec.updateStrategy || "N/A",
      },
      {
        title: "Created",
        value: objectData.metadata.creationTimestamp || "N/A",
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={objectData?.metadata.labels || {}}
          annotations={objectData?.metadata.annotations || {}}
          isLoading={isLoadingObject}
        />
      ),
    },
    {
      name: "Events",
      children: (
        <Card
          title="DaemonSet Events"
          description="Kubernetes events for this daemonset in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="DaemonSet"
            resourceName={daemonSetName}
            namespace={objectData?.metadata.namespace}
          />
        </Card>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`DaemonSet Metrics: ${daemonSetName}`}
          description="CPU and memory usage for pods in this daemonset over the last 6 hours."
        >
          <KubernetesMetricsTab queryConfigs={[cpuQuery, memoryQuery]} />
        </Card>
      ),
    },
    {
      name: "YAML",
      children: (
        <KubernetesYamlTab
          clusterIdentifier={clusterIdentifier}
          resourceType="daemonsets"
          resourceName={daemonSetName}
          namespace={objectData?.metadata.namespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterDaemonSetDetail;
