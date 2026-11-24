import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadXcpNgTopology } from "../../../Components/ResourceTopology/Loaders/InventoryTopologyLoaders";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * An XCP-ng pool's Topology: its hosts, the VMs each one runs and the
 * storage repositories they use - shared ones on the pool, local ones on
 * their host - coloured by how each is doing, by the rules of the pool's
 * Overview (Builders/XcpNgTopology).
 */
const XcpNgPoolTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadXcpNgTopology(modelId);
      }}
      description="How this pool's hosts, VMs and storage repositories fit together, and which of them need attention."
      searchPlaceholder="Find a host, VM or storage repository…"
      emptyDescription="The map appears once Xen Orchestra reports this pool's hosts. Its Overview says how to connect it."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default XcpNgPoolTopology;
