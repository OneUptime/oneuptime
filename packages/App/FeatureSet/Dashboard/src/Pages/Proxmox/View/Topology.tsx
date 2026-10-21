import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadProxmoxTopology } from "../../../Components/ResourceTopology/Loaders/InventoryTopologyLoaders";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A Proxmox cluster's Topology: its nodes, their virtual machines and
 * containers, and their storage, coloured by how each is doing.
 */
const ProxmoxClusterTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadProxmoxTopology(modelId);
      }}
      description="How this cluster's nodes, virtual machines, containers and storage fit together, and which of them need attention."
      searchPlaceholder="Find a node, guest or storage…"
      emptyDescription="The map appears once this cluster's inventory arrives. Its Overview says how to connect it."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default ProxmoxClusterTopology;
