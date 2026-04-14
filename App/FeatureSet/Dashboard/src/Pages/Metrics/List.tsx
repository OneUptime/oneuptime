import React, { Fragment, FunctionComponent, ReactElement } from "react";
import MetricsDashboard from "../../Components/Metrics/MetricsDashboard";
import MetricsNavTabs from "../../Components/Metrics/MetricsNavTabs";

const MetricsInsightsPage: FunctionComponent = (): ReactElement => {
  return (
    <Fragment>
      <MetricsNavTabs active="insights" />
      <MetricsDashboard />
    </Fragment>
  );
};

export default MetricsInsightsPage;
