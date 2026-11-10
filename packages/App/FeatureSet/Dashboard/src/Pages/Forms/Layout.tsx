import { getFormsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import FormsSideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const FormsLayout: FunctionComponent<PageComponentProps> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title={"Forms"}
      titleRight={<ProductAboutButton product={ProductKey.Forms} />}
      breadcrumbLinks={getFormsBreadcrumbs(path)}
      sideMenu={<FormsSideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default FormsLayout;
