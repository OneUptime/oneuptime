import ComponentProps from "../Pages/PageComponentProps";
import MetricsLayout from "../Pages/Metrics/Layout";
import MetricsViewLayout from "../Pages/Metrics/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, MetricsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import MetricsPage from "../Pages/Metrics/Index";

import MetricViewPage from "../Pages/Metrics/View/Index";

const MetricsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<MetricsLayout {...props} />}>
        <PageRoute
          index
          element={
            <MetricsPage
              {...props}
              pageRoute={RouteMap[PageMap.METRICS] as Route}
            />
          }
        />
      </PageRoute>

      {/* Metric View */}
      <PageRoute
        path={MetricsRoutePath[PageMap.METRIC_VIEW] || ""}
        element={<MetricsViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <MetricViewPage
              {...props}
              pageRoute={RouteMap[PageMap.METRIC_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.METRIC_VIEW)}
          element={
            <MetricViewPage
              {...props}
              pageRoute={RouteMap[PageMap.METRIC_VIEW] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default MetricsRoutes;
