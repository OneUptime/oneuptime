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
import KubernetesOverviewTab, {
  SummaryField,
} from "../../../Components/Kubernetes/KubernetesOverviewTab";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import { useKubernetesEventsTab } from "../../../Components/Kubernetes/KubernetesEventsTab";
import { KubernetesWorkloadKind } from "../../../Components/Kubernetes/KubernetesEventsModel";
import KubernetesLabelSelector from "../../../Components/Kubernetes/KubernetesLabelSelector";
import KubernetesMetricsTab from "../../../Components/Kubernetes/KubernetesMetricsTab";
import KubernetesYamlTab from "../../../Components/Kubernetes/KubernetesYamlTab";
import KubernetesResourceLink from "../../../Components/Kubernetes/KubernetesResourceLink";
import { fetchLatestK8sObject } from "../Utils/KubernetesObjectFetcher";
import KubernetesResourceUtils from "../Utils/KubernetesResourceUtils";
import { formatKubernetesCount } from "../Utils/KubernetesCount";
import KubernetesCpuUtils, {
  NodeAllocatableCpu,
} from "../Utils/KubernetesCpuUtils";
import useNodeAllocatableCpu from "../Utils/useNodeAllocatableCpu";
import { DEPLOYMENT_CONFIG_POD_ATTRIBUTE } from "../Utils/KubernetesOpenShiftResources";
import {
  OpenShiftDeploymentConfigObject,
  OpenShiftDeploymentConfigState,
  OpenShiftKind,
  OpenShiftResourceType,
  getDeploymentConfigState,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

const STATE_BADGES: Record<OpenShiftDeploymentConfigState, StatusBadgeType> = {
  [OpenShiftDeploymentConfigState.Available]: StatusBadgeType.Success,
  [OpenShiftDeploymentConfigState.ScaledToZero]: StatusBadgeType.Neutral,
  [OpenShiftDeploymentConfigState.Paused]: StatusBadgeType.Neutral,
  [OpenShiftDeploymentConfigState.Progressing]: StatusBadgeType.Warning,
  [OpenShiftDeploymentConfigState.Unavailable]: StatusBadgeType.Danger,
};

const KubernetesClusterDeploymentConfigDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const deploymentConfigName: string = Navigation.getLastParamAsString();
  // Names repeat across namespaces: the list says which.
  const namespace: string | undefined =
    Navigation.getQueryStringByName("namespace") || undefined;

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [objectData, setObjectData] =
    useState<OpenShiftDeploymentConfigObject | null>(null);
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

  useEffect(() => {
    if (!cluster?.clusterIdentifier) {
      return;
    }

    const fetchObject: () => Promise<void> = async (): Promise<void> => {
      setIsLoadingObject(true);
      try {
        const obj: OpenShiftDeploymentConfigObject | null =
          await fetchLatestK8sObject<OpenShiftDeploymentConfigObject>({
            clusterIdentifier: cluster.clusterIdentifier || "",
            resourceType: OpenShiftResourceType.DeploymentConfigs,
            resourceName: deploymentConfigName,
            namespace: namespace,
          });
        setObjectData(obj);
      } catch {
        // Graceful degradation — overview tab shows empty state
      }
      setIsLoadingObject(false);
    };

    fetchObject().catch(() => {});
  }, [cluster?.clusterIdentifier, deploymentConfigName, namespace]);

  // Per-node allocatable CPU — denominator for the true CPU% transform.
  const allocatable: NodeAllocatableCpu | null = useNodeAllocatableCpu(
    cluster?.clusterIdentifier || undefined,
  );

  /*
   * The DeploymentConfig's Events and those of what it runs - its rollouts'
   * ReplicationControllers and their pods, deployer pods included - read as
   * the page opens, so the Events tab says how many warnings there are.
   */
  const eventsTab: Tab = useKubernetesEventsTab({
    clusterIdentifier: cluster?.clusterIdentifier || "",
    clusterId: modelId,
    scope: isLoadingObject
      ? null
      : {
          kind: "workload",
          workloadKind: KubernetesWorkloadKind.DeploymentConfig,
          name: deploymentConfigName,
          namespace: objectData?.metadata.namespace || namespace,
        },
    title: "DeploymentConfig Events",
    description:
      "Kubernetes events for this DeploymentConfig and its pods in the last 24 hours.",
    resourceKind: OpenShiftKind.DeploymentConfig,
  });

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
    objectData?.metadata.namespace || namespace;

  const getSeries: (data: AggregateModel) => ChartSeries = (
    data: AggregateModel,
  ): ChartSeries => {
    const attributes: Record<string, unknown> =
      (data["attributes"] as Record<string, unknown>) || {};
    const podName: string =
      (attributes["resource.k8s.pod.name"] as string) || "Unknown Pod";
    return { title: podName };
  };

  /*
   * Its pods carry no k8s.deployment.name: k8sattributes resolves a
   * ReplicaSet to its Deployment, not a ReplicationController to its
   * DeploymentConfig. The chart's collectors extract the pod label instead.
   */
  const metricAttributes: Record<string, string> = {
    "resource.k8s.cluster.name": clusterIdentifier,
    [DEPLOYMENT_CONFIG_POD_ATTRIBUTE]: deploymentConfigName,
  };

  if (resourceNamespace) {
    metricAttributes["resource.k8s.namespace.name"] = resourceNamespace;
  }

  const cpuQuery: MetricQueryConfigData = {
    metricAliasData: {
      metricVariable: "deploymentconfig_cpu",
      title: "Pod CPU Utilization",
      description: translator.translateTemplate(
        "CPU usage as a percentage of node allocatable CPU for pods in DeploymentConfig {{deploymentConfigName}}",
        { deploymentConfigName: deploymentConfigName },
      ),
      legend: "CPU",
      legendUnit: "%",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.cpu.utilization",
        attributes: metricAttributes,
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
      metricVariable: "deploymentconfig_memory",
      title: "Pod Memory Usage",
      description: translator.translateTemplate(
        "Memory usage for pods in DeploymentConfig {{deploymentConfigName}}",
        { deploymentConfigName: deploymentConfigName },
      ),
      legend: "Memory",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "k8s.pod.memory.usage",
        attributes: metricAttributes,
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

  const summaryFields: Array<SummaryField> = [
    { title: "Name", value: deploymentConfigName },
    { title: "Cluster", value: clusterIdentifier },
  ];

  if (objectData) {
    const desired: number = objectData.spec.replicas;
    const ready: number = objectData.status.readyReplicas;
    const unavailable: number = objectData.status.unavailableReplicas;
    const state: OpenShiftDeploymentConfigState =
      getDeploymentConfigState(objectData);

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
        title: "Rollout Status",
        description:
          KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentRolloutStatus,
        value: (
          <div className="flex items-center gap-2">
            <StatusBadge text={state} type={STATE_BADGES[state]} />
            <span className="text-sm text-gray-600">
              {translator.translateTemplate("{{ready}}/{{total}} ready", {
                ready: translator.formatNumber(ready),
                total: translator.formatNumber(desired),
              })}
            </span>
          </div>
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
        value: formatKubernetesCount(objectData.status.availableReplicas),
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
        title: "Latest Version",
        value: String(objectData.status.latestVersion),
      },
      {
        title: "Strategy",
        value: objectData.spec.strategy || "N/A",
      },
      {
        title: "Triggers",
        value:
          objectData.spec.triggers.length > 0
            ? objectData.spec.triggers.join(", ")
            : "N/A",
      },
      {
        title: "Selector",
        value: <KubernetesLabelSelector selector={objectData.spec.selector} />,
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
        <KubernetesOverviewTab
          summaryFields={summaryFields}
          labels={objectData?.metadata.labels || {}}
          annotations={objectData?.metadata.annotations || {}}
          conditions={objectData?.status.conditions}
          isLoading={isLoadingObject}
        />
      ),
    },
    eventsTab,
    {
      name: "Metrics",
      children: (
        <Card
          title={translator.translateTemplate(
            "DeploymentConfig Metrics: {{deploymentConfigName}}",
            { deploymentConfigName: deploymentConfigName },
          )}
          description="CPU and memory usage for pods in this DeploymentConfig over the selected time range (the past hour by default)."
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
          resourceType={OpenShiftResourceType.DeploymentConfigs}
          resourceName={deploymentConfigName}
          namespace={resourceNamespace}
        />
      ),
    },
  ];

  return <Tabs tabs={tabs} onTabChange={() => {}} />;
};

export default KubernetesClusterDeploymentConfigDetail;
