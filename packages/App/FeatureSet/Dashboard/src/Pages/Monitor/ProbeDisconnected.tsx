import MonitorTable from "../../Components/Monitor/MonitorTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const DisabledMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        isAllProbesDisconnectedFromThisMonitor: true,
      }}
      disableCreate={true}
      noItemsMessage="No monitors with disconnected probes. All your monitors are being monitored."
      title="Monitors with all probes disconnected"
      description="Monitors whose probes are all disconnected, so nothing is checking them. Reconnect a probe, or add one that is connected, to start the checks again."
    />
  );
};

export default DisabledMonitors;
