import { getMetricsBreadcrumbs } from "../../Utils/Breadcrumbs";
import { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import MetricsNavTabs, {
  MetricsTabKey,
} from "../../Components/Metrics/MetricsNavTabs";
import Page from "Common/UI/Components/Page/Page";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet } from "react-router-dom";

const getActiveMetricsTab = (path: string): MetricsTabKey => {
  if (path.includes("/metrics/settings")) {
    return "settings";
  }
  if (path.includes("/metrics/insights")) {
    return "insights";
  }
  if (path.includes("/metrics/documentation")) {
    return "setup";
  }
  return "viewer";
};

const MetricsLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());

  return (
    <Page
      title="Metrics"
      breadcrumbLinks={getMetricsBreadcrumbs(path)}
      headerRight={<MetricsNavTabs active={getActiveMetricsTab(path)} />}
    >
      <Outlet />
    </Page>
  );
};

export default MetricsLayout;
