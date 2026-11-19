import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
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
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import {
  KubernetesVolumeClaimUsage,
  getPersistentVolumeStorageCell,
} from "../Utils/KubernetesVolumeUsage";
import { fetchKubernetesVolumeClaimUsages } from "../Utils/KubernetesVolumeUsageFetcher";

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

      // Each volume's usage is its claim's, read beside the volumes.
      const claimUsagesPromise: Promise<
        Map<string, KubernetesVolumeClaimUsage>
      > = fetchKubernetesVolumeClaimUsages({ kubernetesClusterId: modelId });

      const pvResources: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "PersistentVolume",
          selectFullSpec: true,
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
            resource.additionalAttributes["claimNamespace"] =
              (claimRef["namespace"] as string) || "";
            resource.additionalAttributes["claimName"] =
              (claimRef["name"] as string) || "";
            resource.additionalAttributes["phase"] =
              ((row.status as unknown as Record<string, unknown>)?.[
                "phase"
              ] as string) || "";
          },
        });

      const claimUsages: Map<string, KubernetesVolumeClaimUsage> =
        await claimUsagesPromise;

      for (const resource of pvResources) {
        resource.storageUsage = getPersistentVolumeStorageCell({
          phase: resource.additionalAttributes["phase"] || "",
          claimNamespace: resource.additionalAttributes["claimNamespace"] || "",
          claimName: resource.additionalAttributes["claimName"] || "",
          claimUsages: claimUsages,
        });
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
      title="Persistent Volumes"
      description="Every volume in this cluster: how much of it is used, how much is free, and its status."
      resources={resources}
      showNamespace={false}
      showResourceMetrics={false}
      storageUsageColumns={{
        usedDescription: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.pvUsed,
        freeDescription: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.pvFree,
      }}
      columns={[
        {
          title: "Capacity",
          key: "capacity",
          description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.pvCapacity,
          foldInto: "storageUsage",
          showTitleWhenFolded: true,
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
