import { getRumBreadcrumbs } from "../../Utils/Breadcrumbs/RumBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const RumLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Real User Monitoring"}
      titleRight={<ProductAboutButton product={ProductKey.Rum} />}
      sideMenu={<SideMenu />}
      breadcrumbLinks={getRumBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default RumLayout;
