import ComponentProps from "../Pages/PageComponentProps";
import HostLayout from "../Pages/Host/Layout";
import HostViewLayout from "../Pages/Host/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, HostRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import Hosts from "../Pages/Host/Hosts";
import HostDocumentation from "../Pages/Host/Documentation";
import HostSettingsOwnerRules from "../Pages/Host/Settings/OwnerRules";
import HostSettingsLabelRules from "../Pages/Host/Settings/LabelRules";
import HostOverview from "../Pages/Host/View/Overview";
import HostMetrics from "../Pages/Host/View/Metrics";
import HostProcesses from "../Pages/Host/View/Processes";
import HostProcessView from "../Pages/Host/View/ProcessView";
import HostServices from "../Pages/Host/View/Services";
import HostLogs from "../Pages/Host/View/Logs";
import HostTraces from "../Pages/Host/View/Traces";
import HostProfiles from "../Pages/Host/View/Profiles";
import HostIncidents from "../Pages/Host/View/Incidents";
import HostAlerts from "../Pages/Host/View/Alerts";
import HostScheduledMaintenance from "../Pages/Host/View/ScheduledMaintenance";
import HostOwners from "../Pages/Host/View/Owners";
import HostAuditLogs from "../Pages/Host/View/AuditLogs";
import HostSettings from "../Pages/Host/View/Settings";
import HostDelete from "../Pages/Host/View/Delete";
import HostViewDocumentation from "../Pages/Host/View/Documentation";

const HostRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<HostLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <Hosts {...props} pageRoute={RouteMap[PageMap.HOSTS] as Route} />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_DOCUMENTATION)}
          element={
            <HostDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.HOST_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={HostRoutePath[PageMap.HOST_SETTINGS_OWNER_RULES] || ""}
          element={
            <HostSettingsOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.HOST_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={HostRoutePath[PageMap.HOST_SETTINGS_LABEL_RULES] || ""}
          element={
            <HostSettingsLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.HOST_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={HostRoutePath[PageMap.HOST_VIEW] || ""}
        element={<HostViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <HostOverview
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_METRICS)}
          element={
            <HostMetrics
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_METRICS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_PROCESSES)}
          element={
            <HostProcesses
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_PROCESSES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_PROCESS_VIEW, 2)}
          element={
            <HostProcessView
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_PROCESS_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_SERVICES)}
          element={
            <HostServices
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_SERVICES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_LOGS)}
          element={
            <HostLogs
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_TRACES)}
          element={
            <HostTraces
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_PROFILES)}
          element={
            <HostProfiles
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_PROFILES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_INCIDENTS)}
          element={
            <HostIncidents
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_INCIDENTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_ALERTS)}
          element={
            <HostAlerts
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_ALERTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.HOST_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <HostScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[PageMap.HOST_VIEW_SCHEDULED_MAINTENANCE] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_OWNERS)}
          element={
            <HostOwners
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_AUDIT_LOGS)}
          element={
            <HostAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_AUDIT_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_SETTINGS)}
          element={
            <HostSettings
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_SETTINGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_DELETE)}
          element={
            <HostDelete
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_DELETE] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.HOST_VIEW_DOCUMENTATION)}
          element={
            <HostViewDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.HOST_VIEW_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default HostRoutes;
