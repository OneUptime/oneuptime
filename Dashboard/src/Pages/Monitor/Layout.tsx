import { getMonitorBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const MonitorLayout: FunctionComponent<LayoutPageComponentProps> = (
  props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Monitors"}
      breadcrumbLinks={getMonitorBreadcrumbs(path)}
      sideMenu={
        props.hideSideMenu ? undefined : (
          <DashboardSideMenu project={props.currentProject || undefined} />
        )
      }
    >
      <Outlet />
    </Page>
  );
};

export default MonitorLayout;
