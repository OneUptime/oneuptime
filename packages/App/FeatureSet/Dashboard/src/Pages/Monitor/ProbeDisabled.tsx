import MonitorTable from "../../Components/Monitor/MonitorTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The Monitors menu's No Probe Enabled: monitors no enabled probe checks,
 * because every probe of theirs is disabled or they have none. The page was
 * "Probe Disabled", which read as one probe being switched off (#9126). Its
 * address (`/monitors/probe-disabled`) did not change.
 */
const NoProbeEnabledMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        isNoProbeEnabledOnThisMonitor: true,
      }}
      disableCreate={true}
      noItemsMessage="No monitors without an enabled probe. Every monitor that probes check has at least one enabled."
      emptyState={{ isAllClear: true }}
      title="Monitors with No Probe Enabled"
      description="Monitors that no enabled probe checks: their probes are all disabled, or they have none. Enable a probe on the monitor, or add one, to start the checks again."
    />
  );
};

export default NoProbeEnabledMonitors;
