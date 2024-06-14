import MonitorTable from "../../Components/Monitor/MonitorTable";
import DashboardNavigation from "../../Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";

const DisabledMonitors: FunctionComponent = (): ReactElement => {
  return (
    <MonitorTable
      viewPageRoute={RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITORS] as Route,
      )}
      query={{
        projectId: DashboardNavigation.getProjectId()?.toString(),
        disableActiveMonitoring: true,
      }}
      noItemsMessage="No disabled monitors. All monitors in active state."
      title="Disabled Monitors"
      description="Here is a list of all the monitors which are in disabled state."
    />
  );
};

export default DisabledMonitors;
