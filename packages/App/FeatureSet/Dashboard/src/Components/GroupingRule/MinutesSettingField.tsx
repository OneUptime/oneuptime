import {
  getMinutesSettingValues,
  parseMinutes,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import NumberSettingField from "./NumberSettingField";
import React, { FunctionComponent, ReactElement } from "react";

export interface MinutesSettingValue {
  enabled: boolean;
  minutes: number | string;
}

export interface ComponentProps {
  // The switch's label and the line of help under it (English keys).
  title: string;
  description: string;
  /*
   * What the minutes mean, as one sentence with a {{minutes}} slot that the
   * number box is drawn in: "Within {{minutes}} minutes of the previous
   * incident". Each language puts the box where its grammar wants it.
   */
  sentence: string;
  // The box's accessible name, the setting's own name: "Time Window".
  minutesLabel: string;
  enabled: boolean;
  minutes: unknown;
  // What the box starts with when the switch is turned on with nothing in it.
  defaultMinutes: number;
  onChange: (value: MinutesSettingValue) => void;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  dataTestId: string;
}

/*
 * One setting that is a switch and a number of minutes, drawn as one: the
 * switch says what it does, and only when it is on does the sentence with
 * the minutes in it appear beneath it. Four of the grouping rule's settings
 * are this shape (the time window, reopening, waiting to resolve and
 * resolving when quiet), and each used to be two fields - a checkbox with a
 * paragraph of help and a separate "(minutes)" box shown under it.
 */
const MinutesSettingField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <NumberSettingField
      title={props.title}
      description={props.description}
      sentence={props.sentence}
      slot="minutes"
      valueLabel={props.minutesLabel}
      enabled={props.enabled}
      value={props.minutes}
      error={props.error}
      dataTestId={props.dataTestId}
      onBlur={props.onBlur}
      onToggle={(enabled: boolean): void => {
        props.onChange(
          getMinutesSettingValues({
            enabled: enabled,
            minutes: props.minutes,
            defaultMinutes: props.defaultMinutes,
          }),
        );
      }}
      onValueChange={(text: string): void => {
        props.onChange({
          enabled: true,
          minutes: parseMinutes(text) ?? text,
        });
      }}
    />
  );
};

export default MinutesSettingField;
