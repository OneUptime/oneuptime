import AlertsTable from "../../Components/Alert/AlertsTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const AlertsPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <AlertsTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      saveFilterProps={{
        tableId: "all-alerts-table",
      }}
    />
  );
};

export default AlertsPage;
