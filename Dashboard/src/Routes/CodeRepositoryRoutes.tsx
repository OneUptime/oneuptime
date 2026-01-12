import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import CodeRepositoryViewLayout from "../Pages/CodeRepository/View/Layout";
import CodeRepositoryLayout from "../Pages/CodeRepository/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  CodeRepositoryRoutePath,
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
const CodeRepository: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/CodeRepository/CodeRepository");
  });

const CodeRepositoryView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/CodeRepository/View/Index");
});

const CodeRepositoryViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/CodeRepository/View/Delete");
});

const CodeRepositoryViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/CodeRepository/View/Settings");
});

const CodeRepositoryViewServices: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/CodeRepository/View/Services");
});

const CodeRepositoryRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<CodeRepositoryLayout {...props} />}>
        <PageRoute
          path={CodeRepositoryRoutePath[PageMap.CODE_REPOSITORY] || ""}
          element={
            <Suspense fallback={Loader}>
              <CodeRepository
                {...props}
                pageRoute={RouteMap[PageMap.CODE_REPOSITORY] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={CodeRepositoryRoutePath[PageMap.CODE_REPOSITORY_VIEW] || ""}
        element={<CodeRepositoryViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryView
                {...props}
                pageRoute={RouteMap[PageMap.CODE_REPOSITORY_VIEW] as Route}
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewDelete
                {...props}
                pageRoute={
                  RouteMap[PageMap.CODE_REPOSITORY_VIEW_DELETE] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewSettings
                {...props}
                pageRoute={
                  RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_SERVICES,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewServices
                {...props}
                pageRoute={
                  RouteMap[PageMap.CODE_REPOSITORY_VIEW_SERVICES] as Route
                }
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default CodeRepositoryRoutes;
