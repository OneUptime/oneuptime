import PromQLQueryView from "../../Components/Metrics/PromQL/PromQLQueryView";
import PageComponentProps from "../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";

// The PromQL tab: query the project's metrics with PromQL (#6796).
const MetricsPromQLPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <div className="mb-10">
      <PromQLQueryView />
    </div>
  );
};

export default MetricsPromQLPage;
