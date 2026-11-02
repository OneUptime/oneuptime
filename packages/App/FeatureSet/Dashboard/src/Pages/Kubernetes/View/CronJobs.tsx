import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesResourceTable from "../../../Components/Kubernetes/KubernetesResourceTable";
import { KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/KubernetesResourceMetricDescriptions";
import KubernetesResourceUtils, {
  KubernetesResource,
  PodMetricAggregate,
  kubernetesHealthTextInEnglish,
} from "../Utils/KubernetesResourceUtils";
import {
  KubernetesHealthAssessment,
  assessKubernetesCronJobWithRuns,
} from "Common/Types/Kubernetes/KubernetesHealth";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
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
      // Each CronJob's row, to read its runs against below.
      const cronJobRows: Map<string, KubernetesResourceModel> = new Map<
        string,
        KubernetesResourceModel
      >();

      const [cronjobList, aggregates, jobs]: [
        Array<KubernetesResource>,
        Map<string, PodMetricAggregate>,
        ListResult<KubernetesResourceModel>,
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
            resource.additionalAttributes["schedule"] =
              (spec["schedule"] as string) || "";
            cronJobRows.set(`${resource.namespace}/${resource.name}`, row);
          },
        }),
        KubernetesResourceUtils.fetchPodMetricsByOwner(modelId, "CronJob"),
        /*
         * The runs a CronJob keeps (its Jobs): a CronJob whose newest run
         * failed reads Last run failed, as its page and Needs attention say.
         */
        ModelAPI.getList<KubernetesResourceModel>({
          modelType: KubernetesResourceModel,
          query: { kubernetesClusterId: modelId, kind: "Job" },
          select: {
            name: true,
            namespaceKey: true,
            ownerReferences: true,
            status: true,
            resourceCreationTimestamp: true,
            lastSeenAt: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          sort: {},
        }),
      ]);

      for (const resource of cronjobList) {
        const row: KubernetesResourceModel | undefined = cronJobRows.get(
          `${resource.namespace}/${resource.name}`,
        );
        if (!row) {
          continue;
        }
        const assessment: KubernetesHealthAssessment =
          assessKubernetesCronJobWithRuns(
            { ...row, kind: "CronJob" },
            jobs.data.map((job: KubernetesResourceModel) => {
              return { ...job, kind: "Job" };
            }),
          );
        resource.status = kubernetesHealthTextInEnglish(assessment.status);
        resource.statusText = assessment.status.values
          ? { text: assessment.status.text, values: assessment.status.values }
          : { text: assessment.status.text };
        resource.statusTone = assessment.tone;
      }

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
      builtInColumnDescriptions={{
        cpu: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.cronJobCpu,
        memory: KUBERNETES_RESOURCE_METRIC_DESCRIPTIONS.cronJobMemory,
      }}
      columns={[
        {
          title: "Schedule",
          key: "schedule",
        },
      ]}
      getViewRoute={(resource: KubernetesResource): Route => {
        // In its namespace: names repeat across namespaces.
        return (
          getKubernetesPartRoute(modelId, {
            kind: "CronJob",
            name: resource.name,
            namespace: resource.namespace,
          }) ||
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL] as Route,
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

export default KubernetesClusterCronJobs;
