import AlertEpisodesTable from "../../Components/AlertEpisode/AlertEpisodesTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const EpisodesPage: FunctionComponent<PageComponentProps> = (): ReactElement => {
  return (
    <AlertEpisodesTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
      saveFilterProps={{
        tableId: "all-episodes-table",
      }}
    />
  );
};

export default EpisodesPage;
