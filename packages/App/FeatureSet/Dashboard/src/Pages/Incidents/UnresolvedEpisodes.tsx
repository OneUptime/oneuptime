import IncidentEpisodesTable from "../../Components/IncidentEpisode/IncidentEpisodesTable";
import ProjectUtil from "Common/UI/Utils/Project";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

const UnresolvedEpisodesPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <IncidentEpisodesTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
        resolvedAt: null as any,
      }}
      title="Active Episodes"
      description="Episodes group related incidents so you can respond to them together. These are the episodes that are not resolved yet."
      noItemsMessage="No active episodes. All episodes are resolved."
      emptyState={{ isAllClear: true }}
      saveFilterProps={{
        tableId: "unresolved-incident-episodes-table",
      }}
    />
  );
};

export default UnresolvedEpisodesPage;
