import IconProp from "Common/Types/Icon/IconProp";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
  MetricPipelineRuleFilterConditionUtil,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import Button, { ButtonSize } from "Common/UI/Components/Button/Button";
import HorizontalRule from "Common/UI/Components/HorizontalRule/HorizontalRule";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import MetricPipelineRuleFilterFormElement from "./MetricPipelineRuleFilter";

export interface ComponentProps {
  value: Array<MetricPipelineRuleFilterCondition> | undefined;
  onChange?:
    | ((value: Array<MetricPipelineRuleFilterCondition>) => void)
    | undefined;
}

const MetricPipelineRuleFilters: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [filters, setFilters] = React.useState<
    Array<MetricPipelineRuleFilterCondition>
  >(props.value || []);

  useEffect(() => {
    if (props.onChange) {
      props.onChange(filters);
    }
  }, [filters]);

  return (
    <div>
      {filters.length === 0 && (
        <p className="text-sm text-gray-700 text-semibold">
          If no filters are added, then this rule will apply to every metric
          data point.
        </p>
      )}

      {filters.map(
        (filter: MetricPipelineRuleFilterCondition, index: number) => {
          return (
            <MetricPipelineRuleFilterFormElement
              key={index}
              initialValue={filter}
              onDelete={() => {
                const next: Array<MetricPipelineRuleFilterCondition> = [
                  ...filters,
                ];
                next.splice(index, 1);
                setFilters(next);
              }}
              onChange={(value: MetricPipelineRuleFilterCondition) => {
                const next: Array<MetricPipelineRuleFilterCondition> = [
                  ...filters,
                ];
                next[index] = value;
                setFilters(next);
              }}
            />
          );
        },
      )}

      <div className="mt-3 -ml-3">
        <Button
          title="Add Filter"
          buttonSize={ButtonSize.Small}
          icon={IconProp.Add}
          onClick={() => {
            const defaultCheckOn: MetricPipelineRuleFilterCheckOn =
              MetricPipelineRuleFilterCheckOn.MetricName;
            const defaultConditionType: MetricPipelineRuleFilterConditionType =
              MetricPipelineRuleFilterConditionUtil.getConditionTypesByCheckOn(
                defaultCheckOn,
              )[0]!;

            setFilters([
              ...filters,
              {
                checkOn: defaultCheckOn,
                conditionType: defaultConditionType,
                attributeKey: undefined,
                value: "",
              },
            ]);
          }}
        />
      </div>
      <HorizontalRule />
    </div>
  );
};

export default MetricPipelineRuleFilters;
