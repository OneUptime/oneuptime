import { getTeamsBreadcrumbs } from "../../Utils/Breadcrumbs/TeamsBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const TeamsLayout: FunctionComponent = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page title={"Teams"} breadcrumbLinks={getTeamsBreadcrumbs(path)}>
      <Outlet />
    </Page>
  );
};

export default TeamsLayout;
