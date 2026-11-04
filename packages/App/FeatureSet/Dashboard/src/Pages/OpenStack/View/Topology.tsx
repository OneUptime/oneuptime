import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadOpenStackTopology } from "../../../Components/ResourceTopology/Loaders/OpenStackTopologyLoader";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A cloud's Topology: where its instances run, what they are attached to and whose they
 * are, coloured by the same rules as its Needs attention.
 */
const OpenStackCloudTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadOpenStackTopology(modelId);
      }}
      description="How this cloud's regions, hypervisors, instances, volumes and networks fit together, whose they are, and which of them need attention."
      searchPlaceholder="Find a hypervisor, instance, project or network…"
      emptyDescription="The map appears once this cloud's inventory arrives. Its Overview says how to connect it."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.OPENSTACK_CLOUD_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default OpenStackCloudTopology;
