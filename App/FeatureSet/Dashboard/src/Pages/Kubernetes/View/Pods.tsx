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
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";

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

      const podList: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "Pod",
          transform: (resource: KubernetesResource, row: KubernetesResourceModel) => {
            const spec: Record<string, unknown> =
              (row.spec as unknown as Record<string, unknown>) || {};
            const status: Record<string, unknown> =
              (row.status as unknown as Record<string, unknown>) || {};

            /*
             * A waiting container with a reason (ImagePullBackOff, CrashLoopBackOff)
             * is more useful to surface than the pod's broad phase.
             */
            const containerStatuses: Array<Record<string, unknown>> =
              (status["containerStatuses"] as Array<
                Record<string, unknown>
              >) || [];
            for (const cs of containerStatuses) {
              if (cs["state"] === "waiting" && cs["reason"]) {
                resource.status = cs["reason"] as string;
                break;
              }
            }

            const containers: Array<Record<string, unknown>> =
              (spec["containers"] as Array<Record<string, unknown>>) || [];
            resource.additionalAttributes["containers"] =
              `${containers.length}`;

            const nodeName: unknown = spec["nodeName"];
            if (typeof nodeName === "string" && nodeName) {
              resource.additionalAttributes["resource.k8s.node.name"] =
                nodeName;
            }

            let totalMemoryLimit: number = 0;
            for (const container of containers) {
              const resources: Record<string, unknown> =
                (container["resources"] as Record<string, unknown>) || {};
              const limits: Record<string, unknown> =
                (resources["limits"] as Record<string, unknown>) || {};
              const memLimit: unknown = limits["memory"];
              if (typeof memLimit === "string" && memLimit) {
                totalMemoryLimit += parseMemoryString(memLimit);
              }
            }
            if (totalMemoryLimit > 0) {
              resource.memoryLimitBytes = totalMemoryLimit;
            }
          },
        });

      await KubernetesResourceUtils.enrichWithMetrics({
        resources: podList,
        clusterIdentifier: cluster.clusterIdentifier,
        cpuMetricName: "k8s.pod.cpu.utilization",
        memoryMetricName: "k8s.pod.memory.usage",
        resourceNameAttribute: "resource.k8s.pod.name",
      });

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
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
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
