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
import { KubernetesVPAObject } from "../Utils/KubernetesObjectParser";

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

      const vpaObjects: Map<string, KubernetesObjectType> =
        await fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "verticalpodautoscalers",
        });

      const vpaResources: Array<KubernetesResource> = [];

      for (const vpaObj of vpaObjects.values()) {
        const vpa: KubernetesVPAObject = vpaObj as KubernetesVPAObject;

        const hasRecommendations: boolean =
          vpa.status.recommendation.containerRecommendations.length > 0;

        vpaResources.push({
          name: vpa.metadata.name,
          namespace: vpa.metadata.namespace || "default",
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: hasRecommendations ? "Active" : "Pending",
          age: KubernetesResourceUtils.formatAge(
            vpa.metadata.creationTimestamp,
          ),
          additionalAttributes: {
            target: `${vpa.spec.targetRef.kind}/${vpa.spec.targetRef.name}`,
            updateMode: vpa.spec.updatePolicy.updateMode || "N/A",
          },
        });
      }

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
