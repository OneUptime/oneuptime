import Includes from "Common/Types/BaseDatabase/Includes";
import ScheduledMaintenancesTable from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import { CreateFromRecordKind } from "../../../Components/CreateFromRecord/CreateFromRecord";
import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Query from "Common/Types/BaseDatabase/Query";
import ProjectUtil from "Common/UI/Utils/Project";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";

/*
 * A maintenance event is linked to a whole cloud and names no region, so there is nothing to
 * narrow this list by. Whoever is reading one region is told that, rather than left to take
 * every region's events for that region's.
 */
const OpenStackCloudScheduledMaintenance: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);
  const { region }: OpenStackRegionState = useOpenStackRegion();

  const query: Query<ScheduledMaintenance> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.openStackClouds = new Includes([modelId]);
  }

  return (
    <Fragment>
      {region ? (
        <OpenStackPartNotice
          testId="openstack-maintenance-whole-cloud"
          tone="neutral"
          text="Maintenance events belong to the whole cloud rather than to one region, so this list is the same in every region."
        />
      ) : (
        <></>
      )}
      <ScheduledMaintenancesTable
        query={query}
        createFrom={{ kind: CreateFromRecordKind.OpenStackCloud, id: modelId }}
        viewPageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route}
        noItemsMessage="No maintenance events for this cloud."
      />
    </Fragment>
  );
};

export default OpenStackCloudScheduledMaintenance;
