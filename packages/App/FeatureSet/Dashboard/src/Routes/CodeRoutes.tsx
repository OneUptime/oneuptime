import ComponentProps from "../Pages/PageComponentProps";
import CodeLayout from "../Pages/Code/Layout";
import CodeRepositoryLayout from "../Pages/Code/Repository/Layout";
import CodeTaskLayout from "../Pages/Code/Task/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, { RouteUtil, CodeRoutePath } from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";
import CodeRepositoryModel from "Common/Models/DatabaseModels/CodeRepository";
import { getDeveloperDocsRoutes } from "../Components/DeveloperDocs/DeveloperDocsRoutes";
import { DeveloperDocsScope } from "../Components/DeveloperDocs/DeveloperDocsPages";

// Pages
import CodePage from "../Pages/Code/Code";
import CodeRepositoriesPage from "../Pages/Code/Repositories";
import CodeRepositoryTasks from "../Pages/Code/Repository/Tasks";
import CodeRepositorySettings from "../Pages/Code/Repository/Settings";
import CodeRepositoryProductionReviews from "../Pages/Code/Repository/ProductionReviews";
import CodeRepositoryDelete from "../Pages/Code/Repository/Delete";
import CodeTaskConversation from "../Pages/Code/Task/Conversation";
import CodeTaskLog from "../Pages/Code/Task/Log";

/*
 * Code, under /code: the request box and every task (the mount itself) and
 * the connected repositories (repositories), with their Developer pages; a
 * repository's pages (repositories/:id - its request box and tasks, its
 * pull requests' production reviews, its settings, removing it); and a
 * task's (tasks/:id - its conversation and its log).
 */
const CodeRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<CodeLayout {...props} />}>
        <PageRoute
          index
          element={
            <CodePage {...props} pageRoute={RouteMap[PageMap.CODE] as Route} />
          }
        />

        <PageRoute
          path={CodeRoutePath[PageMap.CODE_REPOSITORIES] || ""}
          element={
            <CodeRepositoriesPage
              {...props}
              pageRoute={RouteMap[PageMap.CODE_REPOSITORIES] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: CodeRepositoryModel,
          scope: DeveloperDocsScope.List,
          props,
          mountPageKey: PageMap.CODE_ROOT,
        })}
      </PageRoute>

      <PageRoute
        path={CodeRoutePath[PageMap.CODE_REPOSITORY_VIEW] || ""}
        element={<CodeRepositoryLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <CodeRepositoryTasks
              {...props}
              pageRoute={RouteMap[PageMap.CODE_REPOSITORY_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_SETTINGS,
          )}
          element={
            <CodeRepositorySettings
              {...props}
              pageRoute={
                RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS,
          )}
          element={
            <CodeRepositoryProductionReviews
              {...props}
              pageRoute={
                RouteMap[
                  PageMap.CODE_REPOSITORY_VIEW_PRODUCTION_REVIEWS
                ] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_DELETE,
          )}
          element={
            <CodeRepositoryDelete
              {...props}
              pageRoute={RouteMap[PageMap.CODE_REPOSITORY_VIEW_DELETE] as Route}
            />
          }
        />

        {getDeveloperDocsRoutes({
          modelType: CodeRepositoryModel,
          scope: DeveloperDocsScope.View,
          props,
        })}
      </PageRoute>

      <PageRoute
        path={CodeRoutePath[PageMap.CODE_TASK_VIEW] || ""}
        element={<CodeTaskLayout {...props} />}
      >
        <PageRoute
          index
          element={
            <CodeTaskConversation
              {...props}
              pageRoute={RouteMap[PageMap.CODE_TASK_VIEW] as Route}
            />
          }
        />
        <PageRoute
          path={RouteUtil.getLastPathForKey(PageMap.CODE_TASK_VIEW_LOG)}
          element={
            <CodeTaskLog
              {...props}
              pageRoute={RouteMap[PageMap.CODE_TASK_VIEW_LOG] as Route}
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default CodeRoutes;
