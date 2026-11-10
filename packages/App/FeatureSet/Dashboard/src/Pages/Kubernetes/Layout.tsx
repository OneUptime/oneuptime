import { getKubernetesBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import SideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

const KubernetesLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title={"Kubernetes"}
      titleRight={<ProductAboutButton product={ProductKey.Kubernetes} />}
      sideMenu={<SideMenu />}
      breadcrumbLinks={getKubernetesBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default KubernetesLayout;
