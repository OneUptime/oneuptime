import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadHostTopology } from "../../../Components/ResourceTopology/Loaders/HostTopologyLoader";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A host's Topology: the containers and services running on it, the
 * services, databases and endpoints they call, and the services that call
 * them, coloured by how each is doing.
 */
const HostTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadHostTopology(modelId);
      }}
      description="How the services and containers on this host fit together, what they call and what calls them, and which of them need attention."
      searchPlaceholder="Find a service, container or database…"
      emptyDescription="The map appears once services on this host send telemetry. Its Overview says how to install the agent and instrument your services."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOST_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default HostTopology;
