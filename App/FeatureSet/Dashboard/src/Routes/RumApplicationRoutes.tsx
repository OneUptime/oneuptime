import ComponentProps from "../Pages/PageComponentProps";
import RumLayout from "../Pages/Rum/Layout";
import RumApplicationViewLayout from "../Pages/Rum/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, RumRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import RumApplications from "../Pages/Rum/RumApplications";
import RumApplicationOverview from "../Pages/Rum/View/Overview";
import RumApplicationMetrics from "../Pages/Rum/View/Metrics";
import RumApplicationLogs from "../Pages/Rum/View/Logs";
import RumApplicationTraces from "../Pages/Rum/View/Traces";
import RumApplicationClients from "../Pages/Rum/View/Clients";
import RumApplicationSessionReplay from "../Pages/Rum/View/SessionReplay";
import RumApplicationSessionReplayView from "../Pages/Rum/View/SessionReplayView";
import RumApplicationSessionReplayAudit from "../Pages/Rum/View/SessionReplayAudit";
import RumApplicationDocumentation from "../Pages/Rum/View/Documentation";
import RumApplicationDelete from "../Pages/Rum/View/Delete";
import RumLabelRules from "../Pages/Rum/Settings/LabelRules";
import RumOwnerRules from "../Pages/Rum/Settings/OwnerRules";
import RumSessionReplaySettings from "../Pages/Rum/Settings/SessionReplay";
import RumArchived from "../Pages/Rum/Archived";

const RumApplicationRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<RumLayout {...props} />}>
        <PageRoute
          path=""
          element={
            <RumApplications
              {...props}
              pageRoute={RouteMap[PageMap.RUM_APPLICATIONS] as Route}
            />
          }
        />
        <PageRoute
          path={RumRoutePath[PageMap.RUM_SETTINGS_LABEL_RULES] || ""}
          element={
            <RumLabelRules
              {...props}
              pageRoute={RouteMap[PageMap.RUM_SETTINGS_LABEL_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={RumRoutePath[PageMap.RUM_ARCHIVED] || ""}
          element={
            <RumArchived
              {...props}
              pageRoute={RouteMap[PageMap.RUM_ARCHIVED] as Route}
            />
          }
        />
        <PageRoute
          path={RumRoutePath[PageMap.RUM_SETTINGS_OWNER_RULES] || ""}
          element={
            <RumOwnerRules
              {...props}
              pageRoute={RouteMap[PageMap.RUM_SETTINGS_OWNER_RULES] as Route}
            />
          }
        />
        <PageRoute
          path={RumRoutePath[PageMap.RUM_SETTINGS_SESSION_REPLAY] || ""}
          element={
            <RumSessionReplaySettings
              {...props}
              pageRoute={RouteMap[PageMap.RUM_SETTINGS_SESSION_REPLAY] as Route}
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={RumRoutePath[PageMap.RUM_APPLICATION_VIEW] || ""}
        element={<RumApplicationViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <RumApplicationOverview
              {...props}
              pageRoute={RouteMap[PageMap.RUM_APPLICATION_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_METRICS,
          )}
          element={
            <RumApplicationMetrics
              {...props}
              pageRoute={
                RouteMap[PageMap.RUM_APPLICATION_VIEW_METRICS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUM_APPLICATION_VIEW_LOGS)}
          element={
            <RumApplicationLogs
              {...props}
              pageRoute={RouteMap[PageMap.RUM_APPLICATION_VIEW_LOGS] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_TRACES,
          )}
          element={
            <RumApplicationTraces
              {...props}
              pageRoute={RouteMap[PageMap.RUM_APPLICATION_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_CLIENTS,
          )}
          element={
            <RumApplicationClients
              {...props}
              pageRoute={
                RouteMap[PageMap.RUM_APPLICATION_VIEW_CLIENTS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY,
          )}
          element={
            <RumApplicationSessionReplay
              {...props}
              pageRoute={
                RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY] as Route
              }
            />
          }
        />

        {/*
         * Count 2, not the default 1. The player's route is
         * ":id/session-replay/:subModelId"; with the default the registered
         * path would collapse to just ":subModelId", which matches every
         * single-segment child of the application view and would shadow the
         * other tabs.
         */}
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW,
            2,
          )}
          element={
            <RumApplicationSessionReplayView
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT,
          )}
          element={
            <RumApplicationSessionReplayAudit
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_AUDIT
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION,
          )}
          element={
            <RumApplicationDocumentation
              {...props}
              pageRoute={
                RouteMap[PageMap.RUM_APPLICATION_VIEW_DOCUMENTATION] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.RUM_APPLICATION_VIEW_DELETE,
          )}
          element={
            <RumApplicationDelete
              {...props}
              pageRoute={RouteMap[PageMap.RUM_APPLICATION_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default RumApplicationRoutes;
