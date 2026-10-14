import IconProp from "Common/Types/Icon/IconProp";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What a project a master admin blocked (Admin Dashboard > Projects) shows
 * its members, in place of the page they opened: every request for it is
 * refused until it is unblocked (ProjectBlockedException), so there is
 * nothing to show but why. The header stays, so its project picker still
 * switches to their other projects, and their own pages (profile, log out)
 * still open (MasterPage).
 */
const ProjectBlocked: FunctionComponent = (): ReactElement => {
  return (
    <EmptyState
      id="project-blocked"
      icon={IconProp.Lock}
      title="This project has been blocked"
      description="An administrator has blocked this project. Until it is unblocked, it cannot be opened, its API keys and integrations do not work, and its monitors, workflows and notifications are stopped. Please contact your administrator, or switch to another project with the project picker above."
    />
  );
};

export default ProjectBlocked;
