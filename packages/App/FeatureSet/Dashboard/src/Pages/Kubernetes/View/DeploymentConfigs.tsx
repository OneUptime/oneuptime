import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import KubernetesResourceUtils, {
  KubernetesResource,
  PodMetricAggregate,
} from "../Utils/KubernetesResourceUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import {
  OpenShiftDeploymentConfigObject,
  OpenShiftKind,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";

const KubernetesClusterDeploymentConfigs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const [deploymentConfigList, aggregates]: [
        Array<KubernetesResource>,
        Map<string, PodMetricAggregate>,
      ] = await Promise.all([
        KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: OpenShiftKind.DeploymentConfig,
          selectFullSpec: true,
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const spec: OpenShiftDeploymentConfigObject["spec"] = (row.spec ||
              {}) as unknown as OpenShiftDeploymentConfigObject["spec"];
            const status: OpenShiftDeploymentConfigObject["status"] =
              (row.status ||
                {}) as unknown as OpenShiftDeploymentConfigObject["status"];

            resource.status = row.phase || "";
            resource.additionalAttributes["ready"] =
              `${status.readyReplicas || 0}/${spec.replicas || 0}`;
            resource.additionalAttributes["latestVersion"] = String(
              status.latestVersion || 0,
            );
            resource.additionalAttributes["strategy"] = spec.strategy || "";
          },
        }),
        KubernetesResourceUtils.fetchPodMetricsByOwner(
          modelId,
          OpenShiftKind.DeploymentConfig,
        ),
      ]);

      KubernetesResourceUtils.applyAggregateMetrics({
        resources: deploymentConfigList,
        aggregates,
      });

      setResources(deploymentConfigList);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <KubernetesResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="DeploymentConfigs"
      description="All DeploymentConfigs running in this cluster."
      resources={resources}
      emptyMessage="No DeploymentConfigs yet. They appear here once the kubernetes-agent runs with preset=openshift."
      builtInColumnDescriptions={{
        cpu: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentCpu,
        memory: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentMemory,
      }}
      columns={[
        {
          title: "Ready",
          key: "ready",
          description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.deploymentReady,
          isCount: true,
        },
        { title: "Latest Version", key: "latestVersion" },
        { title: "Strategy", key: "strategy" },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[
            PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIG_DETAIL
          ] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        ).addQueryParams({ namespace: resource.namespace });
      }}
    />
  );
};

export default KubernetesClusterDeploymentConfigs;
