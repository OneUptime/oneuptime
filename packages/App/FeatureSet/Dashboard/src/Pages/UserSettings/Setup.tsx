import SetupChecklist from "../../Components/UserSettings/SetupChecklist/SetupChecklist";
import { SetupChecklist as SetupChecklistData } from "../../Components/UserSettings/SetupChecklist/ChecklistModel";
import { readLandingHandOver } from "./Landing";
import PageComponentProps from "../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import { Location, useLocation } from "react-router-dom";

/*
 * The first page of User Settings, and the only one that explains the others.
 *
 * The layout above supplies the page chrome, the breadcrumbs and the side menu,
 * so this is deliberately nothing but identity plus the checklist: the
 * signed-in user and the project they are looking at are the only two facts the
 * card needs, and reading them here rather than inside the card keeps the card
 * mountable from anywhere else that already has them.
 *
 * Opened by User Settings' own address while essential steps are left
 * (#7039), it is handed the checklist that address just read, and draws it
 * without reading it again.
 */
const UserSettingsSetup: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: ObjectID | null = User.getUserId();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const location: Location = useLocation();

  const handedOver: SetupChecklistData | null = readLandingHandOver({
    state: location.state,
    userId: userId?.toString() || "",
    projectId: projectId?.toString() || "",
  });

  return (
    <Fragment>
      <SetupChecklist
        userId={userId}
        projectId={projectId}
        initialChecklist={handedOver}
      />
    </Fragment>
  );
};

export default UserSettingsSetup;
