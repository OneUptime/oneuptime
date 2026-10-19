import { getCodeBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import CodeSideMenu from "../../Components/Code/CodeSideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

/*
 * Code's first page and the Developer pages beside it: the repositories,
 * under one page title that says what Code is for.
 */
const CodeLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Code"
      description="Ask OneUptime AI to work in your repositories - fix bugs, write tests, answer questions - and review what it opens."
      sideMenu={<CodeSideMenu />}
      breadcrumbLinks={getCodeBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default CodeLayout;
