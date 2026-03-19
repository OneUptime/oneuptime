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
import KubernetesEventsTab from "../../../Components/Kubernetes/KubernetesEventsTab";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import { KubernetesJobObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";

const KubernetesClusterJobDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const jobName: string = Navigation.getLastParamAsString();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [jobObject, setJobObject] = useState<KubernetesJobObject | null>(null);
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

  // Fetch the K8s job object for overview tab
  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchJobObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesJobObject | null =
          await fetchLatestK8sObject<KubernetesJobObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "jobs",
            resourceName: jobName,
          });
        setJobObject(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchJobObject().catch(() => {});
  }, [cluster?.clusterIdentifier, jobName]);

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
      metricVariable: "job_cpu",
      title: "Pod CPU Utilization",
      description: `CPU utilization for pods in job ${jobName}`,
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.job.name": jobName,
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
      metricVariable: "job_memory",
      title: "Pod Memory Usage",
      description: `Memory usage for pods in job ${jobName}`,
      legend: "Memory",
      legendUnit: "bytes",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.job.name": jobName,
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

  // Build overview summary fields from job object
  const summaryFields: Array<{ title: string; value: string | ReactElement }> =
    [
      { title: "Job Name", value: jobName },
      { title: "Cluster", value: clusterIdentifier },
    ];

  if (jobObject) {
    summaryFields.push(
      {
        title: "Namespace",
        value: jobObject.metadata.namespace || "default",
      },
      {
        title: "Completions",
        value: String(jobObject.spec.completions ?? "N/A"),
      },
      {
        title: "Parallelism",
        value: String(jobObject.spec.parallelism ?? "N/A"),
      },
      {
        title: "Backoff Limit",
        value: String(jobObject.spec.backoffLimit ?? "N/A"),
      },
      {
        title: "Active",
        value: String(jobObject.status.active ?? 0),
      },
      {
        title: "Succeeded",
        value: String(jobObject.status.succeeded ?? 0),
      },
      {
        title: "Failed",
        value: String(jobObject.status.failed ?? 0),
      },
      {
        title: "Start Time",
        value: jobObject.status.startTime || "N/A",
      },
      {
        title: "Completion Time",
        value: jobObject.status.completionTime || "N/A",
      },
      {
        title: "Created",
        value: jobObject.metadata.creationTimestamp || "N/A",
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={jobObject?.metadata.labels || {}}
          annotations={jobObject?.metadata.annotations || {}}
          conditions={jobObject?.status.conditions}
          isLoading={isLoadingObject}
        />
      ),
    },
    {
      name: "Events",
      children: (
        <Card
          title="Job Events"
          description="Kubernetes events for this job in the last 24 hours."
        >
          <KubernetesEventsTab
            clusterIdentifier={clusterIdentifier}
            resourceKind="Job"
            resourceName={jobName}
            namespace={jobObject?.metadata.namespace}
          />
        </Card>
      ),
    },
    {
      name: "Metrics",
      children: (
        <Card
          title={`Job Metrics: ${jobName}`}
          description="CPU and memory usage for pods in this job over the last 6 hours."
        >
          <KubernetesMetricsTab queryConfigs={[cpuQuery, memoryQuery]} />
        </Card>
      ),
    },
  ];

  return (
    <Fragment>
      <div className="mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
          <InfoCard title="Job Name" value={jobName || "Unknown"} />
          <InfoCard title="Cluster" value={clusterIdentifier} />
        </div>
      </div>

      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterJobDetail;
