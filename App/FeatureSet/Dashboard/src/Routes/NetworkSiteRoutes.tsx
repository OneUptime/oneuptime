import ComponentProps from "../Pages/PageComponentProps";
import NetworkSiteLayout from "../Pages/NetworkSite/Layout";
import NetworkSiteViewLayout from "../Pages/NetworkSite/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, NetworkSiteRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import NetworkSites from "../Pages/NetworkSite/Sites";
import NetworkSiteMap from "../Pages/NetworkSite/NetworkMap";
import NetworkSiteAssignmentRules from "../Pages/NetworkSite/AssignmentRules";
import NetworkSiteLinks from "../Pages/NetworkSite/Links";
import NetworkSiteImport from "../Pages/NetworkSite/Import";
import NetworkSiteView from "../Pages/NetworkSite/View/Index";
import NetworkSiteViewDevices from "../Pages/NetworkSite/View/Devices";
import NetworkSiteViewChildSites from "../Pages/NetworkSite/View/ChildSites";
import NetworkSiteViewEndpoints from "../Pages/NetworkSite/View/Endpoints";
import NetworkSiteViewStatusTimeline from "../Pages/NetworkSite/View/StatusTimeline";
import NetworkSiteViewSettings from "../Pages/NetworkSite/View/Settings";
import NetworkSiteViewDelete from "../Pages/NetworkSite/View/Delete";

const NetworkSiteRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<NetworkSiteLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <NetworkSites
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITES] as Route}
            />
          }
        />
        <PageRoute
          path={NetworkSiteRoutePath[PageMap.NETWORK_SITE_MAP] || ""}
          element={
            <NetworkSiteMap
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_MAP] as Route}
            />
          }
        />
        <PageRoute
          path={
            NetworkSiteRoutePath[PageMap.NETWORK_SITE_ASSIGNMENT_RULES] || ""
          }
          element={
            <NetworkSiteAssignmentRules
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_SITE_ASSIGNMENT_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={NetworkSiteRoutePath[PageMap.NETWORK_SITE_LINKS] || ""}
          element={
            <NetworkSiteLinks
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_LINKS] as Route}
            />
          }
        />
        <PageRoute
          path={NetworkSiteRoutePath[PageMap.NETWORK_SITE_IMPORT] || ""}
          element={
            <NetworkSiteImport
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_IMPORT] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={NetworkSiteRoutePath[PageMap.NETWORK_SITE_VIEW] || ""}
        element={<NetworkSiteViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <NetworkSiteView
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.NETWORK_SITE_VIEW_DEVICES)}
          element={
            <NetworkSiteViewDevices
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_VIEW_DEVICES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_SITE_VIEW_CHILD_SITES,
          )}
          element={
            <NetworkSiteViewChildSites
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_SITE_VIEW_CHILD_SITES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_SITE_VIEW_ENDPOINTS,
          )}
          element={
            <NetworkSiteViewEndpoints
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_VIEW_ENDPOINTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_SITE_VIEW_STATUS_TIMELINE,
          )}
          element={
            <NetworkSiteViewStatusTimeline
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_SITE_VIEW_STATUS_TIMELINE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.NETWORK_SITE_VIEW_SETTINGS)}
          element={
            <NetworkSiteViewSettings
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_VIEW_SETTINGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.NETWORK_SITE_VIEW_DELETE)}
          element={
            <NetworkSiteViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default NetworkSiteRoutes;
