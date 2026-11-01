import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import KubernetesResourceUtils, {
  KubernetesResource,
  PodMetricAggregate,
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
import { getKubernetesPartRoute } from "../Utils/KubernetesPartRoutes";

const KubernetesClusterJobs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const [jobList, aggregates]: [
        Array<KubernetesResource>,
        Map<string, PodMetricAggregate>,
      ] = await Promise.all([
        /*
         * Each Job's status is the cluster's rules': Running, Completed or
         * Failed by its conditions (fetchInventoryResources).
         */
        KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "Job",
          selectFullSpec: true,
        }),
        KubernetesResourceUtils.fetchPodMetricsByOwner(modelId, "Job"),
      ]);

      KubernetesResourceUtils.applyAggregateMetrics({
        resources: jobList,
        aggregates,
      });

      setResources(jobList);
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
      title="Jobs"
      description="All jobs in this cluster."
      resources={resources}
      builtInColumnDescriptions={{
        cpu: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobCpu,
        memory: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.jobMemory,
      }}
      getViewRoute={(resource: KubernetesResource): Route => {
        // In its namespace: names repeat across namespaces.
        return (
          getKubernetesPartRoute(modelId, {
            kind: "Job",
            name: resource.name,
            namespace: resource.namespace,
          }) ||
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL] as Route,
            {
              modelId: modelId,
              subModelId: new ObjectID(resource.name),
            },
          )
        );
      }}
    />
  );
};

export default KubernetesClusterJobs;
