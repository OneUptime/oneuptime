import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import MetricsLayout from "../Pages/Metrics/Layout";
import MetricsViewLayout from "../Pages/Metrics/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, MetricsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Lazy Pages
const MetricsPage: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Metrics/Index");
  });

const MetricViewPage: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Metrics/View/Index");
  });

const MetricsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<MetricsLayout {...props} />}>
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <MetricsPage
                {...props}
                pageRoute={RouteMap[PageMap.METRICS] as Route}
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <MetricViewPage
                {...props}
                pageRoute={RouteMap[PageMap.METRIC_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.METRIC_VIEW)}
          element={
            <Suspense fallback={Loader}>
              <MetricViewPage
                {...props}
                pageRoute={RouteMap[PageMap.METRIC_VIEW] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default MetricsRoutes;
