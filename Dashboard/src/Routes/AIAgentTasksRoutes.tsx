import Loader from "../Components/Loader/Loader";
import ComponentProps from "../Pages/PageComponentProps";
import AIAgentTasksLayout from "../Pages/AIAgentTasks/Layout";
import AIAgentTaskViewLayout from "../Pages/AIAgentTasks/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, AIAgentTasksRoutePath } from "../Utils/RouteMap";
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
const AIAgentTasks: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/AIAgentTasks/AIAgentTasks");
  });

const AIAgentTasksScheduled: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AIAgentTasks/Scheduled");
});

const AIAgentTasksInProgress: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AIAgentTasks/InProgress");
});

const AIAgentTasksCompleted: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AIAgentTasks/Completed");
});

const AIAgentTaskView: LazyExoticComponent<FunctionComponent<ComponentProps>> =
  lazy(() => {
    return import("../Pages/AIAgentTasks/View/Index");
  });

const AIAgentTaskViewDelete: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AIAgentTasks/View/Delete");
});

const AIAgentTaskViewLogs: LazyExoticComponent<
  FunctionComponent<ComponentProps>
> = lazy(() => {
  return import("../Pages/AIAgentTasks/View/Logs");
});

const AIAgentTasksRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<AIAgentTasksLayout {...props} />}>
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENT_TASKS] || ""}
          element={
            <Suspense fallback={Loader}>
              <AIAgentTasks
                {...props}
                pageRoute={RouteMap[PageMap.AI_AGENT_TASKS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <AIAgentTasks
                {...props}
                pageRoute={RouteMap[PageMap.AI_AGENT_TASKS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.AI_AGENT_TASKS_SCHEDULED)}
          element={
            <Suspense fallback={Loader}>
              <AIAgentTasksScheduled
                {...props}
                pageRoute={RouteMap[PageMap.AI_AGENT_TASKS_SCHEDULED] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.AI_AGENT_TASKS_IN_PROGRESS)}
          element={
            <Suspense fallback={Loader}>
              <AIAgentTasksInProgress
                {...props}
                pageRoute={
                  RouteMap[PageMap.AI_AGENT_TASKS_IN_PROGRESS] as Route
                }
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.AI_AGENT_TASKS_COMPLETED)}
          element={
            <Suspense fallback={Loader}>
              <AIAgentTasksCompleted
                {...props}
                pageRoute={RouteMap[PageMap.AI_AGENT_TASKS_COMPLETED] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>

      <PageRoute
        path={AIAgentTasksRoutePath[PageMap.AI_AGENT_TASK_VIEW] || ""}
        element={<AIAgentTaskViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <Suspense fallback={Loader}>
              <AIAgentTaskView
                {...props}
                pageRoute={RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.AI_AGENT_TASK_VIEW_LOGS)}
          element={
            <Suspense fallback={Loader}>
              <AIAgentTaskViewLogs
                {...props}
                pageRoute={RouteMap[PageMap.AI_AGENT_TASK_VIEW_LOGS] as Route}
              />
            </Suspense>
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.AI_AGENT_TASK_VIEW_DELETE)}
          element={
            <Suspense fallback={Loader}>
              <AIAgentTaskViewDelete
                {...props}
                pageRoute={RouteMap[PageMap.AI_AGENT_TASK_VIEW_DELETE] as Route}
              />
            </Suspense>
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AIAgentTasksRoutes;
