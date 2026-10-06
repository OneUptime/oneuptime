import ComponentProps from "../Pages/PageComponentProps";
import StorageArrayLayout from "../Pages/StorageArray/Layout";
import StorageArrayViewLayout from "../Pages/StorageArray/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, StorageArrayRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import StorageArrays from "../Pages/StorageArray/StorageArrays";
import StorageArraysDocumentation from "../Pages/StorageArray/Documentation";
import StorageArraysSettingsOwnerRules from "../Pages/StorageArray/Settings/OwnerRules";
import StorageArraysSettingsLabelRules from "../Pages/StorageArray/Settings/LabelRules";
import StorageArraysArchived from "../Pages/StorageArray/Archived";
import StorageArrayOverview from "../Pages/StorageArray/View/Index";
import StorageArrayVolumes from "../Pages/StorageArray/View/Volumes";
import StorageArrayVolumeDetail from "../Pages/StorageArray/View/VolumeDetail";
import StorageArrayHosts from "../Pages/StorageArray/View/Hosts";
import StorageArrayHostDetail from "../Pages/StorageArray/View/HostDetail";
import StorageArrayReplication from "../Pages/StorageArray/View/Replication";
import StorageArrayHardware from "../Pages/StorageArray/View/Hardware";
import StorageArrayDirectories from "../Pages/StorageArray/View/Directories";
import StorageArrayFileSystems from "../Pages/StorageArray/View/FileSystems";
import StorageArrayFileSystemDetail from "../Pages/StorageArray/View/FileSystemDetail";
import StorageArrayBuckets from "../Pages/StorageArray/View/Buckets";
import StorageArrayBucketDetail from "../Pages/StorageArray/View/BucketDetail";
import StorageArrayInsights from "../Pages/StorageArray/View/Insights";
import StorageArrayRecommendations from "../Pages/StorageArray/View/Recommendations";
import StorageArrayMetrics from "../Pages/StorageArray/View/Metrics";
import StorageArrayLogs from "../Pages/StorageArray/View/Logs";
import StorageArrayIncidents from "../Pages/StorageArray/View/Incidents";
import StorageArrayAlerts from "../Pages/StorageArray/View/Alerts";
import StorageArrayScheduledMaintenance from "../Pages/StorageArray/View/ScheduledMaintenance";
import StorageArrayOwners from "../Pages/StorageArray/View/Owners";
import StorageArrayFeed from "../Pages/StorageArray/View/Feed";
import StorageArrayAuditLogs from "../Pages/StorageArray/View/AuditLogs";
import StorageArraySettings from "../Pages/StorageArray/View/Settings";
import StorageArrayDelete from "../Pages/StorageArray/View/Delete";
import StorageArrayDocumentation from "../Pages/StorageArray/View/Documentation";
import StorageArrayLabelRule from "Common/Models/DatabaseModels/StorageArrayLabelRule";
import StorageArrayOwnerRule from "Common/Models/DatabaseModels/StorageArrayOwnerRule";
import StorageArray from "Common/Models/DatabaseModels/StorageArray";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

const StorageArrayRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<StorageArrayLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <StorageArrays
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAYS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAYS_DOCUMENTATION,
          )}
          element={
            <StorageArraysDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAYS_DOCUMENTATION] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            StorageArrayRoutePath[
              PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULES
            ] || ""
          }
          element={
            <StorageArraysSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            StorageArrayRoutePath[
              PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULE_VIEW
            ] || ""
          }
          element={
            <StorageArraysSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULE_VIEW
                ] as Route
              }
              ruleViewModelType={StorageArrayOwnerRule}
            />
          }
        />
        <PageRoute
          path={
            StorageArrayRoutePath[
              PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULES
            ] || ""
          }
          element={
            <StorageArraysSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            StorageArrayRoutePath[
              PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULE_VIEW
            ] || ""
          }
          element={
            <StorageArraysSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULE_VIEW
                ] as Route
              }
              ruleViewModelType={StorageArrayLabelRule}
            />
          }
        />
        <PageRoute
          path={StorageArrayRoutePath[PageMap.STORAGE_ARRAYS_ARCHIVED] || ""}
          element={
            <StorageArraysArchived
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAYS_ARCHIVED] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: StorageArray,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.STORAGE_ARRAYS_ROOT,
        })}
      </PageRoute>

      <PageRoute
        path={StorageArrayRoutePath[PageMap.STORAGE_ARRAY_VIEW] || ""}
        element={<StorageArrayViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <StorageArrayOverview
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW] as Route}
            />
          }
        />

        {/* Volumes (FlashArray) */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_VOLUMES)}
          element={
            <StorageArrayVolumes
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_VOLUMES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
            2,
          )}
          element={
            <StorageArrayVolumeDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL] as Route
              }
            />
          }
        />

        {/* Hosts (FlashArray) */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_HOSTS)}
          element={
            <StorageArrayHosts
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_HOSTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL,
            2,
          )}
          element={
            <StorageArrayHostDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL] as Route
              }
            />
          }
        />

        {/* Replication (FlashArray pods) */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_REPLICATION,
          )}
          element={
            <StorageArrayReplication
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_REPLICATION] as Route
              }
            />
          }
        />

        {/* Hardware (FlashArray and FlashBlade) */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
          )}
          element={
            <StorageArrayHardware
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_HARDWARE] as Route}
            />
          }
        />

        {/* Directories (FlashArray file services) */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_DIRECTORIES,
          )}
          element={
            <StorageArrayDirectories
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_DIRECTORIES] as Route
              }
            />
          }
        />

        {/* File Systems (FlashBlade) */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS,
          )}
          element={
            <StorageArrayFileSystems
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
            2,
          )}
          element={
            <StorageArrayFileSystemDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL] as Route
              }
            />
          }
        />

        {/* Buckets (FlashBlade) */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_BUCKETS)}
          element={
            <StorageArrayBuckets
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_BUCKETS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL,
            2,
          )}
          element={
            <StorageArrayBucketDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL] as Route
              }
            />
          }
        />

        {/* Insights */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_INSIGHTS,
          )}
          element={
            <StorageArrayInsights
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_INSIGHTS] as Route}
            />
          }
        />

        {/* Recommendations */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_RECOMMENDATIONS,
          )}
          element={
            <StorageArrayRecommendations
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_RECOMMENDATIONS] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_METRICS)}
          element={
            <StorageArrayMetrics
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_METRICS] as Route}
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_LOGS)}
          element={
            <StorageArrayLogs
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_INCIDENTS,
          )}
          element={
            <StorageArrayIncidents
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_INCIDENTS] as Route
              }
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_ALERTS)}
          element={
            <StorageArrayAlerts
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <StorageArrayScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.STORAGE_ARRAY_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_OWNERS)}
          element={
            <StorageArrayOwners
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* Feed */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_FEED)}
          element={
            <StorageArrayFeed
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_FEED] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_AUDIT_LOGS,
          )}
          element={
            <StorageArrayAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_AUDIT_LOGS] as Route
              }
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_SETTINGS,
          )}
          element={
            <StorageArraySettings
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_SETTINGS] as Route}
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.STORAGE_ARRAY_VIEW_DELETE)}
          element={
            <StorageArrayDelete
              {...props}
              pageRoute={RouteMap[PageMap.STORAGE_ARRAY_VIEW_DELETE] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.STORAGE_ARRAY_VIEW_DOCUMENTATION,
          )}
          element={
            <StorageArrayDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.STORAGE_ARRAY_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: StorageArray,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default StorageArrayRoutes;
