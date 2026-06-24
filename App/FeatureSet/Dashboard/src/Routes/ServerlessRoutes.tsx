import ComponentProps from "../Pages/PageComponentProps";
import ServerlessLayout from "../Pages/Serverless/Layout";
import ServerlessFunctionViewLayout from "../Pages/Serverless/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, ServerlessRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import ServerlessFunctions from "../Pages/Serverless/ServerlessFunctions";
import ServerlessFunctionOverview from "../Pages/Serverless/View/Overview";
import ServerlessFunctionMetrics from "../Pages/Serverless/View/Metrics";
import ServerlessFunctionLogs from "../Pages/Serverless/View/Logs";
import ServerlessFunctionTraces from "../Pages/Serverless/View/Traces";
import ServerlessFunctionInstances from "../Pages/Serverless/View/Instances";
import ServerlessFunctionDocumentation from "../Pages/Serverless/View/Documentation";
import ServerlessFunctionDelete from "../Pages/Serverless/View/Delete";
import ServerlessLabelRules from "../Pages/Serverless/Settings/LabelRules";
import ServerlessOwnerRules from "../Pages/Serverless/Settings/OwnerRules";
import ServerlessArchived from "../Pages/Serverless/Archived";

const ServerlessRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ServerlessLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <ServerlessFunctions
              {...props}
              pageRoute={RouteMap[PageMap.SERVERLESS_FUNCTIONS] as Route}
            />
          }
        />
        <PageRoute
          path={
            ServerlessRoutePath[PageMap.SERVERLESS_SETTINGS_LABEL_RULES] || ""
          }
          element={
            <ServerlessLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVERLESS_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={
            ServerlessRoutePath[PageMap.SERVERLESS_SETTINGS_OWNER_RULES] || ""
          }
          element={
            <ServerlessOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVERLESS_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={ServerlessRoutePath[PageMap.SERVERLESS_ARCHIVED] || ""}
          element={
            <ServerlessArchived
              {...props}
              pageRoute={RouteMap[PageMap.SERVERLESS_ARCHIVED] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={ServerlessRoutePath[PageMap.SERVERLESS_FUNCTION_VIEW] || ""}
        element={<ServerlessFunctionViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <ServerlessFunctionOverview
              {...props}
              pageRoute={RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVERLESS_FUNCTION_VIEW_METRICS,
          )}
          element={
            <ServerlessFunctionMetrics
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_METRICS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVERLESS_FUNCTION_VIEW_LOGS,
          )}
          element={
            <ServerlessFunctionLogs
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_LOGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVERLESS_FUNCTION_VIEW_TRACES,
          )}
          element={
            <ServerlessFunctionTraces
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_TRACES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVERLESS_FUNCTION_VIEW_INSTANCES,
          )}
          element={
            <ServerlessFunctionInstances
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_INSTANCES] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVERLESS_FUNCTION_VIEW_DOCUMENTATION,
          )}
          element={
            <ServerlessFunctionDocumentation
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.SERVERLESS_FUNCTION_VIEW_DOCUMENTATION
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVERLESS_FUNCTION_VIEW_DELETE,
          )}
          element={
            <ServerlessFunctionDelete
              {...props}
              pageRoute={
                RouteMap[PageMap.SERVERLESS_FUNCTION_VIEW_DELETE] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ServerlessRoutes;
