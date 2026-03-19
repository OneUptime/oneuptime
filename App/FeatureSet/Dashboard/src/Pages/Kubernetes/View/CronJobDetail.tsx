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
import { KubernetesCronJobObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";

const KubernetesClusterCronJobDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const cronJobName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [cronJobObject, setCronJobObject] =
    useState<KubernetesCronJobObject | null>(null);
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

  // Fetch the K8s cronjob object for overview tab
  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchCronJobObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesCronJobObject | null =
          await fetchLatestK8sObject<KubernetesCronJobObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "cronjobs",
            resourceName: cronJobName,
          });
        setCronJobObject(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchCronJobObject().catch(() => {});
  }, [cluster?.clusterIdentifier, cronJobName]);

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
      metricVariable: "cronjob_cpu",
      title: "Pod CPU Utilization",
      description: `CPU utilization for pods in cronjob ${cronJobName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.cronjob.name": cronJobName,
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
      metricVariable: "cronjob_memory",
      title: "Pod Memory Usage",
      description: `Memory usage for pods in cronjob ${cronJobName}`,
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.cronjob.name": cronJobName,
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

  // Build overview summary fields from cronjob object
  const summaryFields: Array<{ title: string; value: string | ReactElement }> =
    [
      { title: "CronJob Name", value: cronJobName },
      { title: "Cluster", value: clusterIdentifier },
    ];

  if (cronJobObject) {
    summaryFields.push(
      {
        title: "Namespace",
        value: cronJobObject.metadata.namespace || "default",
      },
      {
        title: "Schedule",
        value: cronJobObject.spec.schedule || "N/A",
      },
      {
        title: "Suspend",
        value: cronJobObject.spec.suspend ? "Yes" : "No",
      },
      {
        title: "Concurrency Policy",
        value: cronJobObject.spec.concurrencyPolicy || "N/A",
      },
      {
        title: "Successful Jobs History Limit",
        value: String(cronJobObject.spec.successfulJobsHistoryLimit ?? "N/A"),
      },
      {
        title: "Failed Jobs History Limit",
        value: String(cronJobObject.spec.failedJobsHistoryLimit ?? "N/A"),
      },
      {
        title: "Last Schedule Time",
        value: cronJobObject.status.lastScheduleTime || "N/A",
      },
      {
        title: "Active Jobs",
        value: String(cronJobObject.status.activeCount ?? 0),
      },
      {
        title: "Created",
        value: cronJobObject.metadata.creationTimestamp || "N/A",
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={cronJobObject?.metadata.labels || {}}
          annotations={cronJobObject?.metadata.annotations || {}}
          isLoading={isLoadingObject}
        />
      ),
    },
    {
      name: "Events",
      children: (
        <Card
          title="CronJob Events"
          description="Kubernetes events for this cronjob in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="CronJob"
            resourceName={cronJobName}
            namespace={cronJobObject?.metadata.namespace}
          />
        </Card>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`CronJob Metrics: ${cronJobName}`}
          description="CPU and memory usage for pods in this cronjob over the last 6 hours."
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
          resourceType="cronjobs"
          resourceName={cronJobName}
          namespace={cronJobObject?.metadata.namespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterCronJobDetail;
