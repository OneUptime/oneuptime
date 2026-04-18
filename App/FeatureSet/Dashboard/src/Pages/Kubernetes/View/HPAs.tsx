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

const KubernetesClusterHPAs: FunctionComponent<
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

      const hpaResources: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "HorizontalPodAutoscaler",
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const spec: Record<string, unknown> =
              (row.spec as unknown as Record<string, unknown>) || {};
            const status: Record<string, unknown> =
              (row.status as unknown as Record<string, unknown>) || {};
            const scaleTargetRef: Record<string, unknown> =
              (spec["scaleTargetRef"] as Record<string, unknown>) || {};
            const currentReplicas: number =
              (status["currentReplicas"] as number) || 0;
            const desiredReplicas: number =
              (status["desiredReplicas"] as number) || 0;

            if (!resource.namespace) {
              resource.namespace = "default";
            }

            if (currentReplicas === desiredReplicas && currentReplicas > 0) {
              resource.status = "Active";
            } else if (currentReplicas < desiredReplicas) {
              resource.status = "Scaling Up";
            } else if (currentReplicas > desiredReplicas) {
              resource.status = "Scaling Down";
            } else {
              resource.status = "Active";
            }

            resource.additionalAttributes["target"] =
              `${scaleTargetRef["kind"] || ""}/${scaleTargetRef["name"] || ""}`;
            resource.additionalAttributes["minReplicas"] = String(
              spec["minReplicas"] ?? "",
            );
            resource.additionalAttributes["maxReplicas"] = String(
              spec["maxReplicas"] ?? "",
            );
            resource.additionalAttributes["currentReplicas"] =
              String(currentReplicas);
            resource.additionalAttributes["desiredReplicas"] =
              String(desiredReplicas);
          },
        });

      setResources(hpaResources);
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
      title="Horizontal Pod Autoscalers"
      description="All HPAs in this cluster with their current scaling status."
      resources={resources}
      showResourceMetrics={false}
      columns={[
        {
          title: "Target",
          key: "target",
        },
        {
          title: "Min Replicas",
          key: "minReplicas",
        },
        {
          title: "Max Replicas",
          key: "maxReplicas",
        },
        {
          title: "Current",
          key: "currentReplicas",
        },
        {
          title: "Desired",
          key: "desiredReplicas",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
      emptyMessage="No HPAs found. HPA data will appear here once the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and includes horizontalpodautoscalers."
    />
  );
};

export default KubernetesClusterHPAs;
