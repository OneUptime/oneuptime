import AlertEpisodesTable from "../../Components/AlertEpisode/AlertEpisodesTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const UnresolvedEpisodesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <AlertEpisodesTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        resolvedAt: null as any,
      }}
      title="Active Episodes"
      description="Here is a list of active (unresolved) alert episodes for this project."
      noItemsMessage="No active episodes. All episodes are resolved."
      saveFilterProps={{
        tableId: "unresolved-episodes-table",
      }}
    />
  );
};

export default UnresolvedEpisodesPage;
