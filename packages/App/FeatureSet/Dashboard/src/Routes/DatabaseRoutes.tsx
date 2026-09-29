import ComponentProps from "../Pages/PageComponentProps";
import DatabaseLayout from "../Pages/Database/Layout";
import DatabaseServerViewLayout from "../Pages/Database/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, DatabaseRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import Databases from "../Pages/Database/Databases";
import DatabaseArchived from "../Pages/Database/Archived";
import DatabaseDocumentation from "../Pages/Database/Documentation";
import DatabaseLabelRules from "../Pages/Database/Settings/LabelRules";
import DatabaseOwnerRules from "../Pages/Database/Settings/OwnerRules";
import DatabaseServerOverview from "../Pages/Database/View/Overview";
import DatabaseServerSettings from "../Pages/Database/View/Settings";
import DatabaseServerMetrics from "../Pages/Database/View/Metrics";
import DatabaseServerLogs from "../Pages/Database/View/Logs";
import DatabaseServerTraces from "../Pages/Database/View/Traces";
import DatabaseServerIncidents from "../Pages/Database/View/Incidents";
import DatabaseServerAlerts from "../Pages/Database/View/Alerts";
import DatabaseServerScheduledMaintenance from "../Pages/Database/View/ScheduledMaintenance";
import DatabaseServerFeed from "../Pages/Database/View/Feed";
import DatabaseServerOwners from "../Pages/Database/View/Owners";
import DatabaseServerEndpoints from "../Pages/Database/View/Endpoints";
import DatabaseServerRecommendations from "../Pages/Database/View/Recommendations";
import DatabaseServerDocumentation from "../Pages/Database/View/Documentation";
import DatabaseServerDelete from "../Pages/Database/View/Delete";
import DatabaseServerLabelRule from "Common/Models/DatabaseModels/DatabaseServerLabelRule";
import DatabaseServerOwnerRule from "Common/Models/DatabaseModels/DatabaseServerOwnerRule";

const DatabaseRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<DatabaseLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <Databases
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVERS] as Route}
            />
          }
        />
        <PageRoute
          path={DatabaseRoutePath[PageMap.DATABASE_DOCUMENTATION] || ""}
          element={
            <DatabaseDocumentation
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_DOCUMENTATION] as Route}
            />
          }
        />
        <PageRoute
          path={DatabaseRoutePath[PageMap.DATABASE_SETTINGS_LABEL_RULES] || ""}
          element={
            <DatabaseLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DatabaseRoutePath[PageMap.DATABASE_SETTINGS_LABEL_RULE_VIEW] || ""
          }
          element={
            <DatabaseLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SETTINGS_LABEL_RULE_VIEW] as Route
              }
              ruleViewModelType={DatabaseServerLabelRule}
            />
          }
        />
        <PageRoute
          path={DatabaseRoutePath[PageMap.DATABASE_SETTINGS_OWNER_RULES] || ""}
          element={
            <DatabaseOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            DatabaseRoutePath[PageMap.DATABASE_SETTINGS_OWNER_RULE_VIEW] || ""
          }
          element={
            <DatabaseOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SETTINGS_OWNER_RULE_VIEW] as Route
              }
              ruleViewModelType={DatabaseServerOwnerRule}
            />
          }
        />
        <PageRoute
          path={DatabaseRoutePath[PageMap.DATABASE_ARCHIVED] || ""}
          element={
            <DatabaseArchived
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_ARCHIVED] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={DatabaseRoutePath[PageMap.DATABASE_SERVER_VIEW] || ""}
        element={<DatabaseServerViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <DatabaseServerOverview
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_SETTINGS,
          )}
          element={
            <DatabaseServerSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SERVER_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_METRICS,
          )}
          element={
            <DatabaseServerMetrics
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SERVER_VIEW_METRICS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DATABASE_SERVER_VIEW_LOGS)}
          element={
            <DatabaseServerLogs
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVER_VIEW_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_TRACES,
          )}
          element={
            <DatabaseServerTraces
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVER_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_INCIDENTS,
          )}
          element={
            <DatabaseServerIncidents
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SERVER_VIEW_INCIDENTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_ALERTS,
          )}
          element={
            <DatabaseServerAlerts
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVER_VIEW_ALERTS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE,
          )}
          element={
            <DatabaseServerScheduledMaintenance
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DATABASE_SERVER_VIEW_FEED)}
          element={
            <DatabaseServerFeed
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVER_VIEW_FEED] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_OWNERS,
          )}
          element={
            <DatabaseServerOwners
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVER_VIEW_OWNERS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_ENDPOINTS,
          )}
          element={
            <DatabaseServerEndpoints
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SERVER_VIEW_ENDPOINTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_RECOMMENDATIONS,
          )}
          element={
            <DatabaseServerRecommendations
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SERVER_VIEW_RECOMMENDATIONS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION,
          )}
          element={
            <DatabaseServerDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.DATABASE_SERVER_VIEW_DELETE,
          )}
          element={
            <DatabaseServerDelete
              {...props}
              pageRoute={RouteMap[PageMap.DATABASE_SERVER_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default DatabaseRoutes;
