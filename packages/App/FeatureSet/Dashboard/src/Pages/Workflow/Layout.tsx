import { getWorkflowsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import WorkflowSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const WorkflowsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Workflows"}
      titleRight={<ProductAboutButton product={ProductKey.Workflows} />}
      breadcrumbLinks={getWorkflowsBreadcrumbs(path)}
      sideMenu={<WorkflowSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default WorkflowsLayout;
