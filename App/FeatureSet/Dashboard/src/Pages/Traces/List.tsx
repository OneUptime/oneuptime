import PageComponentProps from "../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import TracesDashboard from "../../Components/Traces/TracesDashboard";
import TracesNavTabs from "../../Components/Traces/TracesNavTabs";

const TracesInsightsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <TracesNavTabs active="insights" />
      <TracesDashboard />
    </Fragment>
  );
};

export default TracesInsightsPage;
