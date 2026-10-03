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
        isNoProbeEnabledOnThisMonitor: true,
      }}
      disableCreate={true}
      noItemsMessage="No monitors with disabled probes. All your monitors are being monitored."
      emptyState={{ isAllClear: true }}
      title="Monitors with all probes disabled"
      description="Monitors whose probes are all disabled, so nothing is checking them. Enable a probe, or add another one, to start the checks again."
    />
  );
};

export default DisabledMonitors;
