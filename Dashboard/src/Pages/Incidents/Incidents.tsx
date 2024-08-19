import IncidentsTable from "../../Components/Incident/IncidentsTable";
import DashboardNavigation from "../../Utils/Navigation";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <IncidentsTable
      query={{
        projectId: DashboardNavigation.getProjectId()!,
      }}
    />
  );
};

export default IncidentsPage;
