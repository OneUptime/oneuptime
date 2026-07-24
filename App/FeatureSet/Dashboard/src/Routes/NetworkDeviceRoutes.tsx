import ComponentProps from "../Pages/PageComponentProps";
import NetworkDeviceLayout from "../Pages/NetworkDevice/Layout";
import NetworkDeviceViewLayout from "../Pages/NetworkDevice/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, NetworkDeviceRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import NetworkOverview from "../Pages/NetworkDevice/Overview";
import NetworkDevices from "../Pages/NetworkDevice/Devices";
import NetworkDeviceArchived from "../Pages/NetworkDevice/Archived";
import NetworkDeviceDiscovery from "../Pages/NetworkDevice/Discovery";
import NetworkEndpoints from "../Pages/NetworkDevice/Endpoints";
import NetworkDeviceTopology from "../Pages/NetworkDevice/Topology";
import NetworkDeviceLatencyMatrix from "../Pages/NetworkDevice/LatencyMatrix";
import NetworkDeviceOverview from "../Pages/NetworkDevice/View/Index";
import NetworkDeviceInterfaces from "../Pages/NetworkDevice/View/Interfaces";
import NetworkDeviceMetrics from "../Pages/NetworkDevice/View/Metrics";
import NetworkDeviceTraffic from "../Pages/NetworkDevice/View/Traffic";
import NetworkDeviceMonitors from "../Pages/NetworkDevice/View/Monitors";
import NetworkDeviceLogs from "../Pages/NetworkDevice/View/Logs";
import NetworkDeviceOwners from "../Pages/NetworkDevice/View/Owners";
import NetworkDeviceSettingsOwnerRules from "../Pages/NetworkDevice/Settings/OwnerRules";
import NetworkDeviceSettingsLabelRules from "../Pages/NetworkDevice/Settings/LabelRules";
import NetworkDeviceSettings from "../Pages/NetworkDevice/View/Settings";
import NetworkDeviceDelete from "../Pages/NetworkDevice/View/Delete";

const NetworkDeviceRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<NetworkDeviceLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <NetworkDevices
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICES] as Route}
            />
          }
        />
        <PageRoute
          path={NetworkDeviceRoutePath[PageMap.NETWORK_OVERVIEW] || ""}
          element={
            <NetworkOverview
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_OVERVIEW] as Route}
            />
          }
        />
        <PageRoute
          path={
            NetworkDeviceRoutePath[
              PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES
            ] || ""
          }
          element={
            <NetworkDeviceSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            NetworkDeviceRoutePath[
              PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES
            ] || ""
          }
          element={
            <NetworkDeviceSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_DEVICE_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_DISCOVERY] || ""}
          element={
            <NetworkDeviceDiscovery
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_DISCOVERY] as Route}
            />
          }
        />
        <PageRoute
          path={NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_ENDPOINTS] || ""}
          element={
            <NetworkEndpoints
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_ENDPOINTS] as Route}
            />
          }
        />
        <PageRoute
          path={NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_TOPOLOGY] || ""}
          element={
            <NetworkDeviceTopology
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_TOPOLOGY] as Route}
            />
          }
        />
        <PageRoute
          path={
            NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_LATENCY_MATRIX] || ""
          }
          element={
            <NetworkDeviceLatencyMatrix
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_DEVICE_LATENCY_MATRIX] as Route
              }
            />
          }
        />
        <PageRoute
          path={NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_ARCHIVED] || ""}
          element={
            <NetworkDeviceArchived
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_ARCHIVED] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={NetworkDeviceRoutePath[PageMap.NETWORK_DEVICE_VIEW] || ""}
        element={<NetworkDeviceViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <NetworkDeviceOverview
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_DEVICE_VIEW_INTERFACES,
          )}
          element={
            <NetworkDeviceInterfaces
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_DEVICE_VIEW_INTERFACES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_DEVICE_VIEW_METRICS,
          )}
          element={
            <NetworkDeviceMetrics
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW_METRICS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_DEVICE_VIEW_TRAFFIC,
          )}
          element={
            <NetworkDeviceTraffic
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW_TRAFFIC] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_DEVICE_VIEW_MONITORS,
          )}
          element={
            <NetworkDeviceMonitors
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_DEVICE_VIEW_MONITORS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.NETWORK_DEVICE_VIEW_LOGS)}
          element={
            <NetworkDeviceLogs
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.NETWORK_DEVICE_VIEW_OWNERS)}
          element={
            <NetworkDeviceOwners
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.NETWORK_DEVICE_VIEW_SETTINGS,
          )}
          element={
            <NetworkDeviceSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.NETWORK_DEVICE_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.NETWORK_DEVICE_VIEW_DELETE)}
          element={
            <NetworkDeviceDelete
              {...props}
              pageRoute={RouteMap[PageMap.NETWORK_DEVICE_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default NetworkDeviceRoutes;
