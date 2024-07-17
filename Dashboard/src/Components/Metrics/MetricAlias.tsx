import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Input from "CommonUI/src/Components/Input/Input";
import Icon from "CommonUI/src/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface MetricAliasData {
  metricVariable: string;
  metricAlias: string;
}

export interface ComponentProps {
  data: MetricAliasData;
  isFormula: boolean;
  onDataChanged: (data: MetricAliasData) => void;
}

const MetricAlias: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Fragment>
      <div className="flex space-x-3">
        {!props.isFormula && <div className="bg-indigo-500 h-9 rounded w-9 p-3 pt-2 mt-2 font-medium text-white">
          {props.data.metricVariable}
        </div>}
        {props.isFormula && <div className="bg-indigo-500 h-9 p-2 rounded w-9 mt-2 font-bold text-white">
        <Icon icon={IconProp.ChevronRight} />
        </div>}
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
