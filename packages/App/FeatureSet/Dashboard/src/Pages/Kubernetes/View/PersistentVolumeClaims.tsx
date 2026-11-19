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
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { getKubernetesPartRoute } from "../Utils/KubernetesPartRoutes";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesVolumeClaimUsage,
  getKubernetesVolumeClaimStorageCell,
  getKubernetesVolumeClaimUsage,
  isVolumeUsageMissingFromCluster,
} from "../Utils/KubernetesVolumeUsage";
import KubernetesVolumeUsageMissingAlert from "../../../Components/Kubernetes/KubernetesVolumeUsageMissingAlert";

const KubernetesClusterPVCs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  /*
   * Not one claim reports its usage: the agent most likely predates it, so
   * the page says how to get it, once, above the list.
   */
  const [isUsageMissing, setIsUsageMissing] = useState<boolean>(false);
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

      const usages: Array<KubernetesVolumeClaimUsage> = [];

      const pvcResources: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "PersistentVolumeClaim",
          selectFullSpec: true,
          selectVolumeUsage: true,
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

            // Used and free, as the kubelet last measured the claim's volume.
            const usage: KubernetesVolumeClaimUsage =
              getKubernetesVolumeClaimUsage({
                latestVolumeCapacityBytes: row.latestVolumeCapacityBytes,
                latestVolumeAvailableBytes: row.latestVolumeAvailableBytes,
                latestVolumeInodes: row.latestVolumeInodes,
                latestVolumeInodesFree: row.latestVolumeInodesFree,
                metricsUpdatedAt: row.metricsUpdatedAt,
                status: status as JSONObject,
                spec: spec as JSONObject,
              });
            usages.push(usage);
            resource.storageUsage = getKubernetesVolumeClaimStorageCell(usage);
          },
        });

      setResources(pvcResources);
      setIsUsageMissing(isVolumeUsageMissingFromCluster(usages));
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
      notice={
        isUsageMissing ? <KubernetesVolumeUsageMissingAlert /> : undefined
      }
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Persistent Volume Claims"
      description="Every claim in this cluster: how much of it is used, how much is free, and its status."
      resources={resources}
      showResourceMetrics={false}
      storageUsageColumns={{
        usedDescription: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.pvcUsed,
        freeDescription: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.pvcFree,
      }}
      columns={[
        {
          title: "Capacity",
          key: "capacity",
          description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.pvcCapacity,
          // Under Used while the table runs out of room, as Free is.
          foldInto: "storageUsage",
          showTitleWhenFolded: true,
        },
        {
          title: "Storage Class",
          key: "storageClass",
        },
        {
          title: "Volume",
          key: "volumeName",
          isName: true,
        },
        {
          title: "Access Modes",
          key: "accessModes",
        },
      ]}
      getViewRoute={(resource: KubernetesResource): Route => {
        // In its namespace: names repeat across namespaces.
        return (
          getKubernetesPartRoute(modelId, {
            kind: "PersistentVolumeClaim",
            name: resource.name,
            namespace: resource.namespace,
          }) ||
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL] as Route,
            {
              modelId: modelId,
              subModelId: new ObjectID(resource.name),
            },
          )
        );
      }}
      emptyMessage="No PVCs yet. They appear once the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and includes persistentvolumeclaims."
    />
  );
};

export default KubernetesClusterPVCs;
