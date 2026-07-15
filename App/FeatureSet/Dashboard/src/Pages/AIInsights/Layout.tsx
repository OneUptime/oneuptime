import React, { FunctionComponent, ReactElement } from "react";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import { RouteUtil } from "../../Utils/RouteMap";
import { Outlet } from "react-router-dom";
import { getAIInsightsBreadcrumbs } from "../../Utils/Breadcrumbs";

const AIInsightsLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title={"AI Insights"}
      sideMenu={<SideMenu />}
      breadcrumbLinks={getAIInsightsBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default AIInsightsLayout;
