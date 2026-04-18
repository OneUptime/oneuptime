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

const KubernetesClusterJobs: FunctionComponent<
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

      const jobList: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "Job",
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const status: Record<string, unknown> =
              (row.status as unknown as Record<string, unknown>) || {};
            const completionTime: unknown = status["completionTime"];
            const failed: number = (status["failed"] as number) || 0;
            const active: number = (status["active"] as number) || 0;

            if (completionTime) {
              resource.status = "Complete";
            } else if (failed > 0) {
              resource.status = "Failed";
            } else if (active > 0) {
              resource.status = "Running";
            } else {
              resource.status = "Pending";
            }
          },
        });

      await KubernetesResourceUtils.enrichWithMetrics({
        resources: jobList,
        clusterIdentifier: cluster.clusterIdentifier,
        cpuMetricName: "k8s.pod.cpu.utilization",
        memoryMetricName: "k8s.pod.memory.usage",
        resourceNameAttribute: "resource.k8s.job.name",
      });

      setResources(jobList);
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
      title="Jobs"
      description="All jobs in this cluster."
      resources={resources}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterJobs;
