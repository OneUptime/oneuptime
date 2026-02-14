import MonitorGroupViewLayout from "../Pages/MonitorGroup/View/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { MonitorGroupRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import MonitorGroups from "../Pages/MonitorGroup/MonitorGroups";
import MonitorGroupView from "../Pages/MonitorGroup/View/Index";
import MonitorGroupViewDelete from "../Pages/MonitorGroup/View/Delete";

import MonitorGroupAlerts from "../Pages/MonitorGroup/View/Alerts";

import MonitorGroupViewMonitors from "../Pages/MonitorGroup/View/Monitors";
import MonitorGroupViewIncidents from "../Pages/MonitorGroup/View/Incidents";
import MonitorGroupViewOwners from "../Pages/MonitorGroup/View/Owners";

const MonitorGroupRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path={MonitorGroupRoutePath[PageMap.MONITOR_GROUPS] || ""}
        element={
          <MonitorGroups
              {...props}
              pageRoute={RouteMap[PageMap.MONITOR_GROUPS] as Route}
            />
        }
      />

      <PageRoute
        path={MonitorGroupRoutePath[PageMap.MONITOR_GROUP_VIEW] || ""}
        element={<MonitorGroupViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <MonitorGroupView
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_GROUP_VIEW] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_GROUP_VIEW_DELETE)}
          element={
            <MonitorGroupViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_GROUP_VIEW_DELETE] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_GROUP_VIEW_ALERTS)}
          element={
            <MonitorGroupAlerts
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_GROUP_VIEW_ALERTS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.MONITOR_GROUP_VIEW_MONITORS,
          )}
          element={
            <MonitorGroupViewMonitors
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_GROUP_VIEW_MONITORS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.MONITOR_GROUP_VIEW_INCIDENTS,
          )}
          element={
            <MonitorGroupViewIncidents
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_GROUP_VIEW_INCIDENTS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_GROUP_VIEW_OWNERS)}
          element={
            <MonitorGroupViewOwners
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_GROUP_VIEW_OWNERS] as Route}
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default MonitorGroupRoutes;
