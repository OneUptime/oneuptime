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
import DatabaseServerWorkloadBadge from "../../../Components/DatabaseServer/DatabaseServerWorkloadBadge";
import { getKubernetesDatabaseWorkloadCandidates } from "../../../Components/DatabaseServer/DatabaseWorkloadLookup";
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
import { KubernetesDeploymentObject } from "../Utils/KubernetesObjectParser";
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

const KubernetesClusterDeploymentDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const deploymentName: string = Navigation.getLastParamAsString();
  // Which one: names repeat across namespaces.
  const namespaceParam: string | undefined = getKubernetesNamespaceParam();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] =
    useState<KubernetesDeploymentObject | null>(null);
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

  // Fetch the K8s deployment object for overview tab
  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesDeploymentObject | null =
          await fetchLatestK8sObject<KubernetesDeploymentObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "deployments",
            resourceName: deploymentName,
            namespace: namespaceParam,
          });
        setObjectData(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, deploymentName, namespaceParam]);

  // Per-node allocatable CPU — denominator for the true CPU% transform.
  const allocatable: NodeAllocatableCpu | null = useNodeAllocatableCpu(
    cluster?.clusterIdentifier || undefined,
  );

  /*
   * The deployment's Events and those of what it runs, read as the page
   * opens: the Events tab says how many warnings there are before it
   * is opened. Read once the deployment is known, for its namespace.
   */
  const eventsTab: Tab = useKubernetesEventsTab({
    clusterIdentifier: cluster?.clusterIdentifier || "",
    clusterId: modelId,
    scope: isLoadingObject
      ? null
      : {
          kind: "workload",
          workloadKind: KubernetesWorkloadKind.Deployment,
          name: deploymentName,
          namespace: objectData?.metadata.namespace,
        },
    title: "Deployment Events",
    description:
      "Kubernetes events for this deployment and its pods in the last 24 hours.",
    resourceKind: "Deployment",
  });

  /*
   * The Deployment as the cluster's rules read it, with what it runs: its
   * hero, what needs attention on it and its Pods tab (KubernetesPartFacts).
   */
  const partState: KubernetesPartState = useKubernetesPart({
    clusterId: modelId,
    kind: "Deployment",
    name: deploymentName,
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
    objectData?.metadata.namespace || namespaceParam || undefined;

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
      metricVariable: "deployment_cpu",
      title: "Pod CPU Utilization",
      description: translator.translateTemplate(
        "CPU usage as a percentage of node allocatable CPU for pods in deployment {{deploymentName}}",
        { deploymentName: deploymentName },
      ),
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.deployment.name": deploymentName,
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
      metricVariable: "deployment_memory",
      title: "Pod Memory Usage",
      description: translator.translateTemplate(
        "Memory usage for pods in deployment {{deploymentName}}",
        { deploymentName: deploymentName },
      ),
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.deployment.name": deploymentName,
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
   * What Kubernetes reports about the Deployment, in one Details card under
   * the hero. Its rollout reads in the hero, by the cluster's rules
   * ("Rolling out", "2 of 3 available"): a Rollout Status here said "In
   * Progress" for a finished rollout one crash-looping replica short.
   */
  const summaryFields: Array<SummaryField> = [
    { title: "Name", value: deploymentName, copyText: deploymentName },
  ];

  if (objectData) {
    const desired: number = objectData.spec.replicas;
    const ready: number = objectData.status.readyReplicas ?? 0;
    const available: number = objectData.status.availableReplicas ?? 0;
    const unavailable: number = objectData.status.unavailableReplicas ?? 0;

    summaryFields.push(
      {
        title: "Namespace",
        value: objectData.metadata.namespace ? (
          <KubernetesResourceLink
            modelId={modelId}
            resourceKind="Namespace"
            resourceName={objectData.metadata.namespace}
          />
        ) : (
          "default"
        ),
      },
      {
        title: "Desired Replicas",
        description:
          KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentDesiredReplicas,
        value: formatKubernetesCount(desired),
      },
      {
        title: "Ready Replicas",
        description:
          KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentReadyReplicas,
        value: formatKubernetesCount(ready),
      },
      {
        title: "Available",
        description:
          KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentAvailableReplicas,
        value: formatKubernetesCount(available),
      },
    );

    if (unavailable > 0) {
      summaryFields.push({
        title: "Unavailable",
        description:
          KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentUnavailableReplicas,
        value: (
          <StatusBadge
            text={formatKubernetesCount(unavailable)}
            type={StatusBadgeType.Danger}
          />
        ),
      });
    }

    summaryFields.push(
      {
        title: "Strategy",
        value: objectData.spec.strategy || "N/A",
      },
      {
        title: "Created",
        value: objectData.metadata.creationTimestamp
          ? KubernetesResourceUtils.formatAge(
              objectData.metadata.creationTimestamp,
            )
          : "N/A",
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
            kind="Deployment"
            read={partState.read}
            error={partState.error}
            onRetry={partState.refresh}
            routes={routes}
          />
          <KubernetesOverviewTab
            summaryFields={summaryFields}
            labels={objectData?.metadata.labels || {}}
            annotations={objectData?.metadata.annotations || {}}
            conditions={objectData?.status.conditions}
            isLoading={isLoadingObject}
            detailsCard={getKubernetesPartDetailsCard("Deployment")}
          />
        </>
      ),
    },
    getKubernetesPodsTab({
      kind: "Deployment",
      part: partState,
      routes: routes,
    }),
    eventsTab,
    getKubernetesWorkloadLogsTab({
      kind: "Deployment",
      name: deploymentName,
      namespace: resourceNamespace,
      clusterIdentifier: clusterIdentifier,
      clusterName: cluster.name,
    }),
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate(
            "Deployment Metrics: {{deploymentName}}",
            { deploymentName: deploymentName },
          )}
          description="CPU and memory usage for pods in this deployment over the selected time range (the past hour by default)."
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
          resourceType="deployments"
          resourceName={deploymentName}
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
        kind="Deployment"
        name={deploymentName}
        read={partState.read}
        clusterName={cluster.name || clusterIdentifier}
        routes={routes}
        namespace={namespaceParam}
      />
      {/*
       * The Database discovered on this Deployment, if any — by its name, or
       * the cluster its labels place it in (a pooler an operator labels as
       * part of a cluster links to that cluster's database). Asked once the
       * object (and so its namespace and labels) has loaded.
       */}
      <DatabaseServerWorkloadBadge
        resourceLabel="Deployment"
        target={
          isLoadingObject
            ? null
            : {
                platform: "kubernetes",
                parentId: modelId,
                namespace: objectData?.metadata.namespace,
                ...getKubernetesDatabaseWorkloadCandidates({
                  kind: "Deployment",
                  name: deploymentName,
                  namespace: objectData?.metadata.namespace,
                  labels: objectData?.metadata.labels,
                }),
              }
        }
      />
      <Tabs tabs={tabs} onTabChange={() => {}} />
    </Fragment>
  );
};

export default KubernetesClusterDeploymentDetail;
