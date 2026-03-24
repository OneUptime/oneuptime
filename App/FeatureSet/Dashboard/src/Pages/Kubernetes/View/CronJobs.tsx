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
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  fetchK8sObjectsBatch,
  KubernetesObjectType,
} from "../Utils/KubernetesObjectFetcher";
import { KubernetesCronJobObject } from "../Utils/KubernetesObjectParser";

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

      const [cronjobList, cronjobObjects]: [
        Array<KubernetesResource>,
        Map<string, KubernetesObjectType>,
      ] = await Promise.all([
        KubernetesResourceUtils.fetchResourceListWithMemory({
          clusterIdentifier: cluster.clusterIdentifier,
          metricName: "k8s.pod.cpu.utilization",
          memoryMetricName: "k8s.pod.memory.usage",
          resourceNameAttribute: "resource.k8s.cronjob.name",
        }),
        fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "cronjobs",
        }),
      ]);

      // Build a set of resource keys we already have from metrics
      const existingKeys: Set<string> = new Set<string>();

      for (const resource of cronjobList) {
        const key: string = `${resource.namespace}/${resource.name}`;
        existingKeys.add(key);
        const cjObj: KubernetesObjectType | undefined = cronjobObjects.get(key);
        if (cjObj) {
          const cronJob: KubernetesCronJobObject =
            cjObj as KubernetesCronJobObject;

          resource.status = cronJob.spec.suspend ? "Suspended" : "Active";

          resource.additionalAttributes["schedule"] = cronJob.spec.schedule;

          resource.age = KubernetesResourceUtils.formatAge(
            cronJob.metadata.creationTimestamp,
          );
        }
      }

      // Add cronjobs from k8s objects that were not found via metrics
      for (const [key, cjObj] of cronjobObjects.entries()) {
        if (existingKeys.has(key)) {
          continue;
        }
        const cronJob: KubernetesCronJobObject =
          cjObj as KubernetesCronJobObject;

        cronjobList.push({
          name: cronJob.metadata.name,
          namespace: cronJob.metadata.namespace,
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: cronJob.spec.suspend ? "Suspended" : "Active",
          age: KubernetesResourceUtils.formatAge(
            cronJob.metadata.creationTimestamp,
          ),
          additionalAttributes: {
            schedule: cronJob.spec.schedule || "",
          },
        });
      }

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
