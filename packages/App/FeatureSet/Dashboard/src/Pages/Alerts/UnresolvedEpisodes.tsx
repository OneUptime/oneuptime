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
      description="Episodes group related alerts so you can respond to them together. These are the episodes that are not resolved yet."
      noItemsMessage="No active episodes. All episodes are resolved."
      emptyState={{ isAllClear: true }}
      saveFilterProps={{
        tableId: "unresolved-episodes-table",
      }}
    />
  );
};

export default UnresolvedEpisodesPage;
