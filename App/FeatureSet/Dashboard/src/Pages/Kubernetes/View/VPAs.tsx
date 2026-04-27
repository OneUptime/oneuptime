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

const KubernetesClusterVPAs: FunctionComponent<
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

      const vpaResources: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "VerticalPodAutoscaler",
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const spec: Record<string, unknown> =
              (row.spec as unknown as Record<string, unknown>) || {};
            const status: Record<string, unknown> =
              (row.status as unknown as Record<string, unknown>) || {};
            const targetRef: Record<string, unknown> =
              (spec["targetRef"] as Record<string, unknown>) || {};
            const updatePolicy: Record<string, unknown> =
              (spec["updatePolicy"] as Record<string, unknown>) || {};
            const recommendation: Record<string, unknown> =
              (status["recommendation"] as Record<string, unknown>) || {};
            const containerRecommendations: Array<unknown> =
              (recommendation["containerRecommendations"] as Array<unknown>) ||
              [];

            if (!resource.namespace) {
              resource.namespace = "default";
            }

            resource.status =
              containerRecommendations.length > 0 ? "Active" : "Pending";
            resource.additionalAttributes["target"] =
              `${targetRef["kind"] || ""}/${targetRef["name"] || ""}`;
            resource.additionalAttributes["updateMode"] =
              (updatePolicy["updateMode"] as string) || "N/A";
          },
        });

      setResources(vpaResources);
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
      title="Vertical Pod Autoscalers"
      description="All VPAs in this cluster with their current status."
      resources={resources}
      showResourceMetrics={false}
      columns={[
        {
          title: "Target",
          key: "target",
        },
        {
          title: "Update Mode",
          key: "updateMode",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_VPA_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
      emptyMessage="No VPAs found. VPA data will appear here once the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and includes verticalpodautoscalers."
    />
  );
};

export default KubernetesClusterVPAs;
