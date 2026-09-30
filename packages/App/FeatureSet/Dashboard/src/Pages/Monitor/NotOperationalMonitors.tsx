import MonitorTable from "../../Components/Monitor/MonitorTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const NotOperationalMonitors: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <MonitorTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        currentMonitorStatus: {
          isOperationalState: false,
        },
      }}
      noItemsMessage="No monitors are reporting a problem."
      title="Not Operational Monitors"
      description="Monitors whose current status is not operational, such as Degraded or Offline. View a monitor to see what changed."
    />
  );
};

export default NotOperationalMonitors;
