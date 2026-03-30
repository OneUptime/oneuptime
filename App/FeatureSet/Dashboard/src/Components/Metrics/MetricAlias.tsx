import React, { Fragment, FunctionComponent, ReactElement } from "react";
import Input from "Common/UI/Components/Input/Input";
import Icon, { ThickProp } from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import MetricAliasData from "Common/Types/Metrics/MetricAliasData";

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
      <div className="space-y-3">
        <div className="flex space-x-3 items-start">
          {!props.isFormula && props.data.metricVariable && (
            <div className="bg-indigo-500 h-9 rounded w-9 min-w-9 p-3 pt-2 mt-5 font-medium text-white text-center text-sm">
              {props.data.metricVariable}
            </div>
          )}
          {props.isFormula && (
            <div className="bg-indigo-500 h-9 p-2 pt-2.5 rounded w-9 min-w-9 mt-5 font-bold text-white">
              <Icon thick={ThickProp.Thick} icon={IconProp.ChevronRight} />
            </div>
          )}
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Title
            </label>
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
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Description
            </label>
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
        <div className="flex space-x-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Legend
            </label>
            <Input
              value={props.data.legend}
              onChange={(value: string) => {
                return props.onDataChanged({
                  ...props.data,
                  metricVariable: props.data.metricVariable,
                  legend: value,
                });
              }}
              placeholder="Legend (e.g. Response Time)"
            />
          </div>
          <div className="w-1/3">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Unit
            </label>
            <Input
              value={props.data.legendUnit}
              onChange={(value: string) => {
                return props.onDataChanged({
                  ...props.data,
                  metricVariable: props.data.metricVariable,
                  legendUnit: value,
                });
              }}
              placeholder="Unit (e.g. ms)"
            />
          </div>
        </div>
      </div>
    </Fragment>
  );
};

export default MetricAlias;
