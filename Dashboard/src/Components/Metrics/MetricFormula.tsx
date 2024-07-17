import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Input from "CommonUI/src/Components/Input/Input";

export interface MetricFormulaData {
  metricFormula: string;
}

export interface ComponentProps {
  data: MetricFormulaData;
  onDataChanged: (data: MetricFormulaData) => void;
}

const MetricFilter: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <div className="flex">
        <div>
          <Input
            value={props.data.metricFormula}
            onChange={(value: string) => {
              return props.onDataChanged({
                ...props.data,
                metricFormula: value,
              });
            }}
            placeholder="a + b"
          />
        </div>
      </div>
    </Fragment>
  );
};

export default MetricFilter;
