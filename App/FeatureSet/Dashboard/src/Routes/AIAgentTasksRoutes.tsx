import ComponentProps from "../Pages/PageComponentProps";
import AIAgentTasksLayout from "../Pages/AIAgentTasks/Layout";
import AIAgentTaskViewLayout from "../Pages/AIAgentTasks/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, AIAgentTasksRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import AIAgentTasks from "../Pages/AIAgentTasks/AIAgentTasks";

import AIAgentTaskView from "../Pages/AIAgentTasks/View/Index";

import AIAgentTaskViewPullRequests from "../Pages/AIAgentTasks/View/PullRequests";

/*
 * Task detail routes point at CodeFix AIRun ids. The legacy Logs and Delete
 * routes are gone: new runs record AIRunEvents (shown on the Overview) and
 * are not user-deletable.
 */
const AIAgentTasksRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<AIAgentTasksLayout {...props} />}>
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENT_TASKS] || ""}
          element={
            <AIAgentTasks
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENT_TASKS] as Route}
            />
          }
        />
        <PageRoute
          index
          element={
            <AIAgentTasks
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENT_TASKS] as Route}
            />
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
            <AIAgentTaskView
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS,
          )}
          element={
            <AIAgentTaskViewPullRequests
              {...props}
              pageRoute={
                RouteMap[PageMap.AI_AGENT_TASK_VIEW_PULL_REQUESTS] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AIAgentTasksRoutes;
