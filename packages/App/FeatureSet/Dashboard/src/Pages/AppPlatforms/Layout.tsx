import { getAppPlatformsBreadcrumbs } from "../../Utils/Breadcrumbs/AppPlatformsBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const AppPlatformsLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"App Platforms"}
      titleRight={<ProductAboutButton product={ProductKey.AppPlatforms} />}
      sideMenu={<SideMenu />}
      breadcrumbLinks={getAppPlatformsBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default AppPlatformsLayout;
