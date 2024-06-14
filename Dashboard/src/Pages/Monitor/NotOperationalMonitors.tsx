import MonitorTable from "../../Components/Monitor/MonitorTable";
import DashboardNavigation from "../../Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const NotOperationalMonitors: FunctionComponent = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: DashboardNavigation.getProjectId()?.toString(),
        currentMonitorStatus: {
          isOperationalState: false,
        },
      }}
      noItemsMessage="All monitors in operational state."
      title="Inoperational Monitors"
      description="Here is a list of all the monitors which are not in operational state."
    />
  );
};

export default NotOperationalMonitors;
