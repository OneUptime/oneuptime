import { getStatusPagesBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const ScheduledMaintenancesLayout: FunctionComponent<
  LayoutPageComponentProps
> = (props: LayoutPageComponentProps): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Status Pages"}
      titleRight={<ProductAboutButton product={ProductKey.StatusPages} />}
      sideMenu={props.hideSideMenu ? undefined : <SideMenu />}
      breadcrumbLinks={getStatusPagesBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default ScheduledMaintenancesLayout;
