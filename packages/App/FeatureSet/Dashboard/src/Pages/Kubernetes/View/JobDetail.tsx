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
import KubernetesOverviewTab, {
  SummaryField,
} from "../../../Components/Kubernetes/KubernetesOverviewTab";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import { useKubernetesEventsTab } from "../../../Components/Kubernetes/KubernetesEventsTab";
import { KubernetesWorkloadKind } from "../../../Components/Kubernetes/KubernetesEventsModel";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import { KubernetesJobObject } from "../Utils/KubernetesObjectParser";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import { formatKubernetesCount } from "../Utils/KubernetesCount";
import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "../Utils/KubernetesCpuUtils";
import useNodeAllocatableCpu from "../Utils/useNodeAllocatableCpu";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import KubernetesResourceLink from "../../../Components/Kubernetes/KubernetesResourceLink";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import KubernetesPartHero from "../../../Components/Kubernetes/Part/KubernetesPartHero";
import KubernetesPartOverview from "../../../Components/Kubernetes/Part/KubernetesPartOverview";
import {
  getKubernetesPodsTab,
  getKubernetesWorkloadLogsTab,
} from "../../../Components/Kubernetes/Part/KubernetesPartTabs";
import useKubernetesPart, {
  KubernetesPartState,
} from "../Utils/UseKubernetesPart";
import {
  KubernetesPartRoutes,
  getKubernetesNamespaceParam,
  getKubernetesPartRoutes,
} from "../Utils/KubernetesPartRoutes";
import { getKubernetesPartDetailsCard } from "../Utils/KubernetesPartFacts";

const KubernetesClusterJobDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const jobName: string = Navigation.getLastParamAsString();
  // Which one: names repeat across namespaces.
  const namespaceParam: string | undefined = getKubernetesNamespaceParam();

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
          // The hero's link back to the cluster, and the Logs tab's chip.
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
            namespace: namespaceParam,
          });
        setJobObject(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchJobObject().catch(() => {});
  }, [cluster?.clusterIdentifier, jobName, namespaceParam]);

  // Per-node allocatable CPU — denominator for the true CPU% transform.
  const allocatable: NodeAllocatableCpu | null = useNodeAllocatableCpu(
    cluster?.clusterIdentifier || undefined,
  );

  /*
   * The job's Events and those of what it runs, read as the page
   * opens: the Events tab says how many warnings there are before it
   * is opened. Read once the job is known, for its namespace.
   */
  const eventsTab: Tab = useKubernetesEventsTab({
    clusterIdentifier: cluster?.clusterIdentifier || "",
    clusterId: modelId,
    scope: isLoadingObject
      ? null
      : {
          kind: "workload",
          workloadKind: KubernetesWorkloadKind.Job,
          name: jobName,
          namespace: jobObject?.metadata.namespace,
        },
    title: "Job Events",
    description:
      "Kubernetes events for this job and its pods in the last 24 hours.",
    resourceKind: "Job",
  });

  /*
   * The Job as the cluster's rules read it, with what it runs: its
   * hero, what needs attention on it and its Pods tab (KubernetesPartFacts).
   */
  const partState: KubernetesPartState = useKubernetesPart({
    clusterId: modelId,
    kind: "Job",
    name: jobName,
    namespace: namespaceParam,
  });
  const routes: KubernetesPartRoutes = getKubernetesPartRoutes(modelId);

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
  const resourceNamespace: string | undefined =
    jobObject?.metadata.namespace || namespaceParam || undefined;

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
      description: translator.translateTemplate(
        "CPU utilization for pods in job {{jobName}}",
        { jobName: jobName },
      ),
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.job.name": jobName,
          ...(resourceNamespace
            ? { "resource.k8s.namespace.name": resourceNamespace }
            : {}),
        },
        aggegationType: AggregationType.Avg,
        aggregateBy: {},
      },
      groupBy: {
        attributes: true,
      },
    },
    getSeries: getSeries,
    transformValue: KubernetesCpuUtils.makeCpuPercentTransform(allocatable),
  };

  const memoryQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "job_memory",
      title: "Pod Memory Usage",
      description: translator.translateTemplate(
        "Memory usage for pods in job {{jobName}}",
        { jobName: jobName },
      ),
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.job.name": jobName,
          ...(resourceNamespace
            ? { "resource.k8s.namespace.name": resourceNamespace }
            : {}),
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

  /*
   * What Kubernetes reports about it, in one Details card under the hero,
   * which already names its cluster and says how it is doing.
   */
  const summaryFields: Array<SummaryField> = [
    { title: "Job Name", value: jobName, copyText: jobName },
  ];

  if (jobObject) {
    summaryFields.push(
      {
        title: "Namespace",
        value: jobObject.metadata.namespace ? (
          <KubernetesResourceLink
            modelId={modelId}
            resourceKind="Namespace"
            resourceName={jobObject.metadata.namespace}
          />
        ) : (
          "default"
        ),
      },
      {
        title: "Completions",
        description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobCompletions,
        value: formatKubernetesCount(jobObject.spec.completions),
      },
      {
        title: "Parallelism",
        description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobParallelism,
        value: formatKubernetesCount(jobObject.spec.parallelism),
      },
      {
        title: "Backoff Limit",
        description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobBackoffLimit,
        value: String(jobObject.spec.backoffLimit ?? "N/A"),
      },
      {
        title: "Active",
        description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobActive,
        value: (
          <StatusBadge
            text={String(jobObject.status.active ?? 0)}
            type={
              (jobObject.status.active ?? 0) > 0
                ? StatusBadgeType.Info
                : StatusBadgeType.Neutral
            }
          />
        ),
      },
      {
        title: "Succeeded",
        description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobSucceeded,
        value: (
          <StatusBadge
            text={String(jobObject.status.succeeded ?? 0)}
            type={
              (jobObject.status.succeeded ?? 0) > 0
                ? StatusBadgeType.Success
                : StatusBadgeType.Neutral
            }
          />
        ),
      },
      {
        title: "Failed",
        description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobFailed,
        value: (
          <StatusBadge
            text={String(jobObject.status.failed ?? 0)}
            type={
              (jobObject.status.failed ?? 0) > 0
                ? StatusBadgeType.Danger
                : StatusBadgeType.Neutral
            }
          />
        ),
      },
      {
        title: "Start Time",
        value: KubernetesResourceUtils.formatTimestamp(
          jobObject.status.startTime,
        ),
      },
      {
        title: "Completion Time",
        value: KubernetesResourceUtils.formatTimestamp(
          jobObject.status.completionTime,
        ),
      },
      {
        title: "Created",
        value: KubernetesResourceUtils.formatAge(
          jobObject.metadata.creationTimestamp,
        ),
      },
    );
  }

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <>
          <KubernetesPartOverview
            clusterId={modelId}
            clusterIdentifier={clusterIdentifier}
            kind="Job"
            read={partState.read}
            error={partState.error}
            onRetry={partState.refresh}
            routes={routes}
          />
          <KubernetesOverviewTab
            summaryFields={summaryFields}
            labels={jobObject?.metadata.labels || {}}
            annotations={jobObject?.metadata.annotations || {}}
            conditions={jobObject?.status.conditions}
            isLoading={isLoadingObject}
            detailsCard={getKubernetesPartDetailsCard("Job")}
          />
        </>
      ),
    },
    getKubernetesPodsTab({ kind: "Job", part: partState, routes: routes }),
    eventsTab,
    getKubernetesWorkloadLogsTab({
      kind: "Job",
      name: jobName,
      namespace: resourceNamespace,
      clusterIdentifier: clusterIdentifier,
      clusterName: cluster.name,
    }),
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate("Job Metrics: {{jobName}}", {
            jobName: jobName,
          })}
          description="CPU and memory usage for pods in this job over the selected time range (the past hour by default)."
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
          resourceType="jobs"
          resourceName={jobName}
          namespace={resourceNamespace}
        />
      ),
    },
  ];

  return (
    <Fragment>
      {/*
       * What it is and how it is doing, in Kubernetes' own words, above its
       * tabs (KubernetesPartHero).
       */}
      <KubernetesPartHero
        kind="Job"
        name={jobName}
        read={partState.read}
        clusterName={cluster.name || clusterIdentifier}
        routes={routes}
        namespace={namespaceParam}
      />
      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterJobDetail;
