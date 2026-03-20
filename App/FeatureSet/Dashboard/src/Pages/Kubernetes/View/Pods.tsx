import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
import React, { FunctionComponent, ReactElement, useEffect, useState } from "react";
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
import { KubernetesPodObject } from "../Utils/KubernetesObjectParser";

function parseMemoryString(memory: string): number {
  if (!memory) {
    return 0;
  }
  const value: number = parseFloat(memory);
  if (memory.endsWith("Gi")) {
    return value * 1024 * 1024 * 1024;
  }
  if (memory.endsWith("Mi")) {
    return value * 1024 * 1024;
  }
  if (memory.endsWith("Ki")) {
    return value * 1024;
  }
  if (memory.endsWith("G")) {
    return value * 1000 * 1000 * 1000;
  }
  if (memory.endsWith("M")) {
    return value * 1000 * 1000;
  }
  if (memory.endsWith("K")) {
    return value * 1000;
  }
  return value;
}

const KubernetesClusterPods: FunctionComponent<
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

      const [podList, podObjects]: [
        Array<KubernetesResource>,
        Map<string, KubernetesObjectType>,
      ] = await Promise.all([
        KubernetesResourceUtils.fetchResourceListWithMemory({
          clusterIdentifier: cluster.clusterIdentifier,
          metricName: "k8s.pod.cpu.utilization",
          memoryMetricName: "k8s.pod.memory.usage",
          resourceNameAttribute: "resource.k8s.pod.name",
          additionalAttributes: [
            "resource.k8s.node.name",
            "resource.k8s.deployment.name",
          ],
        }),
        fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "pods",
        }),
      ]);

      for (const resource of podList) {
        const key: string = `${resource.namespace}/${resource.name}`;
        const podObj: KubernetesObjectType | undefined = podObjects.get(key);
        if (podObj) {
          const pod: KubernetesPodObject = podObj as KubernetesPodObject;
          resource.status = pod.status.phase || "Unknown";

          for (const cs of pod.status.containerStatuses) {
            if (cs.state === "waiting" && cs.reason) {
              resource.status = cs.reason;
              break;
            }
          }

          resource.age = KubernetesResourceUtils.formatAge(
            pod.metadata.creationTimestamp,
          );
          resource.additionalAttributes["containers"] =
            `${pod.spec.containers.length}`;

          let totalMemoryLimit: number = 0;
          for (const container of pod.spec.containers) {
            if (container.resources.limits["memory"]) {
              totalMemoryLimit += parseMemoryString(
                container.resources.limits["memory"],
              );
            }
          }
          if (totalMemoryLimit > 0) {
            resource.memoryLimitBytes = totalMemoryLimit;
          }
        }
      }

      setResources(podList);
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
      title="Pods"
      description="All pods running in this cluster with their current resource usage."
      resources={resources}
      columns={[
        {
          title: "Node",
          key: "resource.k8s.node.name",
        },
        {
          title: "Containers",
          key: "containers",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterPods;
