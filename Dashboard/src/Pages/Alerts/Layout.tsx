import { getAlertsBreadcrumbs } from "../../Utils/Breadcrumbs/AlertBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const AlertsLayout: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Alerts"}
      sideMenu={<SideMenu project={props.currentProject || undefined} />}
      breadcrumbLinks={getAlertsBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default AlertsLayout;
