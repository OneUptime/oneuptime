import {
  getMinimumCountValues,
  parseMinimumCount,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import NumberSettingField from "./NumberSettingField";
import React, { FunctionComponent, ReactElement } from "react";

export interface MinimumCountSettingValue {
  enabled: boolean;
  count: number | string;
}

export interface ComponentProps {
  // The switch's label and the line of help under it (English keys).
  title: string;
  description: string;
  /*
   * What the count means, as one sentence with a {{count}} slot that the
   * number box is drawn in: "Open an episode once {{count}} matching
   * incidents are ongoing".
   */
  sentence: string;
  // The box's accessible name: "Minimum Incident Count".
  countLabel: string;
  enabled: boolean;
  count: unknown;
  onChange: (value: MinimumCountSettingValue) => void;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  dataTestId: string;
}

/*
 * Wait for more incidents before opening an episode (issue #5374): a switch,
 * and while it is on the sentence with the count in it - drawn as the
 * minutes settings are (NumberSettingField). Turned on with nothing in the
 * box, it starts at the count a rule starts with (DEFAULT_MINIMUM_COUNT).
 */
const MinimumCountSettingField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <NumberSettingField
      title={props.title}
      description={props.description}
      sentence={props.sentence}
      slot="count"
      valueLabel={props.countLabel}
      enabled={props.enabled}
      value={props.count}
      error={props.error}
      dataTestId={props.dataTestId}
      onBlur={props.onBlur}
      onToggle={(enabled: boolean): void => {
        props.onChange(
          getMinimumCountValues({
            enabled: enabled,
            count: props.count,
          }),
        );
      }}
      onValueChange={(text: string): void => {
        props.onChange({
          enabled: true,
          count: parseMinimumCount(text) ?? text,
        });
      }}
    />
  );
};

export default MinimumCountSettingField;
