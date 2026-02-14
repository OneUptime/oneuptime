import MonitorTable from "../../Components/Monitor/MonitorTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const DisabledMonitors: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        isAllProbesDisconnectedFromThisMonitor: true,
      }}
      disableCreate={true}
      noItemsMessage="No monitors with disconnected probes. All your monitors are being monitored."
      title="Monitors with all probes disconnected"
      description="Here is a list of all the monitors where all probes are disconnected. These monitors are not being monitored."
    />
  );
};

export default DisabledMonitors;
