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
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
  MetricPipelineRuleFilterConditionUtil,
} from "Common/Types/Metrics/MetricPipelineRuleFilterCondition";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useEffect } from "react";

/*
 * MATCHES PATTERN TYPE (#10934): the value holds what a log or trace scrub
 * rule's built-in Pattern Type finds, matched by the very pattern those
 * rules run - what Scrub It's rule for an IP address, an email address, a
 * card number, a phone number or a Social Security number in a metric's
 * attribute matches (#11112). Its value is picked from the
 * pattern types, named as the scrub rule forms name them, never typed.
 */
export const MATCHES_PATTERN_TYPE_LABEL: string = translationKey(
  "Matches Pattern Type",
);

export const METRIC_FILTER_PATTERN_TYPE_OPTIONS: Array<DropdownOption> = [
  { label: "Email Address", value: LogScrubPatternType.Email },
  { label: "Credit Card Number", value: LogScrubPatternType.CreditCard },
  { label: "SSN (Social Security Number)", value: LogScrubPatternType.SSN },
  { label: "Phone Number", value: LogScrubPatternType.PhoneNumber },
  { label: "IP Address", value: LogScrubPatternType.IPAddress },
];

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
          label:
            conditionType ===
            MetricPipelineRuleFilterConditionType.MatchesPatternType
              ? MATCHES_PATTERN_TYPE_LABEL
              : conditionType,
        };
      })
    : [];

  const isPatternType: boolean =
    filter?.conditionType ===
    MetricPipelineRuleFilterConditionType.MatchesPatternType;

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

        {filter?.checkOn && filter?.conditionType && isPatternType && (
          <div className="mt-1">
            <FieldLabelElement title="Pattern Type" />
            <Dropdown
              value={METRIC_FILTER_PATTERN_TYPE_OPTIONS.find(
                (option: DropdownOption) => {
                  return option.value === filter?.value;
                },
              )}
              options={METRIC_FILTER_PATTERN_TYPE_OPTIONS}
              isClearable={false}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                if (!filter) {
                  return;
                }
                setFilter({
                  ...filter,
                  value: value?.toString(),
                });
              }}
            />
          </div>
        )}

        {filter?.checkOn &&
          filter?.conditionType &&
          showValue &&
          !isPatternType && (
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
