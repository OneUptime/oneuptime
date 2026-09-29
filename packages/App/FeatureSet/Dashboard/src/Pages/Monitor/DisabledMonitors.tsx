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
        disableActiveMonitoring: true,
      }}
      disableCreate={true}
      noItemsMessage="No disabled monitors. All monitors in active state."
      title="Disabled Monitors"
      description="Here is a list of all the monitors which are in disabled state."
    />
  );
};

export default DisabledMonitors;
