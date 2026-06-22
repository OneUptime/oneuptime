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
import CephSettingsOwnerRules from "../Pages/Ceph/Settings/OwnerRules";
import CephSettingsLabelRules from "../Pages/Ceph/Settings/LabelRules";
import CephArchived from "../Pages/Ceph/Archived";
import CephClusterOverview from "../Pages/Ceph/View/Index";
import CephClusterOsds from "../Pages/Ceph/View/Osds";
import CephClusterOsdDetail from "../Pages/Ceph/View/OsdDetail";
import CephClusterPools from "../Pages/Ceph/View/Pools";
import CephClusterPoolDetail from "../Pages/Ceph/View/PoolDetail";
import CephClusterDaemons from "../Pages/Ceph/View/Daemons";
import CephClusterInsights from "../Pages/Ceph/View/Insights";
import CephClusterClusterLog from "../Pages/Ceph/View/ClusterLog";
import CephClusterMetrics from "../Pages/Ceph/View/Metrics";
import CephClusterLogs from "../Pages/Ceph/View/Logs";
import CephClusterIncidents from "../Pages/Ceph/View/Incidents";
import CephClusterAlerts from "../Pages/Ceph/View/Alerts";
import CephClusterScheduledMaintenance from "../Pages/Ceph/View/ScheduledMaintenance";
import CephClusterOwners from "../Pages/Ceph/View/Owners";
import CephClusterAuditLogs from "../Pages/Ceph/View/AuditLogs";
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
        <PageRoute
          path={CephRoutePath[PageMap.CEPH_SETTINGS_OWNER_RULES] || ""}
          element={
            <CephSettingsOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={CephRoutePath[PageMap.CEPH_SETTINGS_LABEL_RULES] || ""}
          element={
            <CephSettingsLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={CephRoutePath[PageMap.CEPH_ARCHIVED] || ""}
          element={
            <CephArchived
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_ARCHIVED] as Route}
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

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL,
            2,
          )}
          element={
            <CephClusterOsdDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL] as Route
              }
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

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL,
            2,
          )}
          element={
            <CephClusterPoolDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL] as Route
              }
            />
          }
        />

        {/* Daemons */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_DAEMONS)}
          element={
            <CephClusterDaemons
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_DAEMONS] as Route}
            />
          }
        />

        {/* Insights */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_INSIGHTS)}
          element={
            <CephClusterInsights
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_INSIGHTS] as Route}
            />
          }
        />

        {/* Cluster Log */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CEPH_CLUSTER_VIEW_CLUSTER_LOG,
          )}
          element={
            <CephClusterClusterLog
              {...props}
              pageRoute={
                RouteMap[PageMap.CEPH_CLUSTER_VIEW_CLUSTER_LOG] as Route
              }
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

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CEPH_CLUSTER_VIEW_INCIDENTS,
          )}
          element={
            <CephClusterIncidents
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_INCIDENTS] as Route}
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_ALERTS)}
          element={
            <CephClusterAlerts
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CEPH_CLUSTER_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <CephClusterScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.CEPH_CLUSTER_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CEPH_CLUSTER_VIEW_OWNERS)}
          element={
            <CephClusterOwners
              {...props}
              pageRoute={RouteMap[PageMap.CEPH_CLUSTER_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CEPH_CLUSTER_VIEW_AUDIT_LOGS,
          )}
          element={
            <CephClusterAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.CEPH_CLUSTER_VIEW_AUDIT_LOGS] as Route
              }
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
