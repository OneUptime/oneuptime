import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import TracesLayout from "../Pages/Traces/Layout";
import TracesViewLayout from "../Pages/Traces/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, TracesRoutePath } from "../Utils/RouteMap";
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
const TracesPage: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/Traces/Index");
  },
);

const TraceViewPage: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Traces/View/Index");
  });

const TracesRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<TracesLayout {...props} />}>
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <TracesPage
                {...props}
                pageRoute={RouteMap[PageMap.TRACES] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      {/* Trace View */}
      <PageRoute
        path={TracesRoutePath[PageMap.TRACE_VIEW] || ""}
        element={<TracesViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <TraceViewPage
                {...props}
                pageRoute={RouteMap[PageMap.TRACE_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TRACE_VIEW)}
          element={
            <Suspense fallback={Loader}>
              <TraceViewPage
                {...props}
                pageRoute={RouteMap[PageMap.TRACE_VIEW] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default TracesRoutes;
