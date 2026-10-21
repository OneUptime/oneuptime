import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadCephTopology } from "../../../Components/ResourceTopology/Loaders/InventoryTopologyLoaders";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A Ceph cluster's Topology: its hosts and the daemons on them (OSDs,
 * monitors, managers, metadata servers, gateways), and its pools, coloured
 * by how each is doing.
 */
const CephClusterTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadCephTopology(modelId);
      }}
      description="How this cluster's hosts, daemons and pools fit together, and which of them need attention."
      searchPlaceholder="Find a host, OSD or pool…"
      emptyDescription="The map appears once this cluster's inventory arrives. Its Overview says how to connect it."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.CEPH_CLUSTER_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default CephClusterTopology;
