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
        currentIncidentState: {
          isResolvedState: false,
        },
      }}
      noItemsMessage="Nice work! No Active Incidents so far."
      title="Active Incidents"
      description="Here is a list of all the Active Incidents for this project."
    />
  );
};

export default IncidentsPage;
