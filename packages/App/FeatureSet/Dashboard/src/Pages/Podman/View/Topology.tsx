import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadPodmanHostTopology } from "../../../Components/ResourceTopology/Loaders/ContainerHostTopologyLoader";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A Podman host's Topology: its Compose projects, containers, images,
 * networks and volumes, coloured by how each is doing.
 */
const PodmanHostTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadPodmanHostTopology(modelId);
      }}
      description="How this host's Compose projects, containers, images, networks and volumes fit together, and which of them need attention."
      searchPlaceholder="Find a container, project or image…"
      emptyDescription="The map appears once the Podman agent sends this host's inventory. Its Overview says how to install the agent."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.PODMAN_HOST_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default PodmanHostTopology;
