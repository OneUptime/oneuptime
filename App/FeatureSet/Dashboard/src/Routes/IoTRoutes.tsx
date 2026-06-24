import ComponentProps from "../Pages/PageComponentProps";
import IoTLayout from "../Pages/IoT/Layout";
import IoTFleetViewLayout from "../Pages/IoT/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, IoTRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import IoTFleets from "../Pages/IoT/Fleets";
import IoTDocumentation from "../Pages/IoT/Documentation";
import IoTSettingsOwnerRules from "../Pages/IoT/Settings/OwnerRules";
import IoTSettingsLabelRules from "../Pages/IoT/Settings/LabelRules";
import IoTArchived from "../Pages/IoT/Archived";
import IoTFleetOverview from "../Pages/IoT/View/Index";
import IoTFleetDevices from "../Pages/IoT/View/Devices";
import IoTFleetDeviceDetail from "../Pages/IoT/View/DeviceDetail";
import IoTFleetMetrics from "../Pages/IoT/View/Metrics";
import IoTFleetLogs from "../Pages/IoT/View/Logs";
import IoTFleetIncidents from "../Pages/IoT/View/Incidents";
import IoTFleetAlerts from "../Pages/IoT/View/Alerts";
import IoTFleetScheduledMaintenance from "../Pages/IoT/View/ScheduledMaintenance";
import IoTFleetOwners from "../Pages/IoT/View/Owners";
import IoTFleetAuditLogs from "../Pages/IoT/View/AuditLogs";
import IoTFleetSettings from "../Pages/IoT/View/Settings";
import IoTFleetDelete from "../Pages/IoT/View/Delete";
import IoTFleetDocumentation from "../Pages/IoT/View/Documentation";

const IoTRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<IoTLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <IoTFleets
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEETS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_DOCUMENTATION)}
          element={
            <IoTDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.IOT_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={IoTRoutePath[PageMap.IOT_SETTINGS_OWNER_RULES] || ""}
          element={
            <IoTSettingsOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.IOT_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={IoTRoutePath[PageMap.IOT_SETTINGS_LABEL_RULES] || ""}
          element={
            <IoTSettingsLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.IOT_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={IoTRoutePath[PageMap.IOT_ARCHIVED] || ""}
          element={
            <IoTArchived
              {...props}
              pageRoute={RouteMap[PageMap.IOT_ARCHIVED] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={IoTRoutePath[PageMap.IOT_FLEET_VIEW] || ""}
        element={<IoTFleetViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <IoTFleetOverview
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW] as Route}
            />
          }
        />

        {/* Devices */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_DEVICES)}
          element={
            <IoTFleetDevices
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_DEVICES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.IOT_FLEET_VIEW_DEVICE_DETAIL,
            2,
          )}
          element={
            <IoTFleetDeviceDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.IOT_FLEET_VIEW_DEVICE_DETAIL] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_METRICS)}
          element={
            <IoTFleetMetrics
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_METRICS] as Route}
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_LOGS)}
          element={
            <IoTFleetLogs
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_INCIDENTS)}
          element={
            <IoTFleetIncidents
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_INCIDENTS] as Route}
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_ALERTS)}
          element={
            <IoTFleetAlerts
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.IOT_FLEET_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <IoTFleetScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[PageMap.IOT_FLEET_VIEW_SCHEDULED_MAINTENANCE] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_OWNERS)}
          element={
            <IoTFleetOwners
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_AUDIT_LOGS)}
          element={
            <IoTFleetAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_AUDIT_LOGS] as Route}
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_SETTINGS)}
          element={
            <IoTFleetSettings
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_SETTINGS] as Route}
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.IOT_FLEET_VIEW_DELETE)}
          element={
            <IoTFleetDelete
              {...props}
              pageRoute={RouteMap[PageMap.IOT_FLEET_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.IOT_FLEET_VIEW_DOCUMENTATION,
          )}
          element={
            <IoTFleetDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.IOT_FLEET_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default IoTRoutes;
