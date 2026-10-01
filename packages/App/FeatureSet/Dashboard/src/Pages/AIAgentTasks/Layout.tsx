import React, { FunctionComponent, ReactElement } from "react";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import { RouteUtil } from "../../Utils/RouteMap";
import { Outlet } from "react-router-dom";
import { getAIAgentTasksBreadcrumbs } from "../../Utils/Breadcrumbs";
import CodeSideMenu from "../../Components/Code/CodeSideMenu";

/*
 * The Code product's side menu: Tasks shares it with Code Repositories, the
 * repositories its tasks open pull requests in. See CodeSideMenu.
 */
const AIAgentTasksLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title={"AI Tasks"}
      sideMenu={<CodeSideMenu />}
      breadcrumbLinks={getAIAgentTasksBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default AIAgentTasksLayout;
