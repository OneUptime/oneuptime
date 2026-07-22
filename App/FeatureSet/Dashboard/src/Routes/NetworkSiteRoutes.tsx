import ComponentProps from "../Pages/PageComponentProps";
import NetworkSiteLayout from "../Pages/NetworkSite/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { NetworkSiteRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import NetworkSites from "../Pages/NetworkSite/Sites";
import NetworkSiteView from "../Pages/NetworkSite/View";
import NetworkSiteMap from "../Pages/NetworkSite/NetworkMap";
import NetworkSiteAssignmentRules from "../Pages/NetworkSite/AssignmentRules";
import NetworkSiteLinks from "../Pages/NetworkSite/Links";
import NetworkSiteImport from "../Pages/NetworkSite/Import";

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
        <PageRoute
          path={NetworkSiteRoutePath[PageMap.NETWORK_SITE_VIEW] || ""}
          element={
            <NetworkSiteView
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_SITE_VIEW] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default NetworkSiteRoutes;
