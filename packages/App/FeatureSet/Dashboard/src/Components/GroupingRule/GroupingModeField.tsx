import {
  GROUPING_MODE_OPTIONS,
  GroupingMode,
  GroupingModeOption,
  GroupingRuleKind,
  GroupingRuleTranslateFunction,
  isGroupingMode,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import useGroupingRuleTranslate from "./GroupingRuleTranslate";
import CardSelect, {
  CardSelectOption,
} from "Common/UI/Components/CardSelect/CardSelect";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  kind: GroupingRuleKind;
  value: GroupingMode;
  onChange: (mode: GroupingMode) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

/*
 * "Group incidents by": the one question that replaced five group-by
 * switches. The product's card picker, with its cards in the reader's
 * language - CardSelect draws its options as it is handed them.
 */
const GroupingModeField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();

  const options: Array<CardSelectOption> = GROUPING_MODE_OPTIONS.map(
    (option: GroupingModeOption): CardSelectOption => {
      return {
        value: option.mode,
        title: translate(option.title),
        description: translate(option.description[props.kind]),
        icon: option.icon,
      };
    },
  );

  return (
    <CardSelect
      dataTestId="grouping-mode-field"
      ariaLabelledby={props.ariaLabelledby}
      options={options}
      value={props.value}
      error={props.error ? translate(props.error) : undefined}
      onChange={(value: string): void => {
        if (isGroupingMode(value)) {
          props.onChange(value);
        }
      }}
    />
  );
};

export default GroupingModeField;
