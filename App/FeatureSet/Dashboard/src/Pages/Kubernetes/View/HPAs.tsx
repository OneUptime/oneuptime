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
import { KubernetesHPAObject } from "../Utils/KubernetesObjectParser";

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

      const hpaObjects: Map<string, KubernetesObjectType> =
        await fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "horizontalpodautoscalers",
        });

      const hpaResources: Array<KubernetesResource> = [];

      for (const hpaObj of hpaObjects.values()) {
        const hpa: KubernetesHPAObject = hpaObj as KubernetesHPAObject;

        const currentReplicas: number = hpa.status.currentReplicas;
        const desiredReplicas: number = hpa.status.desiredReplicas;

        let status: string = "Active";
        if (currentReplicas === desiredReplicas && currentReplicas > 0) {
          status = "Active";
        } else if (currentReplicas < desiredReplicas) {
          status = "Scaling Up";
        } else if (currentReplicas > desiredReplicas) {
          status = "Scaling Down";
        }

        hpaResources.push({
          name: hpa.metadata.name,
          namespace: hpa.metadata.namespace || "default",
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: status,
          age: KubernetesResourceUtils.formatAge(
            hpa.metadata.creationTimestamp,
          ),
          additionalAttributes: {
            target: `${hpa.spec.scaleTargetRef.kind}/${hpa.spec.scaleTargetRef.name}`,
            minReplicas: String(hpa.spec.minReplicas),
            maxReplicas: String(hpa.spec.maxReplicas),
            currentReplicas: String(currentReplicas),
            desiredReplicas: String(desiredReplicas),
          },
        });
      }

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
