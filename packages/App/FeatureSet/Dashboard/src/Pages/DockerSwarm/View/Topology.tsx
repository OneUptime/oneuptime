import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadDockerSwarmTopology } from "../../../Components/ResourceTopology/Loaders/InventoryTopologyLoaders";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A Docker Swarm cluster's Topology: its stacks, services and tasks,
 * grouped by service or by the node each task runs on, coloured by how
 * each is doing.
 */
const DockerSwarmClusterTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadDockerSwarmTopology(modelId);
      }}
      description="How this cluster's stacks, services, tasks and nodes fit together, and which of them need attention."
      searchPlaceholder="Find a service, task, stack or node…"
      emptyDescription="The map appears once the Docker Swarm agent sends this cluster's inventory. Its Overview says how to install the agent."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.DOCKER_SWARM_CLUSTER_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default DockerSwarmClusterTopology;
