import { getServiceBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import ServiceSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const ServiceLayout: FunctionComponent<LayoutPageComponentProps> = (
  props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Services"}
      titleRight={<ProductAboutButton product={ProductKey.Services} />}
      breadcrumbLinks={getServiceBreadcrumbs(path)}
      sideMenu={props.hideSideMenu ? undefined : <ServiceSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default ServiceLayout;
