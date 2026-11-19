import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import { getKubernetesContainerRoute } from "../Utils/KubernetesPartRoutes";
import { getKubernetesContainerRowStatus } from "../Utils/KubernetesContainerFacts";
import Route from "Common/Types/API/Route";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";

const METRIC_STALE_MS: number = 15 * 60 * 1000;

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
            status: getKubernetesContainerRowStatus(row),
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
    return <PageSkeleton shape="table" />;
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
      builtInColumnDescriptions={{
        cpu: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerCpu,
        memory: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerMemory,
      }}
      columns={[
        {
          title: "Pod",
          key: "resource.k8s.pod.name",
        },
        {
          title: "Restarts",
          key: "restarts",
          description:
            KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.containerRestarts,
          isCount: true,
        },
      ]}
      getViewRoute={(resource: KubernetesResource): Route => {
        /*
         * Which pod's: a container is named within its pod, and its page
         * reads that pod's status to say why it is not running.
         */
        return getKubernetesContainerRoute(modelId, {
          name: resource.name,
          pod: resource.additionalAttributes["resource.k8s.pod.name"],
          namespace: resource.namespace,
        });
      }}
    />
  );
};

export default KubernetesClusterContainers;
