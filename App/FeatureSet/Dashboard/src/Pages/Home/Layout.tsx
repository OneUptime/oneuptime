import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Link from "Common/Types/Link";
import Route from "Common/Types/API/Route";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement, Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

interface HomePagePresentation {
  title: string;
  breadcrumb?: Link | undefined;
}

const normalizePath: (path: string) => string = (path: string): string => {
  return path.replace(/\/+$/, "");
};

const HomeLayout: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const homeRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.HOME] as Route,
  );

  const routePresentation: Array<{
    route: Route;
    presentation: HomePagePresentation;
  }> = [
    {
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOME_ACTIVE_ALERTS] as Route,
      ),
      presentation: { title: "Active Alerts" },
    },
    {
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOME_ACTIVE_EPISODES] as Route,
      ),
      presentation: {
        title: "Active Alert Episodes",
        breadcrumb: {
          title: "Active Episodes",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOME_ACTIVE_EPISODES] as Route,
          ),
        },
      },
    },
    {
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOME_ACTIVE_INCIDENT_EPISODES] as Route,
      ),
      presentation: {
        title: "Active Incident Episodes",
        breadcrumb: {
          title: "Active Incident Episodes",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOME_ACTIVE_INCIDENT_EPISODES] as Route,
          ),
        },
      },
    },
    {
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOME_NOT_OPERATIONAL_MONITORS] as Route,
      ),
      presentation: {
        title: "Inoperational Monitors",
        breadcrumb: {
          title: "Inoperational Monitors",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.HOME_NOT_OPERATIONAL_MONITORS] as Route,
          ),
        },
      },
    },
    {
      route: RouteUtil.populateRouteParams(
        RouteMap[PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS] as Route,
      ),
      presentation: {
        title: "Ongoing Scheduled Maintenance",
        breadcrumb: {
          title: "Ongoing Scheduled Maintenance",
          to: RouteUtil.populateRouteParams(
            RouteMap[
              PageMap.HOME_ONGOING_SCHEDULED_MAINTENANCE_EVENTS
            ] as Route,
          ),
        },
      },
    },
  ];

  const currentPath: string = normalizePath(location.pathname);
  const presentation: HomePagePresentation = routePresentation.find(
    (item: { route: Route; presentation: HomePagePresentation }): boolean => {
      return normalizePath(item.route.toString()) === currentPath;
    },
  )?.presentation || { title: "Home" };

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

  if (presentation.breadcrumb) {
    breadcrumbLinks.push(presentation.breadcrumb);
  }

  return (
    <Page
      title={presentation.title}
      breadcrumbLinks={breadcrumbLinks}
      sideMenu={
        <DashboardSideMenu project={props.currentProject || undefined} />
      }
    >
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <Outlet />
      </Suspense>
    </Page>
  );
};

export default HomeLayout;
