import PageComponentProps from "../../Pages/PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import DeveloperDocsPage from "./DeveloperDocsPage";
import {
  DEVELOPER_DOCS_PAGES,
  DeveloperDocsPageDefinition,
  DeveloperDocsParentPage,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
  getDeveloperDocsParentPage,
  getDeveloperDocsRelativePath,
} from "./DeveloperDocsPages";
import {
  DeveloperDocsResource,
  getDeveloperDocsResource,
} from "./DeveloperDocsResources";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import React, { ReactElement } from "react";
import { Route as PageRoute } from "react-router-dom";

/*
 * The path of a list page's Developer page inside the route file mounted at
 * `mountPageKey` (a `*_ROOT` route such as `/dashboard/:projectId/on-call-
 * duty/*`): `policies/developer/terraform` for on-call policies, plain
 * `developer/terraform` where the list is the mount itself (workflows).
 */
export function getDeveloperDocsListRoutePath(data: {
  pageKey: string;
  mountPageKey: PageMap;
}): string {
  const fullPath: string = RouteMap[data.pageKey]?.toString() || "";
  const mountPath: string = (RouteMap[data.mountPageKey]?.toString() || "")
    .replace(/\/\*$/, "")
    .replace(/\/+$/, "");

  if (!mountPath || !fullPath.startsWith(`${mountPath}/`)) {
    throw new Error(
      `${data.pageKey} (${fullPath}) is not under ${data.mountPageKey} (${mountPath}).`,
    );
  }

  return fullPath.slice(mountPath.length + 1);
}

/*
 * The routes of a resource's Developer pages, for its route file: put
 *
 *   {getDeveloperDocsRoutes({ modelType: Workflow, scope: DeveloperDocsScope.View, props })}
 *
 * among the children of the view layout route, and
 *
 *   {getDeveloperDocsRoutes({ modelType: Workflow, scope: DeveloperDocsScope.List, props, mountPageKey: PageMap.WORKFLOWS_ROOT })}
 *
 * among the routes the list menu's layout shows. A view page's paths are
 * relative to the view layout (`developer/terraform`); a list page's to the
 * route file's mount (`mountPageKey`). Either way the layout's side menu and
 * breadcrumbs stay on screen.
 *
 * A function returning the <Route> elements, not a component: react-router
 * reads its routes from the elements it is given, and only <Route> (or a
 * fragment of them) counts.
 */
export function getDeveloperDocsRoutes(data: {
  // The resource's model, which the route file already imports.
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScope;
  props: PageComponentProps;
  // For a list scope: the `*_ROOT` page the route file is mounted at.
  mountPageKey?: PageMap | undefined;
}): Array<ReactElement> {
  const resource: DeveloperDocsResource = getDeveloperDocsResource(
    data.modelType,
  );
  const tableName: string = new data.modelType().tableName || "";
  const parent: DeveloperDocsParentPage | undefined =
    getDeveloperDocsParentPage(tableName, data.scope);

  if (!parent) {
    throw new Error(
      `${tableName} has no ${data.scope} page with Developer pages: add it to DEVELOPER_DOCS_PARENT_PAGES.`,
    );
  }

  return DEVELOPER_DOCS_PAGES.map(
    (page: DeveloperDocsPageDefinition): ReactElement => {
      const key: string = getDeveloperDocsPageKey(parent.pageKey, page.type);
      let path: string = getDeveloperDocsRelativePath(page.type);

      if (data.scope === DeveloperDocsScope.List) {
        if (!data.mountPageKey) {
          throw new Error(
            `The Developer pages of the ${tableName} list need the mountPageKey of their route file.`,
          );
        }

        path = getDeveloperDocsListRoutePath({
          pageKey: key,
          mountPageKey: data.mountPageKey,
        });
      }

      return (
        <PageRoute
          key={key}
          path={path}
          element={
            <DeveloperDocsPage
              {...data.props}
              pageRoute={RouteMap[key] as Route}
              resource={resource}
              scope={data.scope}
              page={page.type}
            />
          }
        />
      );
    },
  );
}
