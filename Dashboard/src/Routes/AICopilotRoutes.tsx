import Loader from "../Components/Loader/Loader";
import CodeRepositoryViewLayout from "../Pages/AICopilot/CodeRepository/View/Layout";
import ComponentProps from "../Pages/PageComponentProps";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  CodeRepositoryRoutePath,
  RouteUtil,
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
const AiCopilot: LazyExoticComponent<FunctionComponent<ComponentProps>> = lazy(
  () => {
    return import("../Pages/AICopilot/Index");
  },
);

const CodeRepositoryView: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/Index");
});

const CodeRepositoryViewActionsInQueue: LazyExoticComponent<

  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/InQueue");
});

const CodeRepositoryViewProcessed: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/Processed");
});

const CodeRepositoryViewDocumentation: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/Documentation");
});

const CodeRepositoryViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/Delete");
});

const CodeRepositoryViewSettings: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/Settings");
});

const CodeRepositoryViewPriorities: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/Actions");
});

const CodeRepositoryViewServices: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AICopilot/CodeRepository/View/Services");
});

const CodeRepositoryRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute
        path={CodeRepositoryRoutePath[PageMap.RELIABILITY_COPILOT] || ""}
        element={
          <Suspense fallback={Loader}>
            <AiCopilot
              {...props}
              pageRoute={RouteMap[PageMap.RELIABILITY_COPILOT] as Route}
            />
          </Suspense>
        }
      />

      <PageRoute
        path={
          CodeRepositoryRoutePath[PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW] || ""
        }
        element={<CodeRepositoryViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryView
                {...props}
                pageRoute={
                  RouteMap[PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTIONS_IN_QUEUE,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewActionsInQueue
                {...props}
                pageRoute={
                  RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTIONS_IN_QUEUE
                  ] as Route
                }
              />
            </Suspense>
          }
        />

<PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTIONS_PROCESSED,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewProcessed
                {...props}
                pageRoute={
                  RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTIONS_PROCESSED
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_DOCUMENTATION,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewDocumentation
                {...props}
                pageRoute={
                  RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_DOCUMENTATION
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_DELETE,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewDelete
                {...props}
                pageRoute={
                  RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_DELETE
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_SETTINGS,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewSettings
                {...props}
                pageRoute={
                  RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_SETTINGS
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTION_TYPES,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewPriorities
                {...props}
                pageRoute={
                  RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_ACTION_TYPES
                  ] as Route
                }
              />
            </Suspense>
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_SERVICES,
          )}
          element={
            <Suspense fallback={Loader}>
              <CodeRepositoryViewServices
                {...props}
                pageRoute={
                  RouteMap[
                  PageMap.AI_COPILOT_CODE_REPOSITORY_VIEW_SERVICES
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

export default CodeRepositoryRoutes;
