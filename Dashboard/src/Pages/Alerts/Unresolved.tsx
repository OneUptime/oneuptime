import AlertsTable from "../../Components/Alert/AlertsTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const AlertsPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <AlertsTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        currentAlertState: {
          isResolvedState: false,
        },
      }}
      noItemsMessage="Nice work! No Active Alerts so far."
      title="Active Alerts"
      description="Here is a list of all the Active Alerts for this project."
    />
  );
};

export default AlertsPage;
