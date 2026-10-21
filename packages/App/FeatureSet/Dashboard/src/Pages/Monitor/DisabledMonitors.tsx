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
      emptyState={{ isAllClear: true }}
      title="Disabled Monitors"
      description="Monitors that are switched off. They run no checks and open no incidents or alerts until you enable them again."
    />
  );
};

export default DisabledMonitors;
