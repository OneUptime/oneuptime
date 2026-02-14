import MonitorTable from "../../Components/Monitor/MonitorTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const DisabledMonitors: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        isNoProbeEnabledOnThisMonitor: true,
      }}
      disableCreate={true}
      noItemsMessage="No monitors with disabled probes. All your monitors are being monitored."
      title="Monitors with all probes disabled"
      description="Here is a list of all the monitors where all probes are disabled. These monitors are not being monitored."
    />
  );
};

export default DisabledMonitors;
