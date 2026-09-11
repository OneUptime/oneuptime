import { getSettingsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, Suspense } from "react";
import { Outlet } from "react-router-dom";

const SettingsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Project Settings"}
      breadcrumbLinks={getSettingsBreadcrumbs(path)}
      sideMenu={<DashboardSideMenu />}
    >
      <Suspense fallback={<PageLoader isVisible={true} />}>
        <Outlet />
      </Suspense>
    </Page>
  );
};

export default SettingsLayout;
