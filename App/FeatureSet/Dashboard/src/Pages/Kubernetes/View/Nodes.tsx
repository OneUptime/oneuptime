import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import KubernetesResourceUtils, {
  KubernetesResource,
} from "../Utils/KubernetesResourceUtils";
import React, {
  Fragment,
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

      const nodeList: Array<KubernetesResource> =
        await KubernetesResourceUtils.fetchResourceListWithMemory({
          clusterIdentifier: cluster.clusterIdentifier,
          metricName: "k8s.node.cpu.utilization",
          memoryMetricName: "k8s.node.memory.usage",
          resourceNameAttribute: "k8s.node.name",
          namespaceAttribute: "k8s.node.name",
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
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <KubernetesResourceTable
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
      />
    </Fragment>
  );
};

export default KubernetesClusterNodes;
