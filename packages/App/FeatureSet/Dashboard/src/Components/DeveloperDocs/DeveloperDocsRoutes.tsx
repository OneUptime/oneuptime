import PageComponentProps from "../../Pages/PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap from "../../Utils/RouteMap";
import DeveloperDocsPage from "./DeveloperDocsPage";
import {
  DEVELOPER_DOCS_PAGES,
  DeveloperDocsPageDefinition,
  DeveloperDocsResource,
  DeveloperDocsScope,
  getDeveloperDocsPageKey,
  getDeveloperDocsParentPageKey,
  getDeveloperDocsRelativePath,
  getDeveloperDocsResource,
} from "./DeveloperDocsResources";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import React, { ReactElement } from "react";
import { Route as PageRoute } from "react-router-dom";

/*
 * The routes of a resource's Developer pages, for its route file: put
 *
 *   {getDeveloperDocsRoutes({ modelType: Workflow, scope: DeveloperDocsScope.View, props })}
 *
 * among the children of the layout route the menu belongs to (the view
 * layout for a view menu, the list layout for a list menu). The paths are
 * relative to that layout (`developer/terraform`), so the layout's side menu
 * and breadcrumbs stay on screen.
 *
 * A function returning the <Route> elements, not a component: react-router
 * reads its routes from the elements it is given, and only <Route> (or a
 * fragment of them) counts.
 */
export function getDeveloperDocsRoutes(data: {
  modelType: DatabaseBaseModelType;
  scope: DeveloperDocsScope;
  props: PageComponentProps;
}): Array<ReactElement> {
  const resource: DeveloperDocsResource = getDeveloperDocsResource(
    data.modelType,
  );
  const parentPageKey: PageMap | undefined = getDeveloperDocsParentPageKey(
    resource,
    data.scope,
  );

  if (!parentPageKey) {
    throw new Error(
      `${data.modelType.name} has no ${data.scope} page with Developer pages: set it in DEVELOPER_DOCS_RESOURCES.`,
    );
  }

  return DEVELOPER_DOCS_PAGES.map(
    (page: DeveloperDocsPageDefinition): ReactElement => {
      const key: string = getDeveloperDocsPageKey(parentPageKey, page.type);

      return (
        <PageRoute
          key={key}
          path={getDeveloperDocsRelativePath(page.type)}
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
