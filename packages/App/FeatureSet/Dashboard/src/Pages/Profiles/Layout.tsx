import { getProfilesBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * One product, one name. Every page under the Profiler carries a
 * "Profiler — <section>" title that matches its side-menu entry, so
 * the user never has to guess whether "insights", "raw profiles" and
 * "find what's slow" are the same thing.
 */
function getPageTitle(path: string): string {
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_INSIGHTS)) {
    return "Profiler — All profiles";
  }
  if (path === RouteUtil.getRouteString(PageMap.PROFILES_DOCUMENTATION)) {
    return "Profiler — Setup guide";
  }
  return "Profiler — Overview";
}

const ProfilesLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title={getPageTitle(path)}
      breadcrumbLinks={getProfilesBreadcrumbs(path)}
      sideMenu={<SideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default ProfilesLayout;
