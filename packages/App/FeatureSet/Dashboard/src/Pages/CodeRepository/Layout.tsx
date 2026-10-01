import { getCodeRepositoryBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import CodeSideMenu from "../../Components/Code/CodeSideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const CodeRepositoryLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Code Repositories"}
      sideMenu={<CodeSideMenu />}
      breadcrumbLinks={getCodeRepositoryBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default CodeRepositoryLayout;
