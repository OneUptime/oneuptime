import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
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
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  fetchK8sObjectsBatch,
  KubernetesObjectType,
} from "../Utils/KubernetesObjectFetcher";
import {
  KubernetesCondition,
  KubernetesDeploymentObject,
} from "../Utils/KubernetesObjectParser";

const KubernetesClusterDeployments: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const cluster: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
        },
      });

      if (!cluster?.clusterIdentifier) {
        setError("Cluster not found.");
        setIsLoading(false);
        return;
      }

      const [deploymentList, deploymentObjects]: [
        Array<KubernetesResource>,
        Map<string, KubernetesObjectType>,
      ] = await Promise.all([
        KubernetesResourceUtils.fetchResourceListWithMemory({
          clusterIdentifier: cluster.clusterIdentifier,
          metricName: "k8s.pod.cpu.utilization",
          memoryMetricName: "k8s.pod.memory.usage",
          resourceNameAttribute: "resource.k8s.deployment.name",
        }),
        fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "deployments",
        }),
      ]);

      const existingKeys: Set<string> = new Set<string>();

      for (const resource of deploymentList) {
        const key: string = `${resource.namespace}/${resource.name}`;
        existingKeys.add(key);
        const depObj: KubernetesObjectType | undefined =
          deploymentObjects.get(key);
        if (depObj) {
          const deployment: KubernetesDeploymentObject =
            depObj as KubernetesDeploymentObject;

          const readyReplicas: number = deployment.status.readyReplicas;
          const replicas: number = deployment.spec.replicas;

          if (readyReplicas === replicas && replicas > 0) {
            resource.status = "Ready";
          } else if (readyReplicas < replicas) {
            const failedCondition: KubernetesCondition | undefined =
              deployment.status.conditions.find((c: KubernetesCondition) => {
                return c.type === "Available" && c.status === "False";
              });
            resource.status = failedCondition ? "Failed" : "Progressing";
          } else {
            resource.status = "Progressing";
          }

          resource.additionalAttributes["ready"] =
            `${readyReplicas}/${replicas}`;

          resource.age = KubernetesResourceUtils.formatAge(
            deployment.metadata.creationTimestamp,
          );
        }
      }

      // Add deployments from k8s objects that were not found via metrics
      for (const [key, depObj] of deploymentObjects.entries()) {
        if (existingKeys.has(key)) {
          continue;
        }
        const deployment: KubernetesDeploymentObject =
          depObj as KubernetesDeploymentObject;
        const readyReplicas: number = deployment.status.readyReplicas ?? 0;
        const replicas: number = deployment.spec.replicas ?? 0;

        let status: string = "Progressing";
        if (readyReplicas === replicas && replicas > 0) {
          status = "Ready";
        }

        deploymentList.push({
          name: deployment.metadata.name,
          namespace: deployment.metadata.namespace,
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: status,
          age: KubernetesResourceUtils.formatAge(
            deployment.metadata.creationTimestamp,
          ),
          additionalAttributes: {
            ready: `${readyReplicas}/${replicas}`,
          },
        });
      }

      setResources(deploymentList);
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
      title="Deployments"
      description="All deployments running in this cluster."
      resources={resources}
      columns={[
        {
          title: "Ready",
          key: "ready",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterDeployments;
