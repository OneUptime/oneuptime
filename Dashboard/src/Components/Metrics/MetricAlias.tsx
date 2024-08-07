import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Input from "Common/UI/src/Components/Input/Input";
import Icon, { ThickProp } from "Common/UI/src/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";

export interface MetricAliasData {
  metricVariable: string;
  title: string;
  description: string;
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
        {!props.isFormula && (
          <div className="bg-indigo-500 h-9 rounded w-9 p-3 pt-2 mt-2 font-medium text-white">
            {props.data.metricVariable}
          </div>
        )}
        {props.isFormula && (
          <div className="bg-indigo-500 h-9 p-2 pt-2.5 rounded w-9 mt-2 font-bold text-white">
            <Icon thick={ThickProp.Thick} icon={IconProp.ChevronRight} />
          </div>
        )}
        <div>
          <Input
            value={props.data.title}
            onChange={(value: string) => {
              return props.onDataChanged({
                ...props.data,
                metricVariable: props.data.metricVariable,
                title: value,
              });
            }}
            placeholder="Title..."
          />
        </div>
        <div className="w-full">
          <Input
            value={props.data.description}
            onChange={(value: string) => {
              return props.onDataChanged({
                ...props.data,
                metricVariable: props.data.metricVariable,
                description: value,
              });
            }}
            placeholder="Description..."
          />
        </div>
      </div>
    </Fragment>
  );
};

export default MetricAlias;
