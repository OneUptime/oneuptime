import { getScheduleMaintenanceBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const ScheduledMaintenancesLayout: FunctionComponent<
  LayoutPageComponentProps
> = (props: LayoutPageComponentProps): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Scheduled Maintenance Events"}
      sideMenu={
        props.hideSideMenu ? undefined : (
          <SideMenu project={props.currentProject || undefined} />
        )
      }
      breadcrumbLinks={getScheduleMaintenanceBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default ScheduledMaintenancesLayout;
