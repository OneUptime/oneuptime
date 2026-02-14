import ComponentProps from "../Pages/PageComponentProps";
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

const DashboardsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path={DashboardsRoutePath[PageMap.DASHBOARDS] || ""}
        element={
          <Dashboards
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARDS] as Route}
            />
        }
      />

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
      </PageRoute>
    </Routes>
  );
};

export default DashboardsRoutes;
