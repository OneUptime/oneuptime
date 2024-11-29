import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import DashboardViewLayout from "../Pages/Dashboards/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { DashboardsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, {
  FunctionComponent,
  LazyExoticComponent,
  ReactElement,
  Suspense,
  lazy,
} from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

const Dashboards: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/Dashboards/Dashboards");
  },
);

const DashboardView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Dashboards/View/Index");
  });

const DashboardViewOverview: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Dashboards/View/Overview");
});

const DashboardViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Dashboards/View/Delete");
});

const DashboardViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Dashboards/View/Settings");
});

const DashboardsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path={DashboardsRoutePath[PageMap.DASHBOARDS] || ""}
        element={
          <Suspense fallback={Loader}>
            <Dashboards
              {...props}
              pageRoute={RouteMap[PageMap.DASHBOARDS] as Route}
            />
          </Suspense>
        }
      />

      <PageRoute
        path={DashboardsRoutePath[PageMap.DASHBOARD_VIEW] || ""}
        element={<DashboardViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <DashboardView
                {...props}
                pageRoute={RouteMap[PageMap.DASHBOARD_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_OVERVIEW)}
          element={
            <Suspense fallback={Loader}>
              <DashboardViewOverview
                {...props}
                pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_OVERVIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <DashboardViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_DELETE] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.DASHBOARD_VIEW_SETTINGS)}
          element={
            <Suspense fallback={Loader}>
              <DashboardViewSettings
                {...props}
                pageRoute={RouteMap[PageMap.DASHBOARD_VIEW_SETTINGS] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default DashboardsRoutes;
