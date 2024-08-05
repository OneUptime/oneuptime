import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "CommonUI/src/Components/ModelDelete/ModelDelete";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import SideMenuComponent from "./SideMenu";
import User from "Common/AppModels/Models/User";
import ModelPage from "CommonUI/src/Components/Page/ModelPage";

const DeletePage: FunctionComponent = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      title={"User"}
      breadcrumbLinks={[
        {
          title: "Admin Dashboard",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Users",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
        {
          title: "User",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_VIEW] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <ModelDelete
        modelType={User}
        modelId={modelId}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.USERS] as Route);
        }}
      />
    </ModelPage>
  );
};

export default DeletePage;
