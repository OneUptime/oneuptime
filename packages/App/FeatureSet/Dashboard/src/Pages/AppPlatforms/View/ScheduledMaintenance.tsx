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
 * An App Platforms environment's scheduled maintenance: the events that
 * hold it. While one is in progress, the monitors of the apps it runs - an
 * app's recommended monitors, and those made from an app's or the
 * environment's tabs - open no incident or alert
 * (MonitorMaintenanceSuppression), and the app's page and the environment's
 * Overview say so. Create Scheduled Maintenance Event keeps the environment
 * picked. Every event here holds the environment, so the list leaves out
 * the column that would only say it again.
 */
const AppPlatformEnvironmentScheduledMaintenance: FunctionComponent<
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
        createFrom={{
          kind: CreateFromRecordKind.CloudEnvironment,
          id: modelId,
        }}
        viewPageRoute={RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS] as Route}
        description="Planned work on this environment. While an event is in progress, the monitors of its apps open no incidents or alerts."
        noItemsMessage="No scheduled maintenance events for this environment."
        leaveOutAffectedResources={true}
      />
    </Fragment>
  );
};

export default AppPlatformEnvironmentScheduledMaintenance;
