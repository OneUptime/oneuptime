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
import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";

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

      const [jobList, jobObjects]: [
        Array<KubernetesResource>,
        Map<string, KubernetesObjectType>,
      ] = await Promise.all([
        KubernetesResourceUtils.fetchResourceListWithMemory({
          clusterIdentifier: cluster.clusterIdentifier,
          metricName: "k8s.pod.cpu.utilization",
          memoryMetricName: "k8s.pod.memory.usage",
          resourceNameAttribute: "resource.k8s.job.name",
        }),
        fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "jobs",
        }),
      ]);

      // Build a set of resource keys we already have from metrics
      const existingKeys: Set<string> = new Set<string>();

      for (const resource of jobList) {
        const key: string = `${resource.namespace}/${resource.name}`;
        existingKeys.add(key);
        const jobObj: KubernetesObjectType | undefined = jobObjects.get(key);
        if (jobObj) {
          const job: KubernetesJobObject = jobObj as KubernetesJobObject;

          if (job.status.completionTime) {
            resource.status = "Complete";
          } else if (job.status.failed > 0) {
            resource.status = "Failed";
          } else if (job.status.active > 0) {
            resource.status = "Running";
          } else {
            resource.status = "Pending";
          }

          resource.age = KubernetesResourceUtils.formatAge(
            job.metadata.creationTimestamp,
          );
        }
      }

      // Add jobs from k8s objects that were not found via metrics
      for (const [key, jobObj] of jobObjects.entries()) {
        if (existingKeys.has(key)) {
          continue;
        }
        const job: KubernetesJobObject = jobObj as KubernetesJobObject;

        let status: string = "Pending";
        if (job.status.completionTime) {
          status = "Complete";
        } else if (job.status.failed > 0) {
          status = "Failed";
        } else if (job.status.active > 0) {
          status = "Running";
        }

        jobList.push({
          name: job.metadata.name,
          namespace: job.metadata.namespace,
          cpuUtilization: null,
          memoryUsageBytes: null,
          memoryLimitBytes: null,
          status: status,
          age: KubernetesResourceUtils.formatAge(
            job.metadata.creationTimestamp,
          ),
          additionalAttributes: {},
        });
      }

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
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterJobs;
