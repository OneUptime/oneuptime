import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import { KubernetesResource } from "../Utils/KubernetesResourceUtils";
import KubernetesContainerModel from "Common/Models/DatabaseModels/KubernetesContainer";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

const METRIC_STALE_MS: number = 15 * 60 * 1000;

function deriveDisplayStatus(row: KubernetesContainerModel): string {
  const reason: string = row.reason || "";
  const state: string = row.state || "";
  if (state === "running") {
    return row.isReady ? "Running" : "NotReady";
  }
  if (state === "waiting") {
    return reason || "Waiting";
  }
  if (state === "terminated") {
    return reason || "Terminated";
  }
  if (state) {
    return state.charAt(0).toUpperCase() + state.slice(1);
  }
  return "Unknown";
}

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
      const result: ListResult<KubernetesContainerModel> =
        await ModelAPI.getList<KubernetesContainerModel>({
          modelType: KubernetesContainerModel,
          query: {
            kubernetesClusterId: modelId,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          select: {
            name: true,
            podName: true,
            podNamespaceKey: true,
            state: true,
            reason: true,
            isReady: true,
            restartCount: true,
            memoryLimitBytes: true,
            latestCpuPercent: true,
            latestMemoryBytes: true,
            metricsUpdatedAt: true,
            lastSeenAt: true,
          },
          sort: {
            podNamespaceKey: SortOrder.Ascending,
            podName: SortOrder.Ascending,
            name: SortOrder.Ascending,
          },
        });

      const now: number = Date.now();
      const containerList: Array<KubernetesResource> = result.data.map(
        (row: KubernetesContainerModel): KubernetesResource => {
          let cpu: number | null = null;
          let mem: number | null = null;
          if (row.metricsUpdatedAt) {
            const ageMs: number =
              now - new Date(row.metricsUpdatedAt as Date).getTime();
            if (ageMs <= METRIC_STALE_MS) {
              if (
                row.latestCpuPercent !== null &&
                row.latestCpuPercent !== undefined
              ) {
                cpu = Number(row.latestCpuPercent);
              }
              if (
                row.latestMemoryBytes !== null &&
                row.latestMemoryBytes !== undefined
              ) {
                mem = Number(row.latestMemoryBytes);
              }
            }
          }

          return {
            name: row.name || "",
            namespace: row.podNamespaceKey || "",
            cpuUtilization: cpu,
            memoryUsageBytes: mem,
            memoryLimitBytes:
              row.memoryLimitBytes !== null &&
              row.memoryLimitBytes !== undefined
                ? Number(row.memoryLimitBytes)
                : null,
            status: deriveDisplayStatus(row),
            age: "",
            additionalAttributes: {
              "resource.k8s.pod.name": row.podName || "",
              restarts: `${row.restartCount ?? 0}`,
            },
          };
        },
      );

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
