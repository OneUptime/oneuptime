import MonitorTable from "../../Components/Monitor/MonitorTable";
import ProjectUtil from "Common/UI/Utils/Project";
import NotOperationalMonitorQuery from "Common/Utils/Monitor/NotOperationalMonitorQuery";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Leaves out monitors whose monitoring is turned off: nothing checks them,
 * so the status they hold is stale, and the Disabled list shows them
 * (NotOperationalMonitorQuery). The menu's badge counts the same monitors.
 */
const NotOperationalMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        ...NotOperationalMonitorQuery.getQuery(),
      }}
      noItemsMessage="No monitors are reporting a problem."
      emptyState={{ isAllClear: true }}
      title="Not Operational Monitors"
      description="Monitors whose current status is not operational, such as Degraded or Offline. Monitors with monitoring turned off are not listed. View a monitor to see what changed."
    />
  );
};

export default NotOperationalMonitors;
