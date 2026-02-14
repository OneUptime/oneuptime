import Navigation from "Common/UI/Utils/Navigation";
import MonitorLayout from "../Pages/Monitor/Layout";
import MonitorViewLayout from "../Pages/Monitor/View/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, { MonitorsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import MonitorPage from "../Pages/Monitor/Monitors";

import WorkspaceConnectionSlack from "../Pages/Monitor/WorkspaceConnectionSlack";

import WorkspaceConnectionTeams from "../Pages/Monitor/WorkspaceConnectionMicrosoftTeams";

import MonitorViewMetrics from "../Pages/Monitor/View/Metrics";

import MonitorprobeDisconnected from "../Pages/Monitor/ProbeDisconnected";

import MonitorProbeDisabled from "../Pages/Monitor/ProbeDisabled";

import MonitorView from "../Pages/Monitor/View/Index";
import MonitorViewDelete from "../Pages/Monitor/View/Delete";

import MonitorViewLogs from "../Pages/Monitor/View/Logs";

import MonitorViewCriteria from "../Pages/Monitor/View/Criteria";
import MonitorViewStatusTimeline from "../Pages/Monitor/View/StatusTimeline";
import MonitorIncidents from "../Pages/Monitor/View/Incidents";

import MonitorAlerts from "../Pages/Monitor/View/Alerts";
import MonitorInoperational from "../Pages/Monitor/NotOperationalMonitors";
import MonitorDisabled from "../Pages/Monitor/DisabledMonitors";
import MonitorViewCustomFields from "../Pages/Monitor/View/CustomFields";
import MonitorViewInterval from "../Pages/Monitor/View/Interval";

import MonitorViewDocumentation from "../Pages/Monitor/View/Documentation";

import MonitorViewProbes from "../Pages/Monitor/View/Probes";
import MonitorViewOwner from "../Pages/Monitor/View/Owners";
import MonitorViewSettings from "../Pages/Monitor/View/Settings";

import MonitorViewNotificationLogs from "../Pages/Monitor/View/NotificationLogs";

import MonitorCreate from "../Pages/Monitor/Create";

// Settings Pages
import MonitorSettingsStatus from "../Pages/Monitor/Settings/MonitorStatus";

import MonitorSettingsCustomFields from "../Pages/Monitor/Settings/MonitorCustomFields";

import MonitorSettingsSecrets from "../Pages/Monitor/Settings/MonitorSecrets";

const MonitorRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let hideSideMenu: boolean = false;

  if (Navigation.isOnThisPage(RouteMap[PageMap.MONITOR_CREATE] as Route)) {
    hideSideMenu = true;
  }

  return (
    <Routes>
      <PageRoute
        path="/"
        element={<MonitorLayout hideSideMenu={hideSideMenu} {...props} />}
      >
        <PageRoute
          index
          element={
            <MonitorPage
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS] as Route}
              />
          }
        />
        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_DISABLED] || ""}
          element={
            <MonitorDisabled
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_DISABLED] as Route}
              />
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_PROBE_DISCONNECTED] || ""}
          element={
            <MonitorprobeDisconnected
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITORS_PROBE_DISCONNECTED] as Route
                }
              />
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_PROBE_DISABLED] || ""}
          element={
            <MonitorProbeDisabled
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_PROBE_DISABLED] as Route}
              />
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_INOPERATIONAL] || ""}
          element={
            <MonitorInoperational
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_INOPERATIONAL] as Route}
              />
          }
        />

        <PageRoute
          path={
            MonitorsRoutePath[PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK] || ""
          }
          element={
            <WorkspaceConnectionSlack
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITORS_WORKSPACE_CONNECTION_SLACK] as Route
                }
              />
          }
        />

        <PageRoute
          path={
            MonitorsRoutePath[
              PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
            ] || ""
          }
          element={
            <WorkspaceConnectionTeams
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS
                  ] as Route
                }
              />
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITOR_CREATE] || ""}
          element={
            <MonitorCreate
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_CREATE] as Route}
              />
          }
        />

        {/* Settings Routes */}
        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_SETTINGS] || ""}
          element={
            <MonitorSettingsStatus
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_SETTINGS] as Route}
              />
          }
        />

        <PageRoute
          path={
            MonitorsRoutePath[PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS] || ""
          }
          element={
            <MonitorSettingsCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITORS_SETTINGS_CUSTOM_FIELDS] as Route
                }
              />
          }
        />

        <PageRoute
          path={MonitorsRoutePath[PageMap.MONITORS_SETTINGS_SECRETS] || ""}
          element={
            <MonitorSettingsSecrets
                {...props}
                pageRoute={RouteMap[PageMap.MONITORS_SETTINGS_SECRETS] as Route}
              />
          }
        />
      </PageRoute>

      <PageRoute
        path={MonitorsRoutePath[PageMap.MONITOR_VIEW] || ""}
        element={<MonitorViewLayout />}
      >
        <PageRoute
          index
          element={
            <MonitorView
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_SETTINGS)}
          element={
            <MonitorViewSettings
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_SETTINGS] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_OWNERS)}
          element={
            <MonitorViewOwner
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_OWNERS] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_CRITERIA)}
          element={
            <MonitorViewCriteria
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_METRICS)}
          element={
            <MonitorViewMetrics
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_METRICS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_INTERVAL)}
          element={
            <MonitorViewInterval
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_INTERVAL] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_DOCUMENTATION)}
          element={
            <MonitorViewDocumentation
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_VIEW_DOCUMENTATION] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.MONITOR_VIEW_STATUS_TIMELINE,
          )}
          element={
            <MonitorViewStatusTimeline
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_VIEW_STATUS_TIMELINE] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_INCIDENTS)}
          element={
            <MonitorIncidents
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_INCIDENTS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_ALERTS)}
          element={
            <MonitorAlerts
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_ALERTS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_DELETE)}
          element={
            <MonitorViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_DELETE] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_CUSTOM_FIELDS)}
          element={
            <MonitorViewCustomFields
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_VIEW_CUSTOM_FIELDS] as Route
                }
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_PROBES)}
          element={
            <MonitorViewProbes
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.MONITOR_VIEW_LOGS)}
          element={
            <MonitorViewLogs
                {...props}
                pageRoute={RouteMap[PageMap.MONITOR_VIEW_LOGS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.MONITOR_VIEW_NOTIFICATION_LOGS,
          )}
          element={
            <MonitorViewNotificationLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.MONITOR_VIEW_NOTIFICATION_LOGS] as Route
                }
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default MonitorRoutes;
