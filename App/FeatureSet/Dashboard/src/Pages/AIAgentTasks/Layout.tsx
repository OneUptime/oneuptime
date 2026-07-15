import React, { FunctionComponent, ReactElement } from "react";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import { RouteUtil } from "../../Utils/RouteMap";
import { Outlet } from "react-router-dom";
import { getAIAgentTasksBreadcrumbs } from "../../Utils/Breadcrumbs";

/*
 * No side menu: this route has a single page, so a menu here would be one
 * item linking to the page you are already on. The sibling AI pages (Llm,
 * Traces, Metrics) drop it for the same reason and give the table the width.
 */
const AIAgentTasksLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page title={"AI Tasks"} breadcrumbLinks={getAIAgentTasksBreadcrumbs(path)}>
      <Outlet />
    </Page>
  );
};

export default AIAgentTasksLayout;
