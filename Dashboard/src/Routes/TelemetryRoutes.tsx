import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import TelemetryServiceViewLayout from "../Pages/Telemetry/Services/View/Layout";
import TelemetryMetricLayout from "../Pages/Telemetry/Metrics/View/Layout";
import TelemetryTraceLayout from "../Pages/Telemetry/Traces/View/Layout";
import TelemetryViewLayout from "../Pages/Telemetry/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, TelemetryRoutePath } from "../Utils/RouteMap";
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
const TelemetryServices: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services");
});

const TelemetryDocumentation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Documentation");
});

const TelemetryLogs: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Telemetry/Logs");
  });

const TelemetryViewTrace: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Traces/View/Index");
});

const TelemetryTraces: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Telemetry/Traces");
  });

const TelemetryMetrics: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Telemetry/Metrics");
  });

const TelemetryViewMetric: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Metrics/View/Index");
});

const TelemetryServiceView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Index");
});
const TelemetryServiceViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Delete");
});

const TelemetryServiceViewLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Logs/Index");
});

const TelemetryServiceViewTraces: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Traces/Index");
});

const TelemetryServiceViewTrace: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Traces/View/Index");
});

const TelemetryServiceViewMetric: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Metrics/View/Index");
});

const TelemetryServiceViewMetrics: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Metrics/Index");
});

const TelemetryServicesViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Settings");
});

const TelemetryServicesViewDocumentation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Telemetry/Services/View/Documentation");
});

const TelemetryRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<TelemetryViewLayout {...props} />}>
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <TelemetryServices
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={TelemetryRoutePath[PageMap.TELEMETRY_LOGS] || ""}
          element={
            <Suspense fallback={Loader}>
              <TelemetryLogs
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_LOGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={TelemetryRoutePath[PageMap.TELEMETRY_TRACES] || ""}
          element={
            <Suspense fallback={Loader}>
              <TelemetryTraces
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_TRACES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={TelemetryRoutePath[PageMap.TELEMETRY_METRICS] || ""}
          element={
            <Suspense fallback={Loader}>
              <TelemetryMetrics
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_METRICS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={TelemetryRoutePath[PageMap.TELEMETRY_SERVICES] || ""}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServices
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_SERVICES] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={TelemetryRoutePath[PageMap.TELEMETRY_DOCUMENTATION] || ""}
          element={
            <Suspense fallback={Loader}>
              <TelemetryDocumentation
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_DOCUMENTATION] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      {/* Metric View */}

      <PageRoute
        path={TelemetryRoutePath[PageMap.TELEMETRY_METRIC_ROOT] || ""}
        element={<TelemetryMetricLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <TelemetryViewMetric
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_METRIC_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TELEMETRY_METRIC_VIEW)}
          element={
            <Suspense fallback={Loader}>
              <TelemetryViewMetric
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_METRIC_VIEW] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      {/* Trace View */}

      <PageRoute
        path={TelemetryRoutePath[PageMap.TELEMETRY_TRACE_ROOT] || ""}
        element={<TelemetryTraceLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <TelemetryViewTrace
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_TRACE_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TELEMETRY_TRACE_VIEW)}
          element={
            <Suspense fallback={Loader}>
              <TelemetryViewTrace
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_TRACE_VIEW] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      {/* Telemetry Service View */}

      <PageRoute
        path={TelemetryRoutePath[PageMap.TELEMETRY_SERVICES_VIEW] || ""}
        element={<TelemetryServiceViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <TelemetryServiceView
                {...props}
                pageRoute={RouteMap[PageMap.TELEMETRY_SERVICES_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServiceViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_LOGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServiceViewLogs
                {...props}
                pageRoute={
                  RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_LOGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_TRACE,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServiceViewTrace
                {...props}
                pageRoute={
                  RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_TRACE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_TRACES,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServiceViewTraces
                {...props}
                pageRoute={
                  RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_TRACES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_METRIC,
            2,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServiceViewMetric
                {...props}
                pageRoute={
                  RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_METRIC] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_METRICS,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServiceViewMetrics
                {...props}
                pageRoute={
                  RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_METRICS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServicesViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.TELEMETRY_SERVICES_VIEW_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.TELEMETRY_SERVICES_VIEW_DOCUMENTATION,
          )}
          element={
            <Suspense fallback={Loader}>
              <TelemetryServicesViewDocumentation
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.TELEMETRY_SERVICES_VIEW_DOCUMENTATION
                  ] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default TelemetryRoutes;
