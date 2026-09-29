import { getServerlessBreadcrumbs } from "../../Utils/Breadcrumbs/ServerlessBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const ServerlessLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Serverless"}
      sideMenu={<SideMenu />}
      breadcrumbLinks={getServerlessBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default ServerlessLayout;
