import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ChartGroup, {
  Chart,
} from "CommonUI/src/Components/Charts/ChartGroup/ChartGroup";

export interface ComponentProps {
  charts: Array<Chart>;
}

const MetricFilter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <div className="flex">
        <div>
          <ChartGroup charts={props.charts} />
        </div>
      </div>
    </Fragment>
  );
};

export default MetricFilter;
