import PageComponentProps from "../../PageComponentProps";
import TeamPermissionTable, {
  PermissionType,
} from "../../../Components/Team/TeamPermissionTable";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const TeamViewPermissions: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <TeamPermissionTable
        teamId={modelId}
        permissionType={PermissionType.AllowPermissions}
        currentProject={props.currentProject}
      />
    </Fragment>
  );
};

export default TeamViewPermissions;
