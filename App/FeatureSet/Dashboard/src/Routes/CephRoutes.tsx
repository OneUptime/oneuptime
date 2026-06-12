import ComponentProps from "../Pages/PageComponentProps";
import CephLayout from "../Pages/Ceph/Layout";
import CephClusterViewLayout from "../Pages/Ceph/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, CephRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import CephClusters from "../Pages/Ceph/Clusters";
import CephDocumentation from "../Pages/Ceph/Documentation";
import CephClusterOverview from "../Pages/Ceph/View/Overview";
import CephClusterOsds from "../Pages/Ceph/View/Osds";
import CephClusterPools from "../Pages/Ceph/View/Pools";
import CephClusterMetrics from "../Pages/Ceph/View/Metrics";
import CephClusterLogs from "../Pages/Ceph/View/Logs";
import CephClusterSettings from "../Pages/Ceph/View/Settings";
import CephClusterDelete from "../Pages/Ceph/View/Delete";
import CephClusterDocumentation from "../Pages/Ceph/View/Documentation";

const CephRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<CephLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <CephClusters
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_DOCUMENTATION)}
          element={
            <CephDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_DOCUMENTATION] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={CephRoutePath[PageMap.CEPH_CLUSTER_VIEW] || ""}
        element={<CephClusterViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <CephClusterOverview
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW] as Route}
            />
          }
        />

        {/* OSDs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_OSDS)}
          element={
            <CephClusterOsds
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_OSDS] as Route}
            />
          }
        />

        {/* Pools */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_POOLS)}
          element={
            <CephClusterPools
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOLS] as Route}
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_METRICS)}
          element={
            <CephClusterMetrics
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_METRICS] as Route}
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_LOGS)}
          element={
            <CephClusterLogs
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_SETTINGS)}
          element={
            <CephClusterSettings
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_SETTINGS] as Route}
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_DELETE)}
          element={
            <CephClusterDelete
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CEPH_CLUSTER_VIEW_DOCUMENTATION,
          )}
          element={
            <CephClusterDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.CEPH_CLUSTER_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default CephRoutes;
