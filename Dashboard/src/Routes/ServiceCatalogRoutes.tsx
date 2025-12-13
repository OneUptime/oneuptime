import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import StatusPageViewLayout from "../Pages/ServiceCatalog/View/Layout";
import ServiceCatalogLayout from "../Pages/ServiceCatalog/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  ServiceCatalogRoutePath,
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
const ServiceCatalog: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/ServiceCatalog/ServiceCatalog");
  });
const ServiceCatalogDependencyGraph: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/DependencyGraph");
});
const ServiceCatalogView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Index");
});

const ServiceCatalogViewMonitors: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Monitors");
});

const ServiceCatalogViewIncidents: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Incidents");
});

const ServiceCatalogViewAlerts: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Alerts");
});

const ServiceCatalogViewTelemetryServices: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/TelemetryServices");
});

const ServiceCatalogViewLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Logs");
});

const ServiceCatalogViewTraces: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Traces");
});

const ServiceCatalogViewMetrics: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Metrics");
});

const ServiceCatalogViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Delete");
});

const ServiceCatalogViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Settings");
});

const ServiceCatalogViewOwners: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Owners");
});

const ServiceCatalogViewDependencies: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Dependencies");
});

const ServiceCatalogViewCodeRepositories: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/CodeRepositories");
});

const ServiceCatalogRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ServiceCatalogLayout {...props} />}>
        <PageRoute
          path={ServiceCatalogRoutePath[PageMap.SERVICE_CATALOG] || ""}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalog
                {...props}
                pageRoute={RouteMap[PageMap.SERVICE_CATALOG] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_DEPENDENCY_GRAPH,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogDependencyGraph
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_DEPENDENCY_GRAPH] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={ServiceCatalogRoutePath[PageMap.SERVICE_CATALOG_VIEW] || ""}
        element={<StatusPageViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogView
                {...props}
                pageRoute={RouteMap[PageMap.SERVICE_CATALOG_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_MONITORS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewMonitors
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_MONITORS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_ALERTS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewAlerts
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_ALERTS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_INCIDENTS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewIncidents
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_INCIDENTS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_TELEMETRY_SERVICES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewTelemetryServices
                {...props}
                pageRoute={
                  RouteMap[
                    PageMap.SERVICE_CATALOG_VIEW_TELEMETRY_SERVICES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.SERVICE_CATALOG_VIEW_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewLogs
                {...props}
                pageRoute={RouteMap[PageMap.SERVICE_CATALOG_VIEW_LOGS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_TRACES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewTraces
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_TRACES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_METRICS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewMetrics
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_METRICS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_OWNERS,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewOwners
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_OWNERS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_DEPENDENCIES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewDependencies
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_DEPENDENCIES] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.SERVICE_CATALOG_VIEW_CODE_REPOSITORIES,
          )}
          element={
            <Suspense fallback={Loader}>
              <ServiceCatalogViewCodeRepositories
                {...props}
                pageRoute={
                  RouteMap[PageMap.SERVICE_CATALOG_VIEW_CODE_REPOSITORIES] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ServiceCatalogRoutes;
