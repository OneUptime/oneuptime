import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import StatusPageViewLayout from "../Pages/ServiceCatalog/View/Layout";
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
const ServiceCatalogView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/ServiceCatalog/View/Index");
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

const ServiceCatalogRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
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
      </PageRoute>
    </Routes>
  );
};

export default ServiceCatalogRoutes;
