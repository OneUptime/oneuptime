import { getMonitorBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Page from "CommonUI/src/Components/Page/Page";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const MonitorLayout: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Monitors"}
      breadcrumbLinks={getMonitorBreadcrumbs(path)}
      sideMenu={
        <DashboardSideMenu project={props.currentProject || undefined} />
      }
    >
      <Outlet />
    </Page>
  );
};

export default MonitorLayout;
