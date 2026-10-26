import ComponentProps from "../Pages/PageComponentProps";
import CloudLayout from "../Pages/Cloud/Layout";
import CloudResourceViewLayout from "../Pages/Cloud/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, CloudRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import CloudResources from "../Pages/Cloud/CloudResources";
import CloudResourceOverview from "../Pages/Cloud/View/Overview";
import CloudResourceSettings from "../Pages/Cloud/View/Settings";
import CloudResourceMetrics from "../Pages/Cloud/View/Metrics";
import CloudResourceLogs from "../Pages/Cloud/View/Logs";
import CloudResourceTraces from "../Pages/Cloud/View/Traces";
import CloudResourceInstances from "../Pages/Cloud/View/Instances";
import CloudResourceFeed from "../Pages/Cloud/View/Feed";
import CloudResourceOwners from "../Pages/Cloud/View/Owners";
import CloudResourceDocumentation from "../Pages/Cloud/View/Documentation";
import CloudResourceDelete from "../Pages/Cloud/View/Delete";
import CloudResourceIncidents from "../Pages/Cloud/View/Incidents";
import CloudResourceAlerts from "../Pages/Cloud/View/Alerts";
import CloudResourceChanges from "../Pages/Cloud/View/Changes";
import CloudLabelRules from "../Pages/Cloud/Settings/LabelRules";
import CloudOwnerRules from "../Pages/Cloud/Settings/OwnerRules";
import CloudArchived from "../Pages/Cloud/Archived";
import CloudMonitoredResources from "../Pages/Cloud/MonitoredResources";
import CloudConnect from "../Pages/Cloud/Connect";
import CloudAccounts from "../Pages/Cloud/Accounts/Accounts";
import CloudAccountViewLayout from "../Pages/Cloud/Accounts/View/Layout";
import CloudAccountOverview from "../Pages/Cloud/Accounts/View/Overview";
import CloudAccountResources from "../Pages/Cloud/Accounts/View/Resources";
import CloudAccountChanges from "../Pages/Cloud/Accounts/View/Changes";
import CloudAccountTopology from "../Pages/Cloud/Accounts/View/Topology";
import CloudAccountSettings from "../Pages/Cloud/Accounts/View/Settings";
import CloudAccountDelete from "../Pages/Cloud/Accounts/View/Delete";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudResourceLabelRule from "Common/Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "Common/Models/DatabaseModels/CloudResourceOwnerRule";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

const CloudResourceRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<CloudLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <CloudResources
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCES] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_SETTINGS_LABEL_RULES] || ""}
          element={
            <CloudLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_SETTINGS_LABEL_RULE_VIEW] || ""}
          element={
            <CloudLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_SETTINGS_LABEL_RULE_VIEW] as Route
              }
              ruleViewModelType={CloudResourceLabelRule}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_SETTINGS_OWNER_RULES] || ""}
          element={
            <CloudOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_SETTINGS_OWNER_RULE_VIEW] || ""}
          element={
            <CloudOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_SETTINGS_OWNER_RULE_VIEW] as Route
              }
              ruleViewModelType={CloudResourceOwnerRule}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_MONITORED_RESOURCES] || ""}
          element={
            <CloudMonitoredResources
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_MONITORED_RESOURCES] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_CONNECT] || ""}
          element={
            <CloudConnect
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_CONNECT] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_ARCHIVED] || ""}
          element={
            <CloudArchived
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_ARCHIVED] as Route}
            />
          }
        />
        <PageRoute
          path={CloudRoutePath[PageMap.CLOUD_ACCOUNTS] || ""}
          element={
            <CloudAccounts
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_ACCOUNTS] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: CloudResource,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.CLOUD_ROOT,
        })}
      </PageRoute>

      {/*
       * One cloud account's pages. "accounts/:id" is static then dynamic,
       * so it wins over a resource's ":id" route below.
       */}
      <PageRoute
        path={CloudRoutePath[PageMap.CLOUD_ACCOUNT_VIEW] || ""}
        element={<CloudAccountViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <CloudAccountOverview
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_ACCOUNT_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES,
          )}
          element={
            <CloudAccountResources
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_RESOURCES] as Route
              }
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_ACCOUNT_VIEW_CHANGES)}
          element={
            <CloudAccountChanges
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_CHANGES] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_ACCOUNT_VIEW_TOPOLOGY,
          )}
          element={
            <CloudAccountTopology
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_TOPOLOGY] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS,
          )}
          element={
            <CloudAccountSettings
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_SETTINGS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_ACCOUNT_VIEW_DELETE)}
          element={
            <CloudAccountDelete
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_DELETE] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: CloudAccount,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>

      <PageRoute
        path={CloudRoutePath[PageMap.CLOUD_RESOURCE_VIEW] || ""}
        element={<CloudResourceViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <CloudResourceOverview
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_SETTINGS,
          )}
          element={
            <CloudResourceSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_METRICS,
          )}
          element={
            <CloudResourceMetrics
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_METRICS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_LOGS)}
          element={
            <CloudResourceLogs
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_TRACES)}
          element={
            <CloudResourceTraces
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_INSTANCES,
          )}
          element={
            <CloudResourceInstances
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_INSTANCES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS,
          )}
          element={
            <CloudResourceIncidents
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_INCIDENTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_ALERTS)}
          element={
            <CloudResourceAlerts
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_ALERTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_CHANGES,
          )}
          element={
            <CloudResourceChanges
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_CHANGES] as Route}
            />
          }
        />

        {/* Feed */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_FEED)}
          element={
            <CloudResourceFeed
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_FEED] as Route}
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_OWNERS)}
          element={
            <CloudResourceOwners
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION,
          )}
          element={
            <CloudResourceDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_DELETE)}
          element={
            <CloudResourceDelete
              {...props}
              pageRoute={RouteMap[PageMap.CLOUD_RESOURCE_VIEW_DELETE] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: CloudResource,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default CloudResourceRoutes;
