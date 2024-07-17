import React, { Fragment, FunctionComponent, ReactElement } from "react";
import ChartGroup, {
  Chart,
  ChartGroupInterval,
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
          <ChartGroup
            charts={props.charts}
            interval={ChartGroupInterval.ONE_HOUR}
          />
        </div>
      </div>
    </Fragment>
  );
};

export default MetricFilter;
