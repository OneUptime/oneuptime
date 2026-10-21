import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import ResourceTopologyPage from "../../../Components/ResourceTopology/ResourceTopologyPage";
import { loadStorageArrayTopology } from "../../../Components/ResourceTopology/Loaders/InventoryTopologyLoaders";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";

/*
 * A storage array's Topology: its hosts and host groups, pods and volumes,
 * file systems and buckets, and its hardware, coloured by how each is
 * doing.
 */
const StorageArrayTopology: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ResourceTopologyPage
      load={() => {
        return loadStorageArrayTopology(modelId);
      }}
      description="How this array's hosts, volumes, file systems and hardware fit together, and which of them need attention."
      searchPlaceholder="Find a volume, host or drive…"
      emptyDescription="The map appears once this array's inventory arrives. Its Overview says how to connect it."
      emptyActionRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route,
        { modelId: modelId },
      )}
      actionText="Open the Overview"
    />
  );
};

export default StorageArrayTopology;
