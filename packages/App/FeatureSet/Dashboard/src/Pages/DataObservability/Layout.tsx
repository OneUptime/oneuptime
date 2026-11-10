import { getDataObservabilityBreadcrumbs } from "../../Utils/Breadcrumbs/DataObservabilityBreadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import LayoutPageComponentProps from "../LayoutPageComponentProps";
import DataObservabilitySideMenu from "./SideMenu";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

/*
 * Every Data Observability page but a table's, which opens on pages of its
 * own under its own side menu (Pages/DataObservability/TableView).
 */
const DataObservabilityLayout: FunctionComponent<LayoutPageComponentProps> = (
  _props: LayoutPageComponentProps,
): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Data Observability"
      titleRight={<ProductAboutButton product={ProductKey.DataObservability} />}
      breadcrumbLinks={getDataObservabilityBreadcrumbs(path)}
      sideMenu={<DataObservabilitySideMenu />}
    >
      <Outlet />
    </Page>
  );
};

export default DataObservabilityLayout;
