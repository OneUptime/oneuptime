import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
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
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { buildTelemetryPivotActionButtons } from "../Utils/TelemetryPivot";

const KubernetesClusterPods: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [clusterIdentifier, setClusterIdentifier] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Node allocatable memory (by node name) is the fallback
       * denominator for a Pod's memory% when the Pod sets no memory
       * limit. Kick it off in parallel with the Pod fetch below.
       */
      const nodeAllocatableMemoryPromise: Promise<Map<string, number>> =
        KubernetesResourceUtils.fetchNodeAllocatableMemory(modelId);

      /*
       * The cluster's clusterIdentifier is the value stamped on telemetry
       * rows as resource.k8s.cluster.name — needed by the Logs/Metrics
       * explorer pivot links on each row.
       */
      const clusterPromise: Promise<KubernetesCluster | null> =
        ModelAPI.getItem({
          modelType: KubernetesCluster,
          id: modelId,
          select: {
            clusterIdentifier: true,
          },
        });

      /*
       * Latest CPU + memory come straight off the snapshot row
       * (latestCpuPercent / latestMemoryBytes), populated by the
       * metric ingest path. spec/status are still fetched for the
       * waiting-reason / container count / node-name extraction.
       */
      const podList: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "Pod",
          selectFullSpec: true,
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const spec: Record<string, unknown> =
              (row.spec as unknown as Record<string, unknown>) || {};
            const status: Record<string, unknown> =
              (row.status as unknown as Record<string, unknown>) || {};

            /*
             * A waiting container with a reason (ImagePullBackOff, CrashLoopBackOff)
             * is more useful to surface than the pod's broad phase.
             */
            const containerStatuses: Array<Record<string, unknown>> =
              (status["containerStatuses"] as Array<Record<string, unknown>>) ||
              [];
            for (const cs of containerStatuses) {
              if (cs["state"] === "waiting" && cs["reason"]) {
                resource.status = cs["reason"] as string;
                break;
              }
            }

            const containers: Array<Record<string, unknown>> =
              (spec["containers"] as Array<Record<string, unknown>>) || [];
            resource.additionalAttributes["containers"] =
              `${containers.length}`;

            const nodeName: unknown = spec["nodeName"];
            if (typeof nodeName === "string" && nodeName) {
              resource.additionalAttributes["resource.k8s.node.name"] =
                nodeName;
            }

            let totalMemoryLimit: number = 0;
            for (const container of containers) {
              const resources: Record<string, unknown> =
                (container["resources"] as Record<string, unknown>) || {};
              const limits: Record<string, unknown> =
                (resources["limits"] as Record<string, unknown>) || {};
              const memLimit: unknown = limits["memory"];
              if (typeof memLimit === "string" && memLimit) {
                totalMemoryLimit +=
                  KubernetesResourceUtils.parseK8sMemoryToBytes(memLimit);
              }
            }
            if (totalMemoryLimit > 0) {
              resource.memoryLimitBytes = totalMemoryLimit;
            }
          },
        });

      /*
       * Memory %: the transform above sets memoryLimitBytes from the
       * Pod's own container limits when present. For Pods that declare
       * no limit, fall back to their node's allocatable memory so the
       * column still renders a percentage instead of raw bytes —
       * mirroring how CPU% is measured against node allocatable.
       */
      const nodeAllocatableMemory: Map<string, number> =
        await nodeAllocatableMemoryPromise;
      for (const pod of podList) {
        if (!pod.memoryLimitBytes) {
          const nodeName: string =
            pod.additionalAttributes["resource.k8s.node.name"] || "";
          const nodeMemory: number | undefined =
            nodeAllocatableMemory.get(nodeName);
          if (nodeMemory && nodeMemory > 0) {
            pod.memoryLimitBytes = nodeMemory;
          }
        }
      }

      const cluster: KubernetesCluster | null = await clusterPromise;
      setClusterIdentifier(cluster?.clusterIdentifier || "");

      setResources(podList);
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
      title="Pods"
      description="All pods running in this cluster with their current resource usage."
      resources={resources}
      columns={[
        {
          title: "Node",
          key: "resource.k8s.node.name",
        },
        {
          title: "Containers",
          key: "containers",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
      extraActionButtons={buildTelemetryPivotActionButtons(
        (resource: KubernetesResource): Record<string, string> => {
          const attributes: Record<string, string> = {
            "resource.k8s.cluster.name": clusterIdentifier,
            "resource.k8s.pod.name": resource.name,
          };
          if (resource.namespace) {
            attributes["resource.k8s.namespace.name"] = resource.namespace;
          }
          return attributes;
        },
      )}
    />
  );
};

export default KubernetesClusterPods;
