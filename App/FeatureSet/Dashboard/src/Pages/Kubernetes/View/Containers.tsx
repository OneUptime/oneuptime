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
import {
  KubernetesContainerStatus,
  KubernetesPodObject,
} from "../Utils/KubernetesObjectParser";

const KubernetesClusterContainers: FunctionComponent<
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

      const [containerList, podObjects]: [
        Array<KubernetesResource>,
        Map<string, KubernetesObjectType>,
      ] = await Promise.all([
        KubernetesResourceUtils.fetchResourceListWithMemory({
          clusterIdentifier: cluster.clusterIdentifier,
          metricName: "container.cpu.utilization",
          memoryMetricName: "container.memory.usage",
          resourceNameAttribute: "resource.k8s.container.name",
          additionalAttributes: ["resource.k8s.pod.name"],
        }),
        fetchK8sObjectsBatch({
          clusterIdentifier: cluster.clusterIdentifier,
          resourceType: "pods",
        }),
      ]);

      for (const resource of containerList) {
        const podName: string =
          resource.additionalAttributes["resource.k8s.pod.name"] || "";
        const podKey: string = resource.namespace
          ? `${resource.namespace}/${podName}`
          : podName;
        const podObj: KubernetesObjectType | undefined = podObjects.get(podKey);
        if (podObj) {
          const pod: KubernetesPodObject = podObj as KubernetesPodObject;

          // Find the container status matching this container name
          const containerStatus: KubernetesContainerStatus | undefined =
            pod.status.containerStatuses.find(
              (cs: KubernetesContainerStatus) => {
                return cs.name === resource.name;
              },
            );

          if (containerStatus) {
            if (containerStatus.state === "running") {
              resource.status = containerStatus.ready ? "Running" : "NotReady";
            } else if (containerStatus.state === "waiting") {
              resource.status = "Waiting";
            } else if (containerStatus.state === "terminated") {
              resource.status = "Terminated";
            } else {
              resource.status = containerStatus.state || "Unknown";
            }

            resource.additionalAttributes["restarts"] =
              `${containerStatus.restartCount}`;
          }

          resource.age = KubernetesResourceUtils.formatAge(
            pod.metadata.creationTimestamp,
          );
        }
      }

      setResources(containerList);
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
      title="Containers"
      description="All containers running in this cluster."
      resources={resources}
      columns={[
        {
          title: "Pod",
          key: "resource.k8s.pod.name",
        },
        {
          title: "Restarts",
          key: "restarts",
        },
      ]}
      getViewRoute={(resource: KubernetesResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_CONTAINER_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: new ObjectID(resource.name),
          },
        );
      }}
    />
  );
};

export default KubernetesClusterContainers;
