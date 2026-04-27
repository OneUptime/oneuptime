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

      const pvcResources: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "PersistentVolumeClaim",
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const spec: Record<string, unknown> =
              (row.spec as unknown as Record<string, unknown>) || {};
            const status: Record<string, unknown> =
              (row.status as unknown as Record<string, unknown>) || {};

            if (!resource.namespace) {
              resource.namespace = "default";
            }

            const capacity: Record<string, unknown> =
              (status["capacity"] as Record<string, unknown>) || {};
            const accessModes: Array<string> =
              (spec["accessModes"] as Array<string>) || [];

            resource.additionalAttributes["storageClass"] =
              (spec["storageClassName"] as string) || "N/A";
            resource.additionalAttributes["capacity"] =
              (capacity["storage"] as string) || "N/A";
            resource.additionalAttributes["volumeName"] =
              (spec["volumeName"] as string) || "N/A";
            resource.additionalAttributes["accessModes"] =
              accessModes.join(", ") || "N/A";
          },
        });

      // Default to "Unknown" when status.phase is missing, matching prior behavior
      for (const r of pvcResources) {
        if (!r.status) {
          r.status = "Unknown";
        }
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
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
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
