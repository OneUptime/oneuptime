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
      noItemsMessage="No monitors with disabled probes. All your monitors are being monitored."
      title="Monitors with all probes disabled"
      description="Here is a list of all the monitors where all probes are disabled. These monitors are not being monitored."
    />
  );
};

export default DisabledMonitors;
