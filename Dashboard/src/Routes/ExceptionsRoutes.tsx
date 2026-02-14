import ComponentProps from "../Pages/PageComponentProps";
import ExceptionsLayout from "../Pages/Exceptions/Layout";
import ExceptionViewLayout from "../Pages/Exceptions/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { ExceptionsRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import ExceptionsUnresolved from "../Pages/Exceptions/Unresolved";

import ExceptionsResolved from "../Pages/Exceptions/Resolved";

import ExceptionsArchived from "../Pages/Exceptions/Archived";

import ExceptionView from "../Pages/Exceptions/View/Index";

const ExceptionsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ExceptionsLayout {...props} />}>
        <PageRoute
          index
          element={
            <ExceptionsUnresolved
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS] as Route}
              />
          }
        />

        <PageRoute
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_UNRESOLVED] || ""}
          element={
            <ExceptionsUnresolved
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route}
              />
          }
        />

        <PageRoute
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_RESOLVED] || ""}
          element={
            <ExceptionsResolved
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route}
              />
          }
        />

        <PageRoute
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_ARCHIVED] || ""}
          element={
            <ExceptionsArchived
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route}
              />
          }
        />
      </PageRoute>

      {/* Exception View - separate from main layout */}
      <PageRoute
        path={ExceptionsRoutePath[PageMap.EXCEPTIONS_VIEW] || ""}
        element={<ExceptionViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <ExceptionView
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW] as Route}
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ExceptionsRoutes;
