import ScheduledMaintenancesTable from "../../Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import { takePreviousCalendarChoice } from "../../Components/ScheduledMaintenance/ScheduledMaintenanceView";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import { useParams } from "react-router-dom";

/*
 * Scheduled Maintenance > All Events: the project's events as a list. The
 * calendar is a page of its own, under the side menu's Calendar
 * (Calendar.tsx); a reader who had left this list on its old Calendar
 * switch is taken there once (ScheduledMaintenanceView).
 */
const ScheduledMaintenancesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { projectId } = useParams();
  const projectObjectId: ObjectID = new ObjectID(projectId || "");

  useEffect(() => {
    if (takePreviousCalendarChoice()) {
      Navigation.navigate(
        RouteUtil.populateRouteParams(
          RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS_CALENDAR] as Route,
        ),
        { replace: true },
      );
    }
  }, []);

  return (
    <ScheduledMaintenancesTable
      viewPageRoute={Navigation.getCurrentRoute()}
      query={{
        projectId: projectObjectId,
      }}
      saveFilterProps={{
        tableId: "all-scheduled-maintenance-events-table",
      }}
    />
  );
};

export default ScheduledMaintenancesPage;
