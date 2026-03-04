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
      }}
      saveFilterProps={{
        tableId: "all-incidents-table",
      }}
    />
  );
};

export default IncidentsPage;
