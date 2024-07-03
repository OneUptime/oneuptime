import MonitorTable from "../../Components/Monitor/MonitorTable";
import DashboardNavigation from "../../Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DisabledMonitors: FunctionComponent = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: DashboardNavigation.getProjectId()?.toString(),
        disableActiveMonitoring: true,
      }}
      disableCreate={true}
      noItemsMessage="No disabled monitors. All monitors in active state."
      title="Disabled Monitors"
      description="Here is a list of all the monitors which are in disabled state."
    />
  );
};

export default DisabledMonitors;
