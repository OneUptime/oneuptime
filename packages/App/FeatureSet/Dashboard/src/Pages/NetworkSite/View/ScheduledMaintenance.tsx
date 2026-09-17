import PageComponentProps from "../../PageComponentProps";
import ScheduledMaintenancesTable from "../../../Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import PageMap from "../../../Utils/PageMap";
import RouteMap from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Maintenance events attached to THIS site.
 *
 * Deliberately not events attached to an ancestor, even though those cover
 * this site too: this page is the list you edit, and showing a window you
 * cannot detach here (because it belongs to the Region) as if you could
 * would be worse than not showing it. The uptime figures on the Overview and
 * Status Timeline pages do account for ancestor windows.
 */
const NetworkSiteScheduledMaintenance: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<ScheduledMaintenance> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.networkSites = new Includes([modelId]);
  }

  return (
    <Fragment>
      <ScheduledMaintenancesTable
        query={query}
        disableCreate={true}
        viewPageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route}
        noItemsMessage="No scheduled maintenance events for this site. Attach this site to an event to exclude its planned downtime from uptime."
      />
    </Fragment>
  );
};

export default NetworkSiteScheduledMaintenance;
