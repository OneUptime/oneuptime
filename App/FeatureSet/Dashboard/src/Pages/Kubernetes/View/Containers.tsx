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

const KubernetesClusterContainers: FunctionComponent<
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

      /*
       * Containers aren't tracked as a top-level kind in the inventory
       * — they're part of a Pod's spec. Expand each Pod row into one
       * row per container so the page and the sidebar badge (which
       * counts pods as a proxy) agree.
       */
      const pods: Array<KubernetesResource> = [];
      const podRows: Map<string, KubernetesResourceModel> = new Map();

      await KubernetesResourceUtils.fetchInventoryResources({
        kubernetesClusterId: modelId,
        kind: "Pod",
        transform: (resource: KubernetesResource, row: KubernetesResourceModel) => {
          pods.push(resource);
          podRows.set(`${resource.namespace}/${resource.name}`, row);
        },
      });

      const containerList: Array<KubernetesResource> = [];

      for (const pod of pods) {
        const row: KubernetesResourceModel | undefined = podRows.get(
          `${pod.namespace}/${pod.name}`,
        );
        if (!row) {
          continue;
        }
        const spec: Record<string, unknown> =
          (row.spec as unknown as Record<string, unknown>) || {};
        const status: Record<string, unknown> =
          (row.status as unknown as Record<string, unknown>) || {};
        const containers: Array<Record<string, unknown>> =
          (spec["containers"] as Array<Record<string, unknown>>) || [];
        const containerStatuses: Array<Record<string, unknown>> =
          (status["containerStatuses"] as Array<
            Record<string, unknown>
          >) || [];

        for (const c of containers) {
          const name: string = (c["name"] as string) || "";
          if (!name) {
            continue;
          }

          const cs: Record<string, unknown> | undefined =
            containerStatuses.find((s: Record<string, unknown>) => {
              return s["name"] === name;
            });

          let displayStatus: string = "Unknown";
          let restarts: string = "0";
          if (cs) {
            const state: unknown = cs["state"];
            if (state === "running") {
              displayStatus = cs["ready"] ? "Running" : "NotReady";
            } else if (state === "waiting") {
              displayStatus = "Waiting";
            } else if (state === "terminated") {
              displayStatus = "Terminated";
            } else if (typeof state === "string") {
              displayStatus = state;
            }
            restarts = `${(cs["restartCount"] as number) || 0}`;
          }

          containerList.push({
            name,
            namespace: pod.namespace,
            cpuUtilization: null,
            memoryUsageBytes: null,
            memoryLimitBytes: null,
            status: displayStatus,
            age: pod.age,
            additionalAttributes: {
              "resource.k8s.pod.name": pod.name,
              restarts,
            },
          });
        }
      }

      await KubernetesResourceUtils.enrichWithMetrics({
        resources: containerList,
        clusterIdentifier: cluster.clusterIdentifier,
        cpuMetricName: "container.cpu.utilization",
        memoryMetricName: "container.memory.usage",
        resourceNameAttribute: "resource.k8s.container.name",
      });

      setResources(containerList);
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
      title="Containers"
      description="All containers running in this cluster."
      resources={resources}
      columns={[
        {
          title: "Pod",
          key: "resource.k8s.pod.name",
        },
        {
          title: "Restarts",
          key: "restarts",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterContainers;
