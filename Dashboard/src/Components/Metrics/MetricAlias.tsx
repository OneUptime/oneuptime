import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Input from "CommonUI/src/Components/Input/Input";

export interface MetricAliasData {
  metricVariable: string;
  metricAlias: string;
}

export interface ComponentProps {
  data: MetricAliasData;
  onDataChanged: (data: MetricAliasData) => void;
}

const MetricAlias: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <div className="flex">
        <div className="bg-indigo-500 h-10 w-10">
          {props.data.metricVariable}
        </div>
        <div>
          <Input
            value={props.data.metricAlias}
            onChange={(value: string) => {
              return props.onDataChanged({
                ...props.data,
                metricVariable: props.data.metricVariable,
                metricAlias: value,
              });
            }}
            placeholder="as ..."
          />
        </div>
      </div>
    </Fragment>
  );
};

export default MetricAlias;
