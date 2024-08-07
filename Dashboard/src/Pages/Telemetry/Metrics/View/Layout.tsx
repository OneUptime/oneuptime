import { getTelemetryBreadcrumbs } from "../../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../../Utils/RouteMap";
import PageComponentProps from "../../../PageComponentProps";
import Page from "Common/UI/src/Components/Page/Page";
import Navigation from "Common/UI/src/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const MetricsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <Page
      title="Metrics Explorer"
      breadcrumbLinks={getTelemetryBreadcrumbs(path)}
    >
      <Outlet />
    </Page>
  );
};

export default MetricsLayout;
