import { getCodeBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageMap from "../../Utils/PageMap";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import CodeSideMenu from "../../Components/Code/CodeSideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * What each of Code's own pages is titled. Code's first page has no title
 * of its own: it opens on its question - "What should AI do?" - over the
 * request box, as coding agents open. The connected repositories are
 * Repositories; the Developer pages beside them keep Code's title and what
 * Code is for.
 */
export const getCodeLayoutTitle: (path: string) => {
  title?: string | undefined;
  description?: string | undefined;
} = (
  path: string,
): { title?: string | undefined; description?: string | undefined } => {
  if (path === RouteUtil.getRouteString(PageMap.CODE)) {
    return {};
  }

  if (path === RouteUtil.getRouteString(PageMap.CODE_REPOSITORIES)) {
    return {
      title: "Repositories",
      description:
        "The GitHub repositories connected to this project. Open one for its tasks and settings, or connect more.",
    };
  }

  return {
    title: "Code",
    description:
      "Ask OneUptime AI to work in your repositories - fix bugs, write tests, answer questions - and review what it opens.",
  };
};

/*
 * Code's first page, its Repositories and the Developer pages beside them,
 * with Code's side menu: Tasks, Repositories, Developer.
 */
const CodeLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const heading: { title?: string | undefined; description?: string | undefined } =
    getCodeLayoutTitle(path);

  return (
    <Page
      title={heading.title}
      description={heading.description}
      sideMenu={<CodeSideMenu />}
      breadcrumbLinks={getCodeBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default CodeLayout;
