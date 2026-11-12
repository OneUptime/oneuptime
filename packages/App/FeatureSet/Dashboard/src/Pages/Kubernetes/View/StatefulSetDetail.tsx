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
import { KubernetesStatefulSetObject } from "../Utils/KubernetesObjectParser";
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

const KubernetesClusterStatefulSetDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const statefulSetName: string = Navigation.getLastParamAsString();
  // Which one: names repeat across namespaces.
  const namespaceParam: string | undefined = getKubernetesNamespaceParam();

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] =
    useState<KubernetesStatefulSetObject | null>(null);
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

  // Fetch the K8s statefulset object for overview tab
  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: KubernetesStatefulSetObject | null =
          await fetchLatestK8sObject<KubernetesStatefulSetObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: "statefulsets",
            resourceName: statefulSetName,
            namespace: namespaceParam,
          });
        setObjectData(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, statefulSetName, namespaceParam]);

  // Per-node allocatable CPU — denominator for the true CPU% transform.
  const allocatable: NodeAllocatableCpu | null = useNodeAllocatableCpu(
    cluster?.clusterIdentifier || undefined,
  );

  /*
   * The statefulset's Events and those of what it runs, read as the page
   * opens: the Events tab says how many warnings there are before it
   * is opened. Read once the statefulset is known, for its namespace.
   */
  const eventsTab: Tab = useKubernetesEventsTab({
    clusterIdentifier: cluster?.clusterIdentifier || "",
    clusterId: modelId,
    scope: isLoadingObject
      ? null
      : {
          kind: "workload",
          workloadKind: KubernetesWorkloadKind.StatefulSet,
          name: statefulSetName,
          namespace: objectData?.metadata.namespace,
        },
    title: "StatefulSet Events",
    description:
      "Kubernetes events for this statefulset and its pods in the last 24 hours.",
    resourceKind: "StatefulSet",
  });

  /*
   * The StatefulSet as the cluster's rules read it, with what it runs: its
   * hero, what needs attention on it and its Pods tab (KubernetesPartFacts).
   */
  const partState: KubernetesPartState = useKubernetesPart({
    clusterId: modelId,
    kind: "StatefulSet",
    name: statefulSetName,
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
      metricVariable: "statefulset_cpu",
      title: "Pod CPU Utilization",
      description: translator.translateTemplate(
        "CPU utilization for pods in statefulset {{statefulSetName}}",
        { statefulSetName: statefulSetName },
      ),
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.statefulset.name": statefulSetName,
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
      metricVariable: "statefulset_memory",
      title: "Pod Memory Usage",
      description: translator.translateTemplate(
        "Memory usage for pods in statefulset {{statefulSetName}}",
        { statefulSetName: statefulSetName },
      ),
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: {
          "resource.k8s.cluster.name": clusterIdentifier,
          "resource.k8s.statefulset.name": statefulSetName,
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
    { title: "Name", value: statefulSetName, copyText: statefulSetName },
  ];

  if (objectData) {
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
        title: "Replicas",
        description:
          KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.statefulSetReplicas,
        value: formatKubernetesCount(objectData.spec.replicas),
      },
      {
        title: "Ready Replicas",
        description:
          KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.statefulSetReadyReplicas,
        value: (
          <StatusBadge
            text={`${objectData.status.readyReplicas ?? 0}/${objectData.spec.replicas ?? 0}`}
            type={
              (objectData.status.readyReplicas ?? 0) >=
              (objectData.spec.replicas ?? 0)
                ? StatusBadgeType.Success
                : (objectData.status.readyReplicas ?? 0) > 0
                  ? StatusBadgeType.Warning
                  : StatusBadgeType.Danger
            }
          />
        ),
      },
      {
        title: "Service Name",
        value: objectData.spec.serviceName || "N/A",
      },
      {
        title: "Pod Management Policy",
        value: objectData.spec.podManagementPolicy || "N/A",
      },
      {
        title: "Update Strategy",
        value: objectData.spec.updateStrategy || "N/A",
      },
      {
        title: "Created",
        value: KubernetesResourceUtils.formatAge(
          objectData.metadata.creationTimestamp,
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
            kind="StatefulSet"
            read={partState.read}
            error={partState.error}
            onRetry={partState.refresh}
            routes={routes}
          />
          <KubernetesOverviewTab
            summaryFields={summaryFields}
            labels={objectData?.metadata.labels || {}}
            annotations={objectData?.metadata.annotations || {}}
            isLoading={isLoadingObject}
            detailsCard={getKubernetesPartDetailsCard("StatefulSet")}
          />
        </>
      ),
    },
    getKubernetesPodsTab({
      kind: "StatefulSet",
      part: partState,
      routes: routes,
    }),
    eventsTab,
    getKubernetesWorkloadLogsTab({
      kind: "StatefulSet",
      name: statefulSetName,
      namespace: resourceNamespace,
      clusterIdentifier: clusterIdentifier,
      clusterName: cluster.name,
    }),
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate(
            "StatefulSet Metrics: {{statefulSetName}}",
            { statefulSetName: statefulSetName },
          )}
          description="CPU and memory usage for pods in this statefulset over the selected time range (the past hour by default)."
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
          resourceType="statefulsets"
          resourceName={statefulSetName}
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
        kind="StatefulSet"
        name={statefulSetName}
        read={partState.read}
        clusterName={cluster.name || clusterIdentifier}
        routes={routes}
        namespace={namespaceParam}
      />
      {/*
       * The Database discovered on this StatefulSet, if any — by its name,
       * or the cluster its labels place it in (an operator's, a Helm
       * chart's, a Percona cluster's). Asked once the object (and so its
       * namespace and labels) has loaded.
       */}
      <DatabaseServerWorkloadBadge
        resourceLabel="StatefulSet"
        target={
          isLoadingObject
            ? null
            : {
                platform: "kubernetes",
                parentId: modelId,
                namespace: objectData?.metadata.namespace,
                ...getKubernetesDatabaseWorkloadCandidates({
                  kind: "StatefulSet",
                  name: statefulSetName,
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

export default KubernetesClusterStatefulSetDetail;
