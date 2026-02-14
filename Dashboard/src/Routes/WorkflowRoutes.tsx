import ComponentProps from "../Pages/PageComponentProps";
import WorkflowsLayout from "../Pages/Workflow/Layout";
import WorkflowViewLayout from "../Pages/Workflow/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, WorkflowRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import Workflows from "../Pages/Workflow/Workflows";
import WorkflowsVariables from "../Pages/Workflow/Variable";
import WorkflowsLogs from "../Pages/Workflow/Logs";
import WorkflowLogs from "../Pages/Workflow/View/Logs";
import WorkflowDelete from "../Pages/Workflow/View/Delete";
import WorkflowBuilder from "../Pages/Workflow/View/Builder";
import WorkflowOverview from "../Pages/Workflow/View/Index";
import WorkflowVariables from "../Pages/Workflow/View/Variable";
import WorkflowSettings from "../Pages/Workflow/View/Settings";

const WorkflowRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<WorkflowsLayout {...props} />}>
        <PageRoute
          index
          element={
            <Workflows
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOWS] as Route}
              />
          }
        />

        <PageRoute
          path={WorkflowRoutePath[PageMap.WORKFLOWS_VARIABLES] || ""}
          element={
            <WorkflowsVariables
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOWS_VARIABLES] as Route}
              />
          }
        />

        <PageRoute
          path={WorkflowRoutePath[PageMap.WORKFLOWS_LOGS] || ""}
          element={
            <WorkflowsLogs
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOWS_LOGS] as Route}
              />
          }
        />
      </PageRoute>

      <PageRoute
        path={WorkflowRoutePath[PageMap.WORKFLOW_VIEW] || ""}
        element={<WorkflowViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <WorkflowOverview
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOW_VIEW] as Route}
              />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_VIEW_SETTINGS)}
          element={
            <WorkflowSettings
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOW_VIEW_SETTINGS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_VARIABLES)}
          element={
            <WorkflowVariables
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOW_VARIABLES] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_BUILDER)}
          element={
            <WorkflowBuilder
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOW_BUILDER] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_LOGS)}
          element={
            <WorkflowLogs
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOW_LOGS] as Route}
              />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.WORKFLOW_DELETE)}
          element={
            <WorkflowDelete
                {...props}
                pageRoute={RouteMap[PageMap.WORKFLOW_DELETE] as Route}
              />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default WorkflowRoutes;
