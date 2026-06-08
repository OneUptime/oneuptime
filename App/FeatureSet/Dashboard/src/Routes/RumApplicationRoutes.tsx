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
import RumApplicationDelete from "../Pages/Rum/View/Delete";

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
              pageRoute={RouteMap[PageMap.RUM_APPLICATION_VIEW_METRICS] as Route}
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
          path={RouteUtil.getLastPathForKey(PageMap.RUM_APPLICATION_VIEW_TRACES)}
          element={
            <RumApplicationTraces
              {...props}
              pageRoute={RouteMap[PageMap.RUM_APPLICATION_VIEW_TRACES] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUM_APPLICATION_VIEW_DELETE)}
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
