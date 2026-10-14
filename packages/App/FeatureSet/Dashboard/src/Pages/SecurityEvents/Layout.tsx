import { getSecurityEventsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SecurityEventsSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * Every Security Events page but a case's and a playbook's, which open on
 * their own full-width pages. The menu is the product's map
 * (SecurityEventsNavigation.ts).
 */
const SecurityEventsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Security Events"
      breadcrumbLinks={getSecurityEventsBreadcrumbs(path)}
      sideMenu={<SecurityEventsSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default SecurityEventsLayout;
