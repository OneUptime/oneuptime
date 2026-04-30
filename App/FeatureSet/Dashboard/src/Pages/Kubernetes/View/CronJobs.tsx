import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
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
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";

const KubernetesClusterCronJobs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<KubernetesResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const [cronjobList, aggregates]: [
        Array<KubernetesResource>,
        Map<string, PodMetricAggregate>,
      ] = await Promise.all([
        KubernetesResourceUtils.fetchInventoryResources({
          kubernetesClusterId: modelId,
          kind: "CronJob",
          selectFullSpec: true,
          transform: (
            resource: KubernetesResource,
            row: KubernetesResourceModel,
          ) => {
            const spec: Record<string, unknown> =
              (row.spec as unknown as Record<string, unknown>) || {};
            resource.status = spec["suspend"] ? "Suspended" : "Active";
            resource.additionalAttributes["schedule"] =
              (spec["schedule"] as string) || "";
          },
        }),
        KubernetesResourceUtils.fetchPodMetricsByOwner(modelId, "CronJob"),
      ]);

      KubernetesResourceUtils.applyAggregateMetrics({
        resources: cronjobList,
        aggregates,
      });

      setResources(cronjobList);
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
      title="CronJobs"
      description="All cron jobs in this cluster."
      resources={resources}
      columns={[
        {
          title: "Schedule",
          key: "schedule",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterCronJobs;
