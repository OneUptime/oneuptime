import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import ExceptionsLayout from "../Pages/Exceptions/Layout";
import ExceptionViewLayout from "../Pages/Exceptions/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { ExceptionsRoutePath } from "../Utils/RouteMap";
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
const ExceptionsUnresolved: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Exceptions/Unresolved");
});

const ExceptionsResolved: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Exceptions/Resolved");
});

const ExceptionsArchived: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/Exceptions/Archived");
});

const ExceptionView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/Exceptions/View/Index");
  });

const ExceptionsRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<ExceptionsLayout {...props} />}>
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <ExceptionsUnresolved
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_UNRESOLVED] || ""}
          element={
            <Suspense fallback={Loader}>
              <ExceptionsUnresolved
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_RESOLVED] || ""}
          element={
            <Suspense fallback={Loader}>
              <ExceptionsResolved
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_RESOLVED] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={ExceptionsRoutePath[PageMap.EXCEPTIONS_ARCHIVED] || ""}
          element={
            <Suspense fallback={Loader}>
              <ExceptionsArchived
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_ARCHIVED] as Route}
              />
            </Suspense>
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
            <Suspense fallback={Loader}>
              <ExceptionView
                {...props}
                pageRoute={RouteMap[PageMap.EXCEPTIONS_VIEW] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default ExceptionsRoutes;
