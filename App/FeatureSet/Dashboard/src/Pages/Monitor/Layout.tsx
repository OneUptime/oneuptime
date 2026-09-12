import { getMonitorBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import Link from "Common/Types/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import React, { FunctionComponent, ReactElement, Suspense } from "react";
import { matchPath, Outlet, useLocation } from "react-router-dom";

const monitorPageMaps: Array<PageMap> = [
  PageMap.MONITORS,
  PageMap.MONITORS_INOPERATIONAL,
  PageMap.MONITORS_DISABLED,
  PageMap.MONITORS_PROBE_DISCONNECTED,
  PageMap.MONITORS_PROBE_DISABLED,
  PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK,
  PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
  PageMap.MONITOR_CREATE,
  PageMap.MONITORS_SETTINGS,
  PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS,
  PageMap.MONITORS_SETTINGS_SECRETS,
  PageMap.MONITORS_SETTINGS_TEMPLATES,
  PageMap.MONITORS_SETTINGS_TEMPLATES_VIEW,
  PageMap.MONITORS_SETTINGS_OWNER_RULES,
  PageMap.MONITORS_SETTINGS_LABEL_RULES,
  PageMap.MONITORS_SETTINGS_PROBES,
  PageMap.MONITORS_SETTINGS_PROBE_VIEW,
];

const isRouteMatch: (pageMap: PageMap, pathname: string) => boolean = (
  pageMap: PageMap,
  pathname: string,
): boolean => {
  const route: Route | undefined = RouteMap[pageMap];

  return Boolean(
    route &&
      matchPath(
        {
          path: route.toString(),
          end: true,
        },
        pathname,
      ),
  );
};

const MonitorLayout: FunctionComponent<PageComponentProps> = (
  props: PageComponentProps,
): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const matchedMonitorPage: PageMap | undefined = monitorPageMaps.find(
    (pageMap: PageMap): boolean => {
      return isRouteMatch(pageMap, location.pathname);
    },
  );
  const isMonitorGroupList: boolean = isRouteMatch(
    PageMap.MONITOR_GROUPS,
    location.pathname,
  );

  /*
   * Monitor and monitor-group detail pages own a model-specific shell. Keep
   * this family layout mounted above both lazy route bundles, but only render
   * the shared list/settings shell for pages that use the common side menu.
   */
  if (!matchedMonitorPage && !isMonitorGroupList) {
    return (
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <Outlet />
      </Suspense>
    );
  }

  const routePath: string = isMonitorGroupList
    ? (RouteMap[PageMap.MONITOR_GROUPS] as Route).toString()
    : (RouteMap[matchedMonitorPage as PageMap] as Route).toString();
  const monitorGroupBreadcrumbs: Array<Link> = [
    {
      title: "Project",
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
    },
    {
      title: "Monitors",
      to: RouteUtil.populateRouteParams(RouteMap[PageMap.MONITORS] as Route),
    },
    {
      title: "Monitor Groups",
      to: RouteUtil.populateRouteParams(
        RouteMap[PageMap.MONITOR_GROUPS] as Route,
      ),
    },
  ];

  return (
    <Page
      title={"Monitors"}
      breadcrumbLinks={
        isMonitorGroupList
          ? monitorGroupBreadcrumbs
          : getMonitorBreadcrumbs(routePath)
      }
      sideMenu={
        matchedMonitorPage === PageMap.MONITOR_CREATE ? undefined : (
          <DashboardSideMenu project={props.currentProject || undefined} />
        )
      }
    >
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <Outlet />
      </Suspense>
    </Page>
  );
};

export default MonitorLayout;
