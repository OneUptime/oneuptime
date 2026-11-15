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
import { TelemetryIngestionBudgetExplorerBanner } from "../../Components/TelemetryIngestionBudget/ProjectTelemetryIngestionBudget";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ProductAboutButton from "../../Components/ProductOnboarding/ProductAboutButton";
import { ProductKey } from "../../Components/ProductOnboarding/ProductOnboarding";

// Which of Metrics' tabs a page is under (its AI pages: the AI tab).
export const getActiveMetricsTab: (path: string) => MetricsTabKey = (
  path: string,
): MetricsTabKey => {
  if (path.includes("/metrics/settings")) {
    return "settings";
  }
  if (path.includes("/metrics/ai/")) {
    return "ai";
  }
  if (path.includes("/metrics/insights")) {
    return "insights";
  }
  if (path.includes("/metrics/promql")) {
    return "promql";
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
      titleRight={<ProductAboutButton product={ProductKey.Metrics} />}
      breadcrumbLinks={getMetricsBreadcrumbs(path)}
      headerRight={<MetricsNavTabs active={getActiveMetricsTab(path)} />}
    >
      {/* Only while today's Metrics budget is past its warning or used up. */}
      <TelemetryIngestionBudgetExplorerBanner signal={ProductType.Metrics} />
      <Outlet />
    </Page>
  );
};

export default MetricsLayout;
