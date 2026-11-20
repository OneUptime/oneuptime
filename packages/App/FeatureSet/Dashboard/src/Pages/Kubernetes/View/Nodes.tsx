import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
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
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  KubernetesNodeDiskCells,
  getKubernetesNodeDisk,
  getKubernetesNodeDiskCells,
} from "../Utils/KubernetesNodeDisk";

const KubernetesClusterNodes: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const nodeList: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "Node",
          selectFullSpec: true,
          // Its disks (#9645), which its status reads too: "Disk nearly full".
          selectVolumeUsage: true,
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            /*
             * A Node's memory% is its usage measured against its own
             * allocatable memory (status.allocatable.memory, falling
             * back to capacity) — the same denominator the Node's CPU%
             * already uses. Lets the Memory column render a percentage
             * instead of raw bytes.
             */
            const status: Record<string, unknown> =
              (row.status as unknown as Record<string, unknown>) || {};
            const allocatable: Record<string, unknown> =
              (status["allocatable"] as Record<string, unknown>) || {};
            const capacity: Record<string, unknown> =
              (status["capacity"] as Record<string, unknown>) || {};
            const memString: string =
              (allocatable["memory"] as string) ||
              (capacity["memory"] as string) ||
              "";
            const bytes: number =
              KubernetesResourceUtils.parseK8sMemoryToBytes(memString);
            if (bytes > 0) {
              resource.memoryLimitBytes = bytes;
            }

            /*
             * Its root disk's used and free, and its image disk's when its
             * container images have a disk of their own (KubernetesNodeDisk).
             */
            const cells: KubernetesNodeDiskCells = getKubernetesNodeDiskCells(
              getKubernetesNodeDisk({
                latestVolumeCapacityBytes: row.latestVolumeCapacityBytes,
                latestVolumeAvailableBytes: row.latestVolumeAvailableBytes,
                latestImageFsCapacityBytes: row.latestImageFsCapacityBytes,
                latestImageFsAvailableBytes: row.latestImageFsAvailableBytes,
                latestVolumeMeasuredAt: row.latestVolumeMeasuredAt,
              }),
            );
            resource.storageUsage = cells.storageUsage;
            if (cells.secondaryStorageUsage) {
              resource.secondaryStorageUsage = cells.secondaryStorageUsage;
            }
          },
        });

      setResources(nodeList);
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
      title="Nodes"
      description="All nodes in this cluster with their CPU, memory and disk use."
      resources={resources}
      builtInColumnDescriptions={{
        cpu: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeCpu,
        memory: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeMemory,
      }}
      /*
       * Its disk beside its CPU and memory (#9645): the fullest node is a
       * click on Disk away, amber from 80% and red where the kubelet starts
       * evicting pods from it (#10057): 85% on a disk that holds the
       * container images, 90% on a root filesystem that holds none.
       */
      storageUsageColumns={{
        usedTitle: translationKey("Disk"),
        freeTitle: translationKey("Disk Free"),
        usedDescription: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeDiskUsed,
        freeDescription: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeDiskFree,
        capacity: {
          title: translationKey("Disk Capacity"),
          description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeDiskCapacity,
        },
        secondary: {
          title: translationKey("Image Disk"),
          description: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.nodeImageDisk,
        },
        isAfterResourceMetrics: true,
      }}
      showNamespace={false}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterNodes;
