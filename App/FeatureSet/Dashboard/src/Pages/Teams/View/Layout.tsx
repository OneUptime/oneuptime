import { getTeamsBreadcrumbs } from "../../../Utils/Breadcrumbs/TeamsBreadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import TeamViewSideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import Team from "Common/Models/DatabaseModels/Team";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const TeamViewLayout: FunctionComponent = (): ReactElement => {
  const { modelId: idParam } = useParams();
  const modelId: ObjectID = new ObjectID(idParam || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="Team"
      modelType={Team}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getTeamsBreadcrumbs(path)}
      sideMenu={<TeamViewSideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default TeamViewLayout;
