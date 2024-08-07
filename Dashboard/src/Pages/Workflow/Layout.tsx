import { getWorkflowsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import WorkflowSideMenu from "./SideMenu";
import Page from "Common/UI/src/Components/Page/Page";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const WorkflowsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Workflows"}
      breadcrumbLinks={getWorkflowsBreadcrumbs(path)}
      sideMenu={<WorkflowSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default WorkflowsLayout;
