import MonitorTable from "../../Components/Monitor/MonitorTable";
import DashboardNavigation from "../../Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";

const DisabledMonitors: FunctionComponent = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: DashboardNavigation.getProjectId()?.toString(),
        isAllProbesDisconnectedFromThisMonitor: true,
      }}
      noItemsMessage="No monitors with disconnected probes. All your monitors are being monitored."
      title="Monitors with all probes disconnected"
      description="Here is a list of all the monitors where all probes are disconnected. These monitors are not being monitored."
    />
  );
};

export default DisabledMonitors;
