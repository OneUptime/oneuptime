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
import { KubernetesPVCObject } from "../Utils/KubernetesObjectParser";

const KubernetesClusterPVCs: FunctionComponent<
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

      const pvcObjects: Map<string, KubernetesObjectType> =
        await fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "persistentvolumeclaims",
        });

      const pvcResources: Array<KubernetesResource> = [];

      for (const pvcObj of pvcObjects.values()) {
        const pvc: KubernetesPVCObject = pvcObj as KubernetesPVCObject;
        pvcResources.push({
          name: pvc.metadata.name,
          namespace: pvc.metadata.namespace || "default",
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: pvc.status.phase || "Unknown",
          age: KubernetesResourceUtils.formatAge(
            pvc.metadata.creationTimestamp,
          ),
          additionalAttributes: {
            storageClass: pvc.spec.storageClassName || "N/A",
            capacity: pvc.status.capacity.storage || "N/A",
            volumeName: pvc.spec.volumeName || "N/A",
            accessModes: pvc.spec.accessModes.join(", ") || "N/A",
          },
        });
      }

      setResources(pvcResources);
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
      title="Persistent Volume Claims"
      description="All PVCs in this cluster with their current status."
      resources={resources}
      showResourceMetrics={false}
      columns={[
        {
          title: "Storage Class",
          key: "storageClass",
        },
        {
          title: "Capacity",
          key: "capacity",
        },
        {
          title: "Volume",
          key: "volumeName",
        },
        {
          title: "Access Modes",
          key: "accessModes",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
      emptyMessage="No PVCs found. PVC data will appear here once the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and includes persistentvolumeclaims."
    />
  );
};

export default KubernetesClusterPVCs;
