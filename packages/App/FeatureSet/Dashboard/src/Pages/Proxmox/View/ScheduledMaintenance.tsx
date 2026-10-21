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

const ProxmoxClusterScheduledMaintenance: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<ScheduledMaintenance> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.proxmoxClusters = new Includes([modelId]);
  }

  return (
    <Fragment>
      <ScheduledMaintenancesTable
        query={query}
        createFrom={{ kind: CreateFromRecordKind.ProxmoxCluster, id: modelId }}
        viewPageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route}
        noItemsMessage="No scheduled maintenance events for this cluster."
      />
    </Fragment>
  );
};

export default ProxmoxClusterScheduledMaintenance;
