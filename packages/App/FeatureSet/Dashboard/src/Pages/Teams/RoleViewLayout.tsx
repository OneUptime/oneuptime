import { getTeamsBreadcrumbs } from "../../Utils/Breadcrumbs/TeamsBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import TeamRoleViewSideMenu from "./RoleViewSideMenu";
import CustomRole from "Common/Models/DatabaseModels/CustomRole";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

/*
 * A CUSTOM ROLE'S PAGES (#10139): the role's own page (RoleView, which
 * draws the Enterprise page or its upsell) and its Developer pages, under
 * the role's own side menu (RoleViewSideMenu) - as a team's pages are under
 * the team's (Pages/Teams/View/Layout).
 *
 * Headed "Custom Role - Incident Responder", and the trail names the role
 * where it said "View Role", on every page of it: Project > Teams > Roles >
 * Incident Responder > API (ModelPage, RecordNameInTrail). Its name, saved
 * on the role's details card, reaches the heading and the trail at once
 * (ModelHeaderEvents).
 */
const TeamRoleViewLayout: FunctionComponent = (): ReactElement => {
  const { id: idParam } = useParams();
  const modelId: ObjectID = new ObjectID(idParam || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <ModelPage
      title="Custom Role"
      modelType={CustomRole}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getTeamsBreadcrumbs(path)}
      sideMenu={<TeamRoleViewSideMenu modelId={modelId} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default TeamRoleViewLayout;
