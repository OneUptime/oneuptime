import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadVMwareTopology } from "../../../Components/ResourceTopology/Loaders/VMwareTopologyLoader";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A vCenter's Topology: its datacenters, clusters, ESXi hosts, virtual
 * machines, datastores and resource pools as one map, coloured by how each
 * is doing, with the open incidents and alerts on the part they are about.
 */
const VMwareVCenterTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadVMwareTopology(modelId);
      }}
      description="How this vCenter's datacenters, clusters, ESXi hosts, virtual machines and datastores fit together, and which of them need attention."
      searchPlaceholder="Find a host, virtual machine or datastore…"
      emptyDescription="The map appears once this vCenter's inventory arrives. Its Overview says whether OneUptime is collecting it."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.VMWARE_VCENTER_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default VMwareVCenterTopology;
