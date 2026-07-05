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

import AIAgentTaskViewDelete from "../Pages/AIAgentTasks/View/Delete";

import AIAgentTaskViewLogs from "../Pages/AIAgentTasks/View/Logs";

import AIAgentTaskViewPullRequests from "../Pages/AIAgentTasks/View/PullRequests";

import McpServer from "../Pages/AIAgentTasks/McpServer";

import Agents from "../Pages/AIAgentTasks/Agents";

import AgentView from "../Pages/AIAgentTasks/AgentView";

import LlmProviders from "../Pages/AIAgentTasks/LlmProviders";

import LlmProviderView from "../Pages/AIAgentTasks/LlmProviderView";

import AICredits from "../Pages/AIAgentTasks/AICredits";

import AILogs from "../Pages/AIAgentTasks/AILogs";

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
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENTS_MCP_SERVER] || ""}
          element={
            <McpServer
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENTS_MCP_SERVER] as Route}
            />
          }
        />
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENTS_AGENTS] || ""}
          element={
            <Agents
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENTS_AGENTS] as Route}
            />
          }
        />
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENTS_AGENT_VIEW] || ""}
          element={
            <AgentView
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENTS_AGENT_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENTS_LLM_PROVIDERS] || ""}
          element={
            <LlmProviders
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENTS_LLM_PROVIDERS] as Route}
            />
          }
        />
        <PageRoute
          path={
            AIAgentTasksRoutePath[PageMap.AI_AGENTS_LLM_PROVIDER_VIEW] || ""
          }
          element={
            <LlmProviderView
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENTS_LLM_PROVIDER_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENTS_AI_CREDITS] || ""}
          element={
            <AICredits
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENTS_AI_CREDITS] as Route}
            />
          }
        />
        <PageRoute
          path={AIAgentTasksRoutePath[PageMap.AI_AGENTS_AI_LOGS] || ""}
          element={
            <AILogs
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENTS_AI_LOGS] as Route}
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
          path={RouteUtil.getLastPathForKey(PageMap.AI_AGENT_TASK_VIEW_LOGS)}
          element={
            <AIAgentTaskViewLogs
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENT_TASK_VIEW_LOGS] as Route}
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
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.AI_AGENT_TASK_VIEW_DELETE)}
          element={
            <AIAgentTaskViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.AI_AGENT_TASK_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default AIAgentTasksRoutes;
