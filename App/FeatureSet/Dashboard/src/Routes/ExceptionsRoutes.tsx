import ComponentProps from "../Pages/PageComponentProps";
import ExceptionsLayout from "../Pages/Exceptions/Layout";
import ExceptionViewLayout from "../Pages/Exceptions/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { ExceptionsRoutePath, RouteUtil } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import ExceptionsOverview from "../Pages/Exceptions/Overview";
import ExceptionsUnresolved from "../Pages/Exceptions/Unresolved";
import ExceptionsResolved from "../Pages/Exceptions/Resolved";
import ExceptionsArchived from "../Pages/Exceptions/Archived";
import ExceptionsDocumentationPage from "../Pages/Exceptions/Documentation";
import ExceptionView from "../Pages/Exceptions/View/Index";
import ExceptionDetailSection from "../Components/Exceptions/ExceptionDetailSection";

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
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_OVERVIEW] || ""}
          element={
            <ExceptionsOverview
              {...props}
              pageRoute={RouteMap[PageMap.EXCEPTIONS_OVERVIEW] as Route}
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
        <PageRoute
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_DOCUMENTATION] || ""}
          element={
            <ExceptionsDocumentationPage
              {...props}
              pageRoute={RouteMap[PageMap.EXCEPTIONS_DOCUMENTATION] as Route}
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
              section={ExceptionDetailSection.Overview}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.EXCEPTIONS_VIEW_STACK_TRACE,
          )}
          element={
            <ExceptionView
              {...props}
              pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW_STACK_TRACE] as Route}
              section={ExceptionDetailSection.StackTrace}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.EXCEPTIONS_VIEW_OCCURRENCES,
          )}
          element={
            <ExceptionView
              {...props}
              pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW_OCCURRENCES] as Route}
              section={ExceptionDetailSection.Occurrences}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.EXCEPTIONS_VIEW_CONTEXT)}
          element={
            <ExceptionView
              {...props}
              pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW_CONTEXT] as Route}
              section={ExceptionDetailSection.Context}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.EXCEPTIONS_VIEW_AI_ASSISTANCE,
          )}
          element={
            <ExceptionView
              {...props}
              pageRoute={
                RouteMap[PageMap.EXCEPTIONS_VIEW_AI_ASSISTANCE] as Route
              }
              section={ExceptionDetailSection.AIAssistance}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.EXCEPTIONS_VIEW_SETTINGS)}
          element={
            <ExceptionView
              {...props}
              pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW_SETTINGS] as Route}
              section={ExceptionDetailSection.Settings}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ExceptionsRoutes;
