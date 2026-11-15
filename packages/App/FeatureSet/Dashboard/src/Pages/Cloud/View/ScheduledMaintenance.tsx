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

/*
 * A cloud resource's scheduled maintenance: the events that hold it. While
 * one is in progress, the monitors that read the resource's metrics - its
 * recommended monitors, and those made from its Metrics tab - open no
 * incident or alert (MonitorMaintenanceSuppression). Create Scheduled
 * Maintenance Event keeps the resource picked.
 */
const CloudResourceScheduledMaintenance: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const query: Query<ScheduledMaintenance> = {
    projectId: ProjectUtil.getCurrentProjectId()!,
  };

  if (modelId) {
    query.cloudResources = new Includes([modelId]);
  }

  return (
    <Fragment>
      <ScheduledMaintenancesTable
        query={query}
        createFrom={{ kind: CreateFromRecordKind.CloudResource, id: modelId }}
        viewPageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route}
        noItemsMessage="No maintenance events for this resource."
      />
    </Fragment>
  );
};

export default CloudResourceScheduledMaintenance;
