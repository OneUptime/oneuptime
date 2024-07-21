import PageComponentProps from "../../../../../PageComponentProps";
import React, { FunctionComponent, ReactElement } from "react";
import MetricExplorer from "../../../../../../Components/Metrics/MetricExplorer";

const MetricViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return <MetricExplorer />;
};

export default MetricViewPage;
