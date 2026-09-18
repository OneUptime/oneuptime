import IncidentEpisodesTable from "../../Components/IncidentEpisode/IncidentEpisodesTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const EpisodesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <IncidentEpisodesTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      saveFilterProps={{
        tableId: "all-incident-episodes-table",
      }}
    />
  );
};

export default EpisodesPage;
