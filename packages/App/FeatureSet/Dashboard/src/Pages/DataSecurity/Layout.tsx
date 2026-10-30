import { getDataSecurityBreadcrumbs } from "../../Utils/Breadcrumbs/DataSecurityBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import DataSecuritySideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * Every Data Security page but a store's and an issue's, which open on
 * pages of their own under their own side menus. The side menu is the
 * product's map (Utils/DataSecurityNavigation.ts).
 */
const DataSecurityLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Data Security"
      breadcrumbLinks={getDataSecurityBreadcrumbs(path)}
      sideMenu={<DataSecuritySideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default DataSecurityLayout;
