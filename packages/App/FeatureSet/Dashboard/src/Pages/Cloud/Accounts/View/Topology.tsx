import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import ResourceTopologyPage from "../../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadCloudAccountTopology } from "../../../../Components/ResourceTopology/Loaders/CloudAccountTopologyLoader";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A cloud account's Topology: its regions, and in them its resources the
 * way its inventory relates them, coloured by how each is doing.
 */
const CloudAccountTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadCloudAccountTopology(modelId);
      }}
      description="How this account's networks, machines, databases and queues fit together, and which of them need attention."
      searchPlaceholder="Find a resource, type or region…"
      emptyDescription="The map appears once a cloud connection lists this account's resources. Connect the account to list them."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.CLOUD_CONNECT] as Route,
      )}
      actionText="Connect a cloud account"
    />
  );
};

export default CloudAccountTopology;
