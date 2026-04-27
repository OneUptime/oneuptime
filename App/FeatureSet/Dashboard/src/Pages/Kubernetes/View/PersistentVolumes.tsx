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
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";

const KubernetesClusterPVs: FunctionComponent<
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

      const pvResources: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "PersistentVolume",
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const spec: Record<string, unknown> =
              (row.spec as unknown as Record<string, unknown>) || {};
            const capacity: Record<string, unknown> =
              (spec["capacity"] as Record<string, unknown>) || {};
            const claimRef: Record<string, unknown> =
              (spec["claimRef"] as Record<string, unknown>) || {};

            resource.additionalAttributes["capacity"] =
              (capacity["storage"] as string) || "N/A";
            resource.additionalAttributes["storageClass"] =
              (spec["storageClassName"] as string) || "N/A";
            resource.additionalAttributes["reclaimPolicy"] =
              (spec["persistentVolumeReclaimPolicy"] as string) || "N/A";
            resource.additionalAttributes["claimRef"] = claimRef["name"]
              ? `${claimRef["namespace"]}/${claimRef["name"]}`
              : "N/A";
          },
        });

      for (const r of pvResources) {
        if (!r.status) {
          r.status = "Unknown";
        }
      }

      setResources(pvResources);
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
      title="Persistent Volumes"
      description="All PVs in this cluster with their current status."
      resources={resources}
      showNamespace={false}
      showResourceMetrics={false}
      columns={[
        {
          title: "Capacity",
          key: "capacity",
        },
        {
          title: "Storage Class",
          key: "storageClass",
        },
        {
          title: "Reclaim Policy",
          key: "reclaimPolicy",
        },
        {
          title: "Claim",
          key: "claimRef",
        },
      ]}
      emptyMessage="No PVs found. PV data will appear here once the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and includes persistentvolumes."
    />
  );
};

export default KubernetesClusterPVs;
