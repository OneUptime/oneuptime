import MetricExplorer from "../../../Components/Metrics/MetricExplorer";
import PageComponentProps from "../../PageComponentProps";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

const MetricViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  return (
    <Fragment>
      <div className="mb-10">
        <MetricExplorer />
      </div>
    </Fragment>
  );
};

export default MetricViewPage;
