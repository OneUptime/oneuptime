import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Link from "Common/Types/Link";
import Route from "Common/Types/API/Route";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement, Suspense } from "react";
import { Outlet } from "react-router-dom";

/*
 * Home's frame. Home is one page, the overview, and it has no side menu: it
 * draws what needs attention itself, and each thing it counts - active
 * incidents, active alerts, monitors that are not operational, maintenance
 * in progress, SLOs at risk - opens that product's own list, where its side
 * menu, filters and actions are. Home used to keep copies of six such lists
 * under a menu of its own, so its Active Alerts opened a Home page instead of
 * the one in Alerts; their addresses forward to the products' lists now
 * (Routes/MovedHomeRoutes).
 */
const HomeLayout: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const homeRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.HOME] as Route,
  );

  const breadcrumbLinks: Array<Link> = [
    {
      title: "Project",
      to: homeRoute,
    },
    {
      title: "Home",
      to: homeRoute,
    },
  ];

  return (
    <Page title="Home" breadcrumbLinks={breadcrumbLinks}>
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <Outlet />
      </Suspense>
    </Page>
  );
};

export default HomeLayout;
