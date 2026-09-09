import ComponentProps from "../Pages/PageComponentProps";
import VMwareLayout from "../Pages/VMware/Layout";
import VMwareVCenterViewLayout from "../Pages/VMware/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, VMwareRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import VMwareVCenters from "../Pages/VMware/VCenters";
import VMwareDocumentation from "../Pages/VMware/Documentation";
import VMwareSettingsOwnerRules from "../Pages/VMware/Settings/OwnerRules";
import VMwareSettingsLabelRules from "../Pages/VMware/Settings/LabelRules";
import VMwareArchived from "../Pages/VMware/Archived";
import VMwareVCenterOverview from "../Pages/VMware/View/Index";
import VMwareVCenterHosts from "../Pages/VMware/View/Hosts";
import VMwareVCenterHostDetail from "../Pages/VMware/View/HostDetail";
import VMwareVCenterVirtualMachines from "../Pages/VMware/View/VirtualMachines";
import VMwareVCenterVirtualMachineDetail from "../Pages/VMware/View/VirtualMachineDetail";
import VMwareVCenterDatastores from "../Pages/VMware/View/Datastores";
import VMwareVCenterDatastoreDetail from "../Pages/VMware/View/DatastoreDetail";
import VMwareVCenterClusters from "../Pages/VMware/View/Clusters";
import VMwareVCenterClusterDetail from "../Pages/VMware/View/ClusterDetail";
import VMwareVCenterResourcePools from "../Pages/VMware/View/ResourcePools";
import VMwareVCenterInsights from "../Pages/VMware/View/Insights";
import VMwareVCenterMetrics from "../Pages/VMware/View/Metrics";
import VMwareVCenterRecommendations from "../Pages/VMware/View/Recommendations";
import VMwareVCenterLogs from "../Pages/VMware/View/Logs";
import VMwareVCenterIncidents from "../Pages/VMware/View/Incidents";
import VMwareVCenterAlerts from "../Pages/VMware/View/Alerts";
import VMwareVCenterScheduledMaintenance from "../Pages/VMware/View/ScheduledMaintenance";
import VMwareVCenterOwners from "../Pages/VMware/View/Owners";
import VMwareVCenterFeed from "../Pages/VMware/View/Feed";
import VMwareVCenterAuditLogs from "../Pages/VMware/View/AuditLogs";
import VMwareVCenterSettings from "../Pages/VMware/View/Settings";
import VMwareVCenterDelete from "../Pages/VMware/View/Delete";
import VMwareVCenterDocumentation from "../Pages/VMware/View/Documentation";

const VMwareRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<VMwareLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <VMwareVCenters
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.VMWARE_DOCUMENTATION)}
          element={
            <VMwareDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={VMwareRoutePath[PageMap.VMWARE_SETTINGS_OWNER_RULES] || ""}
          element={
            <VMwareSettingsOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={VMwareRoutePath[PageMap.VMWARE_SETTINGS_LABEL_RULES] || ""}
          element={
            <VMwareSettingsLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={VMwareRoutePath[PageMap.VMWARE_ARCHIVED] || ""}
          element={
            <VMwareArchived
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_ARCHIVED] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={VMwareRoutePath[PageMap.VMWARE_VCENTER_VIEW] || ""}
        element={<VMwareVCenterViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <VMwareVCenterOverview
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW] as Route}
            />
          }
        />

        {/* Hosts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.VMWARE_VCENTER_VIEW_HOSTS)}
          element={
            <VMwareVCenterHosts
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW_HOSTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL,
            2,
          )}
          element={
            <VMwareVCenterHostDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_HOST_DETAIL] as Route
              }
            />
          }
        />

        {/* Virtual Machines */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES,
          )}
          element={
            <VMwareVCenterVirtualMachines
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL,
            2,
          )}
          element={
            <VMwareVCenterVirtualMachineDetail
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.VMWARE_VCENTER_VIEW_VIRTUAL_MACHINE_DETAIL
                ] as Route
              }
            />
          }
        />

        {/* Datastores */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_DATASTORES,
          )}
          element={
            <VMwareVCenterDatastores
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_DATASTORES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL,
            2,
          )}
          element={
            <VMwareVCenterDatastoreDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL] as Route
              }
            />
          }
        />

        {/* Clusters */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_CLUSTERS,
          )}
          element={
            <VMwareVCenterClusters
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_CLUSTERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL,
            2,
          )}
          element={
            <VMwareVCenterClusterDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_CLUSTER_DETAIL] as Route
              }
            />
          }
        />

        {/* Resource Pools */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS,
          )}
          element={
            <VMwareVCenterResourcePools
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_RESOURCE_POOLS] as Route
              }
            />
          }
        />

        {/* Insights */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_INSIGHTS,
          )}
          element={
            <VMwareVCenterInsights
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_INSIGHTS] as Route
              }
            />
          }
        />

        {/* Recommendations */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS,
          )}
          element={
            <VMwareVCenterRecommendations
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_RECOMMENDATIONS] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_METRICS,
          )}
          element={
            <VMwareVCenterMetrics
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW_METRICS] as Route}
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.VMWARE_VCENTER_VIEW_LOGS)}
          element={
            <VMwareVCenterLogs
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_INCIDENTS,
          )}
          element={
            <VMwareVCenterIncidents
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_INCIDENTS] as Route
              }
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.VMWARE_VCENTER_VIEW_ALERTS)}
          element={
            <VMwareVCenterAlerts
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <VMwareVCenterScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.VMWARE_VCENTER_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.VMWARE_VCENTER_VIEW_OWNERS)}
          element={
            <VMwareVCenterOwners
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* Feed */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.VMWARE_VCENTER_VIEW_FEED)}
          element={
            <VMwareVCenterFeed
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW_FEED] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_AUDIT_LOGS,
          )}
          element={
            <VMwareVCenterAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_AUDIT_LOGS] as Route
              }
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_SETTINGS,
          )}
          element={
            <VMwareVCenterSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.VMWARE_VCENTER_VIEW_DELETE)}
          element={
            <VMwareVCenterDelete
              {...props}
              pageRoute={RouteMap[PageMap.VMWARE_VCENTER_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION,
          )}
          element={
            <VMwareVCenterDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.VMWARE_VCENTER_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default VMwareRoutes;
