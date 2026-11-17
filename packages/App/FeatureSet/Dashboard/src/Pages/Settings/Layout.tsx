import { getSettingsBreadcrumbs } from "../../Utils/Breadcrumbs";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
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
      <Suspense fallback={<PageSkeleton />}>
        <Outlet />
      </Suspense>
    </Page>
  );
};

export default SettingsLayout;
