import React, { FunctionComponent, ReactElement } from "react";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import { RouteUtil } from "../../Utils/RouteMap";
import { Outlet } from "react-router-dom";
import { getAIInsightsBreadcrumbs } from "../../Utils/Breadcrumbs";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const AIInsightsLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title={"AI Insights"}
      titleRight={<ProductAboutButton product={ProductKey.AIInsights} />}
      sideMenu={<SideMenu />}
      breadcrumbLinks={getAIInsightsBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default AIInsightsLayout;
