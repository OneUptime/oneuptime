import { getDashboardBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardsSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const DashboardsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Dashboards"}
      breadcrumbLinks={getDashboardBreadcrumbs(path)}
      sideMenu={<DashboardsSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default DashboardsLayout;
