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

const KubernetesClusterNodes: FunctionComponent<
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

      const nodeList: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "Node",
          selectFullSpec: true,
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
          },
        });

      const cluster: KubernetesCluster | null = await clusterPromise;
      setClusterIdentifier(cluster?.clusterIdentifier || "");

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
      title="Nodes"
      description="All nodes in this cluster with their current resource usage."
      resources={resources}
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
      extraActionButtons={buildTelemetryPivotActionButtons(
        (resource: KubernetesResource): Record<string, string> => {
          return {
            "resource.k8s.cluster.name": clusterIdentifier,
            "resource.k8s.node.name": resource.name,
          };
        },
      )}
    />
  );
};

export default KubernetesClusterNodes;
