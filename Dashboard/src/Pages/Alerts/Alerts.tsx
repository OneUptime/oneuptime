import AlertsTable from "../../Components/Alert/AlertsTable";
import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const AlertsPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <AlertsTable
      query={{
        projectId: DashboardNavigation.getProjectId()!,
      }}
      saveFilterProps={{
        tableId: "all-alerts-table",
      }}
    />
  );
};

export default AlertsPage;
