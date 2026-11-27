import ComponentProps from "../Pages/PageComponentProps";
import XcpNgLayout from "../Pages/XcpNg/Layout";
import XcpNgPoolViewLayout from "../Pages/XcpNg/View/Layout";
import XcpNgPoolTopology from "../Pages/XcpNg/View/Topology";
import XcpNgPoolAiAgent from "../Pages/XcpNg/View/AI/Agent";
import XcpNgPoolAiInsights from "../Pages/XcpNg/View/AI/Insights";
import XcpNgPoolAiLogs from "../Pages/XcpNg/View/AI/Logs";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, XcpNgRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import XcpNgPools from "../Pages/XcpNg/Pools";
import XcpNgDocumentation from "../Pages/XcpNg/Documentation";
import XcpNgSettingsOwnerRules from "../Pages/XcpNg/Settings/OwnerRules";
import XcpNgSettingsLabelRules from "../Pages/XcpNg/Settings/LabelRules";
import XcpNgRulesAuditLogs from "../Pages/XcpNg/Settings/RulesAuditLogs";
import XcpNgArchived from "../Pages/XcpNg/Archived";
import XcpNgConnections from "../Pages/XcpNg/Connections";
import XcpNgConnectionView from "../Pages/XcpNg/ConnectionView";
import XcpNgPoolOverview from "../Pages/XcpNg/View/Index";
import XcpNgPoolHosts from "../Pages/XcpNg/View/Hosts";
import XcpNgPoolHostDetail from "../Pages/XcpNg/View/HostDetail";
import XcpNgPoolVms from "../Pages/XcpNg/View/Vms";
import XcpNgPoolVmDetail from "../Pages/XcpNg/View/VmDetail";
import XcpNgPoolStorage from "../Pages/XcpNg/View/Storage";
import XcpNgPoolStorageDetail from "../Pages/XcpNg/View/StorageDetail";
import XcpNgPoolInsights from "../Pages/XcpNg/View/Insights";
import XcpNgPoolRecommendations from "../Pages/XcpNg/View/Recommendations";
import XcpNgPoolMetrics from "../Pages/XcpNg/View/Metrics";
import XcpNgPoolLogs from "../Pages/XcpNg/View/Logs";
import XcpNgPoolAlerts from "../Pages/XcpNg/View/Alerts";
import XcpNgPoolIncidents from "../Pages/XcpNg/View/Incidents";
import XcpNgPoolScheduledMaintenance from "../Pages/XcpNg/View/ScheduledMaintenance";
import XcpNgPoolFeed from "../Pages/XcpNg/View/Feed";
import XcpNgPoolOwners from "../Pages/XcpNg/View/Owners";
import XcpNgPoolSettings from "../Pages/XcpNg/View/Settings";
import XcpNgPoolDocumentation from "../Pages/XcpNg/View/Documentation";
import XcpNgPoolAuditLogs from "../Pages/XcpNg/View/AuditLogs";
import XcpNgPoolDelete from "../Pages/XcpNg/View/Delete";
import XcpNgPoolLabelRule from "Common/Models/DatabaseModels/XcpNgPoolLabelRule";
import XcpNgPoolOwnerRule from "Common/Models/DatabaseModels/XcpNgPoolOwnerRule";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

/*
 * The XCP-ng product: the product's own pages (every pool, the archived
 * ones, the connections a probe reads and each one's page, the install
 * guide and the owner and label rules) under one layout, and one pool's
 * pages under its own. A pool's hosts, VMs and storage
 * repositories each have a page of their own, keyed by the object's XAPI
 * UUID, so their routes take two trailing path segments ("hosts/:uuid"),
 * never one that would shadow the list.
 */
const XcpNgRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<XcpNgLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <XcpNgPools
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOLS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_DOCUMENTATION)}
          element={
            <XcpNgDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_SETTINGS_OWNER_RULES] || ""}
          element={
            <XcpNgSettingsOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_SETTINGS_OWNER_RULE_VIEW] || ""}
          element={
            <XcpNgSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_SETTINGS_OWNER_RULE_VIEW] as Route
              }
              ruleViewModelType={XcpNgPoolOwnerRule}
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_SETTINGS_LABEL_RULES] || ""}
          element={
            <XcpNgSettingsLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_SETTINGS_RULES_AUDIT_LOGS] || ""}
          element={
            <XcpNgRulesAuditLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_SETTINGS_RULES_AUDIT_LOGS] as Route
              }
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_SETTINGS_LABEL_RULE_VIEW] || ""}
          element={
            <XcpNgSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_SETTINGS_LABEL_RULE_VIEW] as Route
              }
              ruleViewModelType={XcpNgPoolLabelRule}
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_POOLS_ARCHIVED] || ""}
          element={
            <XcpNgArchived
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOLS_ARCHIVED] as Route}
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_CONNECTIONS] || ""}
          element={
            <XcpNgConnections
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_CONNECTIONS] as Route}
            />
          }
        />
        <PageRoute
          path={XcpNgRoutePath[PageMap.XCP_NG_CONNECTION_VIEW] || ""}
          element={
            <XcpNgConnectionView
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_CONNECTION_VIEW] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: XcpNgPool,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.XCP_NG_ROOT,
        })}
      </PageRoute>

      <PageRoute
        path={XcpNgRoutePath[PageMap.XCP_NG_POOL_VIEW] || ""}
        element={<XcpNgPoolViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <XcpNgPoolOverview
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW] as Route}
            />
          }
        />

        {/* Hosts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_HOSTS)}
          element={
            <XcpNgPoolHosts
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_HOSTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL,
            2,
          )}
          element={
            <XcpNgPoolHostDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL] as Route
              }
            />
          }
        />

        {/* VMs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_VMS)}
          element={
            <XcpNgPoolVms
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_VMS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_VM_DETAIL,
            2,
          )}
          element={
            <XcpNgPoolVmDetail
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_VM_DETAIL] as Route}
            />
          }
        />

        {/* Storage repositories */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_STORAGE)}
          element={
            <XcpNgPoolStorage
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_STORAGE] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL,
            2,
          )}
          element={
            <XcpNgPoolStorageDetail
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL] as Route
              }
            />
          }
        />

        {/* Topology */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_TOPOLOGY)}
          element={
            <XcpNgPoolTopology
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_TOPOLOGY] as Route}
            />
          }
        />

        {/* AI: Insights, Logs, and the pool's XCP-ng AI agent */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_AI_INSIGHTS,
            2,
          )}
          element={
            <XcpNgPoolAiInsights
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_POOL_VIEW_AI_INSIGHTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_AI_LOGS,
            2,
          )}
          element={
            <XcpNgPoolAiLogs
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_AI_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_AI_AGENT,
            2,
          )}
          element={
            <XcpNgPoolAiAgent
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_AI_AGENT] as Route}
            />
          }
        />

        {/* Resource Usage */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_INSIGHTS)}
          element={
            <XcpNgPoolInsights
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_INSIGHTS] as Route}
            />
          }
        />

        {/* Recommendations */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_RECOMMENDATIONS,
          )}
          element={
            <XcpNgPoolRecommendations
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_POOL_VIEW_RECOMMENDATIONS] as Route
              }
            />
          }
        />

        {/* Metrics */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_METRICS)}
          element={
            <XcpNgPoolMetrics
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_METRICS] as Route}
            />
          }
        />

        {/* Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_LOGS)}
          element={
            <XcpNgPoolLogs
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_LOGS] as Route}
            />
          }
        />

        {/* Incidents */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_INCIDENTS)}
          element={
            <XcpNgPoolIncidents
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_INCIDENTS] as Route}
            />
          }
        />

        {/* Alerts */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_ALERTS)}
          element={
            <XcpNgPoolAlerts
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_ALERTS] as Route}
            />
          }
        />

        {/* Scheduled Maintenance */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <XcpNgPoolScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        {/* Feed */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_FEED)}
          element={
            <XcpNgPoolFeed
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_FEED] as Route}
            />
          }
        />

        {/* Owners */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_OWNERS)}
          element={
            <XcpNgPoolOwners
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_OWNERS] as Route}
            />
          }
        />

        {/* Settings */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_SETTINGS)}
          element={
            <XcpNgPoolSettings
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_SETTINGS] as Route}
            />
          }
        />

        {/* Audit Logs */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_AUDIT_LOGS,
          )}
          element={
            <XcpNgPoolAuditLogs
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_AUDIT_LOGS] as Route}
            />
          }
        />

        {/* Documentation */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION,
          )}
          element={
            <XcpNgPoolDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        {/* Delete */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.XCP_NG_POOL_VIEW_DELETE)}
          element={
            <XcpNgPoolDelete
              {...props}
              pageRoute={RouteMap[PageMap.XCP_NG_POOL_VIEW_DELETE] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: XcpNgPool,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>
    </Routes>
  );
};

export default XcpNgRoutes;
