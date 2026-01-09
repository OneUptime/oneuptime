import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import StatusPageViewLayout from "../Pages/Service/View/Layout";
import ServiceLayout from "../Pages/Service/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  ServiceRoutePath,
} from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
const Services: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Service/Services");
  });
const ServiceDependencyGraph: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/DependencyGraph");
});
const ServiceView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Index");
});

const ServiceViewMonitors: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Monitors");
});

const ServiceViewIncidents: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Incidents");
});

const ServiceViewAlerts: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Alerts");
});

const ServiceViewTelemetryServices: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/TelemetryServices");
});

const ServiceViewLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Logs");
});

const ServiceViewTraces: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Traces");
});

const ServiceViewMetrics: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Metrics");
});

const ServiceViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Delete");
});

const ServiceViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Settings");
});

const ServiceViewOwners: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Owners");
});

const ServiceViewDependencies: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/Dependencies");
});

const ServiceViewCodeRepositories: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Service/View/CodeRepositories");
});

const ServiceRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ServiceLayout {...props} />}>
        <PageRoute
          path={ServiceRoutePath[PageMap.SERVICES] || ""}
          element={
            <Suspense fallback={Loader}>
              <Services
                {...props}
                pageRoute={RouteMap[PageMap.SERVICES] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_DEPENDENCY_GRAPH,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceDependencyGraph
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_DEPENDENCY_GRAPH] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={ServiceRoutePath[PageMap.SERVICE_VIEW] || ""}
        element={<StatusPageViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <ServiceView
                {...props}
                pageRoute={RouteMap[PageMap.SERVICE_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_MONITORS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewMonitors
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_MONITORS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_ALERTS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewAlerts
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_ALERTS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_INCIDENTS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewIncidents
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_INCIDENTS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_TELEMETRY_SERVICES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewTelemetryServices
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SERVICE_VIEW_TELEMETRY_SERVICES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_VIEW_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewLogs
                {...props}
                pageRoute={RouteMap[PageMap.SERVICE_VIEW_LOGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_TRACES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewTraces
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_METRICS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewMetrics
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_METRICS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_OWNERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewOwners
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_OWNERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_DEPENDENCIES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewDependencies
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_VIEW_DEPENDENCIES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_VIEW_CODE_REPOSITORIES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceViewCodeRepositories
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SERVICE_VIEW_CODE_REPOSITORIES
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

export default ServiceRoutes;
