import SetupChecklist from "../../Components/UserSettings/SetupChecklist/SetupChecklist";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * The first page of User Settings, and the only one that explains the others.
 *
 * The layout above supplies the page chrome, the breadcrumbs and the side menu,
 * so this is deliberately nothing but identity plus the checklist: the
 * signed-in user and the project they are looking at are the only two facts the
 * card needs, and reading them here rather than inside the card keeps the card
 * mountable from anywhere else that already has them.
 */
const UserSettingsSetup: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: ObjectID | null = User.getUserId();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  return (
    <Fragment>
      <SetupChecklist userId={userId} projectId={projectId} />
    </Fragment>
  );
};

export default UserSettingsSetup;
