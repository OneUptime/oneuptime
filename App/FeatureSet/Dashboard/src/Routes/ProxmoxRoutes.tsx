import ComponentProps from "../Pages/PageComponentProps";
import ProxmoxLayout from "../Pages/Proxmox/Layout";
import ProxmoxClusterViewLayout from "../Pages/Proxmox/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, ProxmoxRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import ProxmoxClusters from "../Pages/Proxmox/Clusters";
import ProxmoxDocumentation from "../Pages/Proxmox/Documentation";
import ProxmoxClusterOverview from "../Pages/Proxmox/View/Overview";
import ProxmoxClusterNodes from "../Pages/Proxmox/View/Nodes";
import ProxmoxClusterGuests from "../Pages/Proxmox/View/Guests";
import ProxmoxClusterStorage from "../Pages/Proxmox/View/Storage";
import ProxmoxClusterMetrics from "../Pages/Proxmox/View/Metrics";
import ProxmoxClusterLogs from "../Pages/Proxmox/View/Logs";
import ProxmoxClusterSettings from "../Pages/Proxmox/View/Settings";
import ProxmoxClusterDelete from "../Pages/Proxmox/View/Delete";
import ProxmoxClusterDocumentation from "../Pages/Proxmox/View/Documentation";

const ProxmoxRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ProxmoxLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <ProxmoxClusters
              {...props}
              pageRoute={RouteMap[PageMap.PROXMOX_CLUSTERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PROXMOX_DOCUMENTATION)}
          element={
            <ProxmoxDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.PROXMOX_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={ProxmoxRoutePath[PageMap.PROXMOX_CLUSTER_VIEW] || ""}
        element={<ProxmoxClusterViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <ProxmoxClusterOverview
              {...props}
              pageRoute={RouteMap[PageMap.PROXMOX_CLUSTER_VIEW] as Route}
            />
          }
        />

        {/* Nodes */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PROXMOX_CLUSTER_VIEW_NODES)}
          element={
            <ProxmoxClusterNodes
              {...props}
              pageRoute={RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_NODES] as Route}
            />
          }
        />

        {/* Guests */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PROXMOX_CLUSTER_VIEW_GUESTS,
          )}
          element={
            <ProxmoxClusterGuests
              {...props}
              pageRoute={RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_GUESTS] as Route}
            />
          }
        />

        {/* Storage */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PROXMOX_CLUSTER_VIEW_STORAGE,
          )}
          element={
            <ProxmoxClusterStorage
              {...props}
              pageRoute={
                RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_STORAGE] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PROXMOX_CLUSTER_VIEW_METRICS,
          )}
          element={
            <ProxmoxClusterMetrics
              {...props}
              pageRoute={
                RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_METRICS] as Route
              }
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.PROXMOX_CLUSTER_VIEW_LOGS)}
          element={
            <ProxmoxClusterLogs
              {...props}
              pageRoute={RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS,
          )}
          element={
            <ProxmoxClusterSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PROXMOX_CLUSTER_VIEW_DELETE,
          )}
          element={
            <ProxmoxClusterDelete
              {...props}
              pageRoute={RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.PROXMOX_CLUSTER_VIEW_DOCUMENTATION,
          )}
          element={
            <ProxmoxClusterDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.PROXMOX_CLUSTER_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ProxmoxRoutes;
