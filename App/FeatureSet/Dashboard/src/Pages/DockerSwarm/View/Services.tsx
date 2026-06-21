import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  fetchDockerSwarmInventoryResources,
  routeParamFromExternalId,
} from "../Utils/DockerSwarmResourceUtils";
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

const DockerSwarmClusterServices: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Postgres inventory read (DockerSwarmResource, kind=Service).
       * Service mode, replica counts and image ride the inventory row;
       * the stack name groups the table.
       */
      const serviceList: Array<InfrastructureResource> =
        await fetchDockerSwarmInventoryResources({
          dockerSwarmClusterId: modelId,
          kind: "Service",
        });

      setResources(serviceList);
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
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Services"
      description="Replicated and global services in this swarm with their current replica health and resource usage."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Stack"
      groupFallbackLabel="(no stack)"
      tableIdPrefix="docker-swarm"
      emptyMessage="No services reported yet. Make sure the Docker Swarm agent is sending metrics."
      columns={[
        {
          title: "Mode",
          key: "serviceMode",
        },
        {
          title: "Replicas",
          key: "replicas",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["replicas"] || "—";
          },
        },
        {
          title: "Image",
          key: "image",
          getValue: (resource: InfrastructureResource): string => {
            return resource.additionalAttributes["image"] || "-";
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: routeParamFromExternalId(
              resource.additionalAttributes["externalId"] || "",
            ),
          },
        );
      }}
    />
  );
};

export default DockerSwarmClusterServices;
