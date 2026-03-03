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
      noItemsMessage="All monitors in operational state."
      title="Inoperational Monitors"
      description="Here is a list of all the monitors which are not in operational state."
    />
  );
};

export default NotOperationalMonitors;
