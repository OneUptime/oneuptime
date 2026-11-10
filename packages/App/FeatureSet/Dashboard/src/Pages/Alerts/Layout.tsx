import { getAlertsBreadcrumbs } from "../../Utils/Breadcrumbs/AlertBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const AlertsLayout: FunctionComponent<LayoutPageComponentProps> = (
  props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Alerts"}
      titleRight={<ProductAboutButton product={ProductKey.Alerts} />}
      sideMenu={
        props.hideSideMenu ? undefined : (
          <SideMenu project={props.currentProject || undefined} />
        )
      }
      breadcrumbLinks={getAlertsBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default AlertsLayout;
