import NetworkSideMenu from "../../Components/Network/NetworkSideMenu";
import PageMap from "../../Utils/PageMap";
import { RouteUtil } from "../../Utils/RouteMap";
import { getNetworkDeviceBreadcrumbs } from "../NetworkDevice/Utils/Breadcrumbs";
import { getNetworkSiteBreadcrumbs } from "../NetworkSite/Utils/Breadcrumbs";
import Link from "Common/Types/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import {
  DeveloperDocsChildPage,
  getDeveloperDocsChildPages,
} from "../../Components/DeveloperDocs/DeveloperDocsPages";

const networkModelPageRoutes: Array<string> = [
  PageMap.NETWORK_DEVICE_VIEW,
  PageMap.NETWORK_DEVICE_VIEW_INTERFACES,
  PageMap.NETWORK_DEVICE_VIEW_TABLES,
  PageMap.NETWORK_DEVICE_VIEW_WIFI,
  PageMap.NETWORK_DEVICE_VIEW_METRICS,
  PageMap.NETWORK_DEVICE_VIEW_TRAFFIC,
  PageMap.NETWORK_DEVICE_VIEW_MONITORS,
  PageMap.NETWORK_DEVICE_VIEW_LOGS,
  PageMap.NETWORK_DEVICE_VIEW_OWNERS,
  PageMap.NETWORK_DEVICE_VIEW_SETTINGS,
  PageMap.NETWORK_DEVICE_VIEW_DELETE,
  PageMap.NETWORK_SITE_VIEW,
  PageMap.NETWORK_SITE_VIEW_DEVICES,
  PageMap.NETWORK_SITE_VIEW_CHILD_SITES,
  PageMap.NETWORK_SITE_VIEW_ENDPOINTS,
  PageMap.NETWORK_SITE_VIEW_STATUS_TIMELINE,
  PageMap.NETWORK_SITE_VIEW_SCHEDULED_MAINTENANCE,
  PageMap.NETWORK_SITE_VIEW_SETTINGS,
  PageMap.NETWORK_SITE_VIEW_DELETE,
  // A device's and a site's Developer pages (Terraform, API, AI Assistants).
  ...[PageMap.NETWORK_DEVICE_VIEW, PageMap.NETWORK_SITE_VIEW].flatMap(
    (viewPage: PageMap): Array<string> => {
      return getDeveloperDocsChildPages(viewPage).map(
        (child: DeveloperDocsChildPage): string => {
          return child.key;
        },
      );
    },
  ),
].map((page: string): string => {
  return RouteUtil.getRouteString(page);
});

export const NETWORK_PAGE_TITLE: string = "Network";

const NetworkLayout: FunctionComponent = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const isNetworkSitePage: boolean =
    location.pathname.includes("/network-sites");
  const breadcrumbLinks: Array<Link> | undefined = isNetworkSitePage
    ? getNetworkSiteBreadcrumbs(path)
    : getNetworkDeviceBreadcrumbs(path);
  const routeContent: ReactElement = (
    <Suspense fallback={<PageLoader isVisible={true} />}>
      <Outlet />
    </Suspense>
  );

  // Device and site detail pages own a ModelPage and their own model side menu.
  if (networkModelPageRoutes.includes(path)) {
    return routeContent;
  }

  /*
   * One product, one name: the heading reads "Network" on every page, as the
   * products menu calls it - never "Network Devices" on the Overview and
   * "Network Sites" on the Map, which named the route family a page happens
   * to be served from rather than anything the user picked.
   */
  return (
    <Page
      title={NETWORK_PAGE_TITLE}
      sideMenu={<NetworkSideMenu />}
      breadcrumbLinks={breadcrumbLinks}
    >
      {routeContent}
    </Page>
  );
};

export default NetworkLayout;
