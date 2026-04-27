import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import FieldLabelElement from "Common/UI/Components/Detail/FieldLabel";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import Input from "Common/UI/Components/Input/Input";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
  MetricPipelineRuleFilterConditionUtil,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

export interface ComponentProps {
  initialValue: MetricPipelineRuleFilterCondition | undefined;
  onChange?: ((value: MetricPipelineRuleFilterCondition) => void) | undefined;
  onDelete?: (() => void) | undefined;
}

const MetricPipelineRuleFilterFormElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [filter, setFilter] = React.useState<
    MetricPipelineRuleFilterCondition | undefined
  >(props.initialValue);

  useEffect(() => {
    if (props.onChange && filter) {
      props.onChange(filter);
    }
  }, [filter]);

  const checkOnOptions: Array<DropdownOption> =
    MetricPipelineRuleFilterConditionUtil.getCheckOnOptions().map(
      (checkOn: MetricPipelineRuleFilterCheckOn) => {
        return {
          value: checkOn,
          label: checkOn,
        };
      },
    );

  const conditionTypeOptions: Array<DropdownOption> = filter?.checkOn
    ? MetricPipelineRuleFilterConditionUtil.getConditionTypesByCheckOn(
        filter.checkOn,
      ).map((conditionType: MetricPipelineRuleFilterConditionType) => {
        return {
          value: conditionType,
          label: conditionType,
        };
      })
    : [];

  const showAttributeKey: boolean = Boolean(
    filter?.checkOn &&
      MetricPipelineRuleFilterConditionUtil.hasAttributeKeyField(
        filter.checkOn,
      ),
  );

  const showValue: boolean =
    MetricPipelineRuleFilterConditionUtil.hasValueField(filter?.conditionType);

  const attributeKeyPlaceholder: string = "http.method";

  let valuePlaceholder: string = "";
  if (filter?.checkOn === MetricPipelineRuleFilterCheckOn.MetricName) {
    if (
      filter.conditionType ===
        MetricPipelineRuleFilterConditionType.MatchesRegex ||
      filter.conditionType ===
        MetricPipelineRuleFilterConditionType.DoesNotMatchRegex
    ) {
      valuePlaceholder = "^http\\.server\\.duration$";
    } else {
      valuePlaceholder = "http.server.duration";
    }
  } else if (filter?.checkOn === MetricPipelineRuleFilterCheckOn.Attribute) {
    if (
      filter.conditionType ===
        MetricPipelineRuleFilterConditionType.MatchesRegex ||
      filter.conditionType ===
        MetricPipelineRuleFilterConditionType.DoesNotMatchRegex
    ) {
      valuePlaceholder = "^GET$";
    } else {
      valuePlaceholder = "GET";
    }
  }

  return (
    <div>
      <div className="rounded-md p-2 bg-gray-50 my-5 border-gray-200 border-solid border-2">
        <div>
          <FieldLabelElement title="Filter Type" />
          <Dropdown
            value={checkOnOptions.find((i: DropdownOption) => {
              return i.value === filter?.checkOn;
            })}
            options={checkOnOptions}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              setFilter({
                checkOn: value?.toString() as MetricPipelineRuleFilterCheckOn,
                conditionType: undefined,
                attributeKey: undefined,
                value: undefined,
              });
            }}
          />
        </div>

        {showAttributeKey && (
          <div className="mt-1">
            <FieldLabelElement title="Attribute Key" />
            <Input
              placeholder={attributeKeyPlaceholder}
              value={filter?.attributeKey}
              onChange={(value: string) => {
                if (!filter) {
                  return;
                }
                setFilter({
                  ...filter,
                  attributeKey: value,
                });
              }}
            />
          </div>
        )}

        {filter?.checkOn && (
          <div className="mt-1">
            <FieldLabelElement title="Condition" />
            <Dropdown
              value={conditionTypeOptions.find((i: DropdownOption) => {
                return i.value === filter?.conditionType;
              })}
              options={conditionTypeOptions}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (!filter) {
                  return;
                }
                setFilter({
                  ...filter,
                  conditionType:
                    value?.toString() as MetricPipelineRuleFilterConditionType,
                  value: undefined,
                });
              }}
            />
          </div>
        )}

        {filter?.checkOn && filter?.conditionType && showValue && (
          <div className="mt-1">
            <FieldLabelElement title="Value" />
            <Input
              placeholder={valuePlaceholder}
              value={filter?.value?.toString()}
              onChange={(value: string) => {
                if (!filter) {
                  return;
                }
                setFilter({
                  ...filter,
                  value: value,
                });
              }}
            />
          </div>
        )}

        <div className="mt-3 -mr-2 w-full flex justify-end">
          <Button
            title="Delete Filter"
            buttonStyle={ButtonStyleType.DANGER_OUTLINE}
            icon={IconProp.Trash}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              props.onDelete?.();
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default MetricPipelineRuleFilterFormElement;
