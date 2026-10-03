import IncidentsTable from "../../Components/Incident/IncidentsTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const IncidentsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <IncidentsTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        currentIncidentState: {
          isResolvedState: false,
        },
      }}
      emptyState={{
        isAllClear: true,
        title: "No active incidents",
        description: "Nice work! Every incident is resolved.",
      }}
      title="Active Incidents"
      description="Incidents that are not resolved yet: problems affecting your users right now. View an incident to see who is responding and to post updates."
    />
  );
};

export default IncidentsPage;
