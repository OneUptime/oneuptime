import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import RemoveUserFromProject from "../../../Components/User/RemoveUserFromProject";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const UserViewDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const userId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <Fragment>
      <RemoveUserFromProject
        userId={userId}
        projectId={ProjectUtil.getCurrentProjectId()!}
        onError={async () => {
          // do nothing.
        }}
        onActionComplete={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(RouteMap[PageMap.SETTINGS_USERS]!),
          );
        }}
      />
    </Fragment>
  );
};

export default UserViewDelete;
