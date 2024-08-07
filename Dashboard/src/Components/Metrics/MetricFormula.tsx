import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Input from "Common/UI/src/Components/Input/Input";
import FieldLabelElement from "Common/UI/src/Components/Forms/Fields/FieldLabel";

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
      <div className="flex mt-3">
        <div className="w-full">
          <FieldLabelElement
            required={true}
            title="Formula"
            description="Please use the variables from queries (above) in this formula."
          />
          <Input
            value={props.data.metricFormula}
            onChange={(value: string) => {
              return props.onDataChanged({
                ...props.data,
                metricFormula: value,
              });
            }}
            placeholder="2 * a"
          />
        </div>
      </div>
    </Fragment>
  );
};

export default MetricFilter;
