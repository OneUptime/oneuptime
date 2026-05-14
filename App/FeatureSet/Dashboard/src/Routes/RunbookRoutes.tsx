import ComponentProps from "../Pages/PageComponentProps";
import RunbooksLayout from "../Pages/Runbook/Layout";
import RunbookViewLayout from "../Pages/Runbook/View/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, RunbookRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

import Runbooks from "../Pages/Runbook/Runbooks";
import RunbooksExecutions from "../Pages/Runbook/Executions";
import RunbookAgents from "../Pages/Runbook/Agents";
import RunbookOverview from "../Pages/Runbook/View/Index";
import RunbookSteps from "../Pages/Runbook/View/Steps";
import RunbookExecutionsList from "../Pages/Runbook/View/Executions";
import RunbookExecutionView from "../Pages/Runbook/View/ExecutionView";
import RunbookOwners from "../Pages/Runbook/View/Owners";
import RunbookSettings from "../Pages/Runbook/View/Settings";
import RunbookDelete from "../Pages/Runbook/View/Delete";
import RunbookSettingsOwnerRules from "../Pages/Runbook/Settings/OwnerRules";
import RunbookSettingsLabelRules from "../Pages/Runbook/Settings/LabelRules";

const RunbookRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<RunbooksLayout {...props} />}>
        <PageRoute
          index
          element={
            <Runbooks
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOKS] as Route}
            />
          }
        />
        <PageRoute
          path={RunbookRoutePath[PageMap.RUNBOOKS_EXECUTIONS] || ""}
          element={
            <RunbooksExecutions
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOKS_EXECUTIONS] as Route}
            />
          }
        />
        <PageRoute
          path={RunbookRoutePath[PageMap.RUNBOOKS_AGENTS] || ""}
          element={
            <RunbookAgents
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOKS_AGENTS] as Route}
            />
          }
        />
        <PageRoute
          path={RunbookRoutePath[PageMap.RUNBOOKS_SETTINGS_OWNER_RULES] || ""}
          element={
            <RunbookSettingsOwnerRules
              {...props}
              pageRoute={
                RouteMap[PageMap.RUNBOOKS_SETTINGS_OWNER_RULES] as Route
              }
            />
          }
        />
        <PageRoute
          path={RunbookRoutePath[PageMap.RUNBOOKS_SETTINGS_LABEL_RULES] || ""}
          element={
            <RunbookSettingsLabelRules
              {...props}
              pageRoute={
                RouteMap[PageMap.RUNBOOKS_SETTINGS_LABEL_RULES] as Route
              }
            />
          }
        />
      </PageRoute>

      <PageRoute
        path={RunbookRoutePath[PageMap.RUNBOOK_VIEW] || ""}
        element={<RunbookViewLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <RunbookOverview
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUNBOOK_VIEW_STEPS)}
          element={
            <RunbookSteps
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_STEPS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUNBOOK_VIEW_EXECUTIONS)}
          element={
            <RunbookExecutionsList
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_EXECUTIONS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUNBOOK_VIEW_EXECUTION, 2)}
          element={
            <RunbookExecutionView
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUNBOOK_VIEW_OWNERS)}
          element={
            <RunbookOwners
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_OWNERS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUNBOOK_VIEW_SETTINGS)}
          element={
            <RunbookSettings
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_SETTINGS] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.RUNBOOK_VIEW_DELETE)}
          element={
            <RunbookDelete
              {...props}
              pageRoute={RouteMap[PageMap.RUNBOOK_VIEW_DELETE] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default RunbookRoutes;
