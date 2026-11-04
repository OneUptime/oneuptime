import ComponentProps from "../Pages/PageComponentProps";
import OpenStackLayout from "../Pages/OpenStack/Layout";
import OpenStackCloudViewLayout from "../Pages/OpenStack/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, OpenStackRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import OpenStackClouds from "../Pages/OpenStack/Clouds";
import OpenStackDocumentation from "../Pages/OpenStack/Documentation";
import OpenStackSettingsOwnerRules from "../Pages/OpenStack/Settings/OwnerRules";
import OpenStackSettingsLabelRules from "../Pages/OpenStack/Settings/LabelRules";
import OpenStackArchived from "../Pages/OpenStack/Archived";
import OpenStackCloudOverview from "../Pages/OpenStack/View/Index";
import OpenStackCloudServices from "../Pages/OpenStack/View/Services";
import OpenStackCloudHypervisors from "../Pages/OpenStack/View/Hypervisors";
import OpenStackCloudInstances from "../Pages/OpenStack/View/Instances";
import OpenStackCloudFlavors from "../Pages/OpenStack/View/Flavors";
import OpenStackCloudNetworks from "../Pages/OpenStack/View/Networks";
import OpenStackCloudRouters from "../Pages/OpenStack/View/Routers";
import OpenStackCloudFloatingIps from "../Pages/OpenStack/View/FloatingIps";
import OpenStackCloudVolumes from "../Pages/OpenStack/View/Volumes";
import OpenStackCloudStoragePools from "../Pages/OpenStack/View/StoragePools";
import OpenStackCloudImages from "../Pages/OpenStack/View/Images";
import OpenStackCloudProjects from "../Pages/OpenStack/View/Projects";
import OpenStackCloudMetrics from "../Pages/OpenStack/View/Metrics";
import OpenStackCloudLogs from "../Pages/OpenStack/View/Logs";
import OpenStackCloudIncidents from "../Pages/OpenStack/View/Incidents";
import OpenStackCloudAlerts from "../Pages/OpenStack/View/Alerts";
import OpenStackCloudScheduledMaintenance from "../Pages/OpenStack/View/ScheduledMaintenance";
import OpenStackCloudOwners from "../Pages/OpenStack/View/Owners";
import OpenStackCloudFeed from "../Pages/OpenStack/View/Feed";
import OpenStackCloudAuditLogs from "../Pages/OpenStack/View/AuditLogs";
import OpenStackCloudSettings from "../Pages/OpenStack/View/Settings";
import OpenStackCloudDelete from "../Pages/OpenStack/View/Delete";
import OpenStackCloudDocumentation from "../Pages/OpenStack/View/Documentation";
import OpenStackCloudLabelRule from "Common/Models/DatabaseModels/OpenStackCloudLabelRule";
import OpenStackCloudOwnerRule from "Common/Models/DatabaseModels/OpenStackCloudOwnerRule";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

const OpenStackRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<OpenStackLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <OpenStackClouds
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUDS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.OPENSTACK_DOCUMENTATION)}
          element={
            <OpenStackDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_OWNER_RULES] || ""
          }
          element={
            <OpenStackSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_OWNER_RULE_VIEW] || ""
          }
          element={
            <OpenStackSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_OWNER_RULE_VIEW] as Route
              }
              ruleViewModelType={OpenStackCloudOwnerRule}
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_LABEL_RULES] || ""
          }
          element={
            <OpenStackSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            OpenStackRoutePath[PageMap.OPENSTACK_SETTINGS_LABEL_RULE_VIEW] || ""
          }
          element={
            <OpenStackSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_SETTINGS_LABEL_RULE_VIEW] as Route
              }
              ruleViewModelType={OpenStackCloudLabelRule}
            />
          }
        />
        <PageRoute
          path={OpenStackRoutePath[PageMap.OPENSTACK_ARCHIVED] || ""}
          element={
            <OpenStackArchived
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_ARCHIVED] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: OpenStackCloud,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.OPENSTACK_ROOT,
        })}
      </PageRoute>

      <PageRoute
        path={OpenStackRoutePath[PageMap.OPENSTACK_CLOUD_VIEW] || ""}
        element={<OpenStackCloudViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <OpenStackCloudOverview
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW] as Route}
            />
          }
        />

        {/* Control Plane */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
          )}
          element={
            <OpenStackCloudServices
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SERVICES] as Route
              }
            />
          }
        />

        {/* Compute */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS,
          )}
          element={
            <OpenStackCloudHypervisors
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
          )}
          element={
            <OpenStackCloudInstances
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS,
          )}
          element={
            <OpenStackCloudFlavors
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FLAVORS] as Route
              }
            />
          }
        />

        {/* Network */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
          )}
          element={
            <OpenStackCloudNetworks
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
          )}
          element={
            <OpenStackCloudRouters
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
          )}
          element={
            <OpenStackCloudFloatingIps
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS] as Route
              }
            />
          }
        />

        {/* Storage */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
          )}
          element={
            <OpenStackCloudVolumes
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS,
          )}
          element={
            <OpenStackCloudStoragePools
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_STORAGE_POOLS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_IMAGES,
          )}
          element={
            <OpenStackCloudImages
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_IMAGES] as Route}
            />
          }
        />

        {/* Tenancy */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS,
          )}
          element={
            <OpenStackCloudProjects
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS] as Route
              }
            />
          }
        />

        {/* Telemetry */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_METRICS,
          )}
          element={
            <OpenStackCloudMetrics
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_METRICS] as Route
              }
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.OPENSTACK_CLOUD_VIEW_LOGS)}
          element={
            <OpenStackCloudLogs
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS,
          )}
          element={
            <OpenStackCloudIncidents
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_INCIDENTS] as Route
              }
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_ALERTS,
          )}
          element={
            <OpenStackCloudAlerts
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <OpenStackCloudScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_OWNERS,
          )}
          element={
            <OpenStackCloudOwners
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* Feed */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.OPENSTACK_CLOUD_VIEW_FEED)}
          element={
            <OpenStackCloudFeed
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_FEED] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_AUDIT_LOGS,
          )}
          element={
            <OpenStackCloudAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_AUDIT_LOGS] as Route
              }
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS,
          )}
          element={
            <OpenStackCloudSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_DELETE,
          )}
          element={
            <OpenStackCloudDelete
              {...props}
              pageRoute={RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION,
          )}
          element={
            <OpenStackCloudDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: OpenStackCloud,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default OpenStackRoutes;
