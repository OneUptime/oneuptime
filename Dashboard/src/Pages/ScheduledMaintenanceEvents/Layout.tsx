import { getScheduleMaintenanceBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Page from "CommonUI/src/Components/Page/Page";
import Navigation from "CommonUI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const ScheduledMaintenancesLayout: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Scheduled Maintenance Events"}
      sideMenu={<SideMenu project={props.currentProject || undefined} />}
      breadcrumbLinks={getScheduleMaintenanceBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default ScheduledMaintenancesLayout;
