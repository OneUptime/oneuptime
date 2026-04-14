import ComponentProps from "../Pages/PageComponentProps";
import TracesLayout from "../Pages/Traces/Layout";
import TracesViewLayout from "../Pages/Traces/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, TracesRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import TracesPage from "../Pages/Traces/Index";
import TracesListPage from "../Pages/Traces/List";
import TracesDocumentationPage from "../Pages/Traces/Documentation";

import TraceViewPage from "../Pages/Traces/View/Index";

const TracesRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<TracesLayout {...props} />}>
        <PageRoute
          index
          element={
            <TracesPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACES] as Route}
            />
          }
        />
        <PageRoute
          path={TracesRoutePath[PageMap.TRACES_INSIGHTS] || ""}
          element={
            <TracesListPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACES_INSIGHTS] as Route}
            />
          }
        />
        <PageRoute
          path={TracesRoutePath[PageMap.TRACES_DOCUMENTATION] || ""}
          element={
            <TracesDocumentationPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACES_DOCUMENTATION] as Route}
            />
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
            <TraceViewPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACE_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.TRACE_VIEW)}
          element={
            <TraceViewPage
              {...props}
              pageRoute={RouteMap[PageMap.TRACE_VIEW] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default TracesRoutes;
