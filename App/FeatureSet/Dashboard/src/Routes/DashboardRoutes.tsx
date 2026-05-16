import ComponentProps from "../Pages/PageComponentProps";
import DashboardsLayout from "../Pages/Dashboards/Layout";
import DashboardViewLayout from "../Pages/Dashboards/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { DashboardsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import Dashboards from "../Pages/Dashboards/Dashboards";

import DashboardView from "../Pages/Dashboards/View/Index";

import DashboardViewOverview from "../Pages/Dashboards/View/Overview";

import DashboardViewDelete from "../Pages/Dashboards/View/Delete";

import DashboardViewSettings from "../Pages/Dashboards/View/Settings";

import DashboardViewAuthenticationSettings from "../Pages/Dashboards/View/AuthenticationSettings";

import DashboardViewBranding from "../Pages/Dashboards/View/Branding";

import DashboardViewCustomDomains from "../Pages/Dashboards/View/CustomDomains";

import DashboardViewOwners from "../Pages/Dashboards/View/Owners";

import DashboardSettingsOwnerRules from "../Pages/Dashboards/Settings/OwnerRules";

import DashboardSettingsLabelRules from "../Pages/Dashboards/Settings/LabelRules";

const DashboardsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<DashboardsLayout {...props} />}>
        <PageRoute
          index
          element={
            <Dashboards
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARDS] as Route}
            />
          }
        />

        <PageRoute
          path={
            DashboardsRoutePath[PageMap.DASHBOARDS_SETTINGS_OWNER_RULES] || ""
          }
          element={
            <DashboardSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DASHBOARDS_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />

        <PageRoute
          path={
            DashboardsRoutePath[PageMap.DASHBOARDS_SETTINGS_LABEL_RULES] || ""
          }
          element={
            <DashboardSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DASHBOARDS_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={DashboardsRoutePath[PageMap.DASHBOARD_VIEW] || ""}
        element={<DashboardViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <DashboardView
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARD_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_OVERVIEW)}
          element={
            <DashboardViewOverview
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_OVERVIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_DELETE)}
          element={
            <DashboardViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_DELETE] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_SETTINGS)}
          element={
            <DashboardViewSettings
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_SETTINGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_BRANDING)}
          element={
            <DashboardViewBranding
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_BRANDING] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS,
          )}
          element={
            <DashboardViewAuthenticationSettings
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DASHBOARD_VIEW_AUTHENTICATION_SETTINGS
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DASHBOARD_VIEW_CUSTOM_DOMAINS,
          )}
          element={
            <DashboardViewCustomDomains
              {...props}
              pageRoute={
                RouteMap[PageMap.DASHBOARD_VIEW_CUSTOM_DOMAINS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_OWNERS)}
          element={
            <DashboardViewOwners
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_OWNERS] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default DashboardsRoutes;
