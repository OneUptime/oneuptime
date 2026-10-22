import PostmortemsTable from "../../Components/Postmortem/PostmortemsTable";
import PageComponentProps from "../PageComponentProps";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Incidents > Postmortems: every incident's postmortem across the project,
 * to view and filter by owner, severity and status - which are still owed.
 */
const PostmortemsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <PostmortemsTable
      query={{
        projectId: ProjectUtil.getCurrentProjectId()!,
      }}
    />
  );
};

export default PostmortemsPage;
