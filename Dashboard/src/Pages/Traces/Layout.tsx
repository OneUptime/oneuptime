import { getTracesBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const TracesLayout: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Traces"
      breadcrumbLinks={getTracesBreadcrumbs(path)}
      sideMenu={<SideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default TracesLayout;
