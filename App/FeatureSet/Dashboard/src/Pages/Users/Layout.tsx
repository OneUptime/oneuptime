import { getUsersBreadcrumbs } from "../../Utils/Breadcrumbs/UsersBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import UsersSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const UsersLayout: FunctionComponent = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title={"Users"}
      breadcrumbLinks={getUsersBreadcrumbs(path)}
      sideMenu={<UsersSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default UsersLayout;
