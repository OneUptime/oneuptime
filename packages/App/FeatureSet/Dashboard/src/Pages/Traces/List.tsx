import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import TracesDashboard from "../../Components/Traces/TracesDashboard";

const TracesInsightsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <TracesDashboard />;
};

export default TracesInsightsPage;
