import ComponentProps from "../Pages/PageComponentProps";
import CodeRepositoryViewLayout from "../Pages/CodeRepository/View/Layout";
import CodeRepositoryLayout from "../Pages/CodeRepository/Layout";
import PageMap from "../Utils/PageMap";
import RouteMap, {
  RouteUtil,
  CodeRepositoryRoutePath,
} from "../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import React, { FunctionComponent, ReactElement } from "react";
import { Route as PageRoute, Routes } from "react-router-dom";

// Pages
import CodeRepository from "../Pages/CodeRepository/CodeRepository";

import CodeRepositoryView from "../Pages/CodeRepository/View/Index";

import CodeRepositoryViewDelete from "../Pages/CodeRepository/View/Delete";

import CodeRepositoryViewSettings from "../Pages/CodeRepository/View/Settings";

import CodeRepositoryViewServices from "../Pages/CodeRepository/View/Services";

const CodeRepositoryRoutes: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Routes>
      <PageRoute path="/" element={<CodeRepositoryLayout {...props} />}>
        <PageRoute
          path={CodeRepositoryRoutePath[PageMap.CODE_REPOSITORY] || ""}
          element={
            <CodeRepository
              {...props}
              pageRoute={RouteMap[PageMap.CODE_REPOSITORY] as Route}
            />
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
            <CodeRepositoryView
              {...props}
              pageRoute={RouteMap[PageMap.CODE_REPOSITORY_VIEW] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_DELETE,
          )}
          element={
            <CodeRepositoryViewDelete
              {...props}
              pageRoute={RouteMap[PageMap.CODE_REPOSITORY_VIEW_DELETE] as Route}
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_SETTINGS,
          )}
          element={
            <CodeRepositoryViewSettings
              {...props}
              pageRoute={
                RouteMap[PageMap.CODE_REPOSITORY_VIEW_SETTINGS] as Route
              }
            />
          }
        />

        <PageRoute
          path={RouteUtil.getLastPathForKey(
            PageMap.CODE_REPOSITORY_VIEW_SERVICES,
          )}
          element={
            <CodeRepositoryViewServices
              {...props}
              pageRoute={
                RouteMap[PageMap.CODE_REPOSITORY_VIEW_SERVICES] as Route
              }
            />
          }
        />
      </PageRoute>
    </Routes>
  );
};

export default CodeRepositoryRoutes;
