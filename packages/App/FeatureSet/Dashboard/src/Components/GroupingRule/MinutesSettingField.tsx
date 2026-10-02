import {
  GroupingRuleTranslateFunction,
  getMinutesSettingValues,
  parseMinutes,
} from "../../Utils/GroupingRule/GroupingRuleSetup";
import useGroupingRuleTranslate from "./GroupingRuleTranslate";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  TemplateAround,
  translateTemplateAround,
} from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useId } from "react";

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
  const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();
  const minutesId: string = `minutes-setting-${useId()}`;
  const errorId: string = `${minutesId}-error`;

  const minutesText: string =
    props.minutes === undefined || props.minutes === null
      ? ""
      : String(props.minutes);

  const around: TemplateAround = translateTemplateAround(
    props.sentence,
    "minutes",
  );

  const error: string | undefined = props.error
    ? translate(props.error)
    : undefined;

  return (
    <div data-testid={props.dataTestId}>
      <Toggle
        title={translate(props.title)}
        description={translate(props.description)}
        value={props.enabled}
        dataTestId={`${props.dataTestId}-toggle`}
        onChange={(enabled: boolean): void => {
          props.onChange(
            getMinutesSettingValues({
              enabled: enabled,
              minutes: props.minutes,
              defaultMinutes: props.defaultMinutes,
            }),
          );
        }}
        onBlur={(): void => {
          props.onBlur?.();
        }}
      />

      {props.enabled ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 pl-14 text-sm text-gray-700"
          data-testid={`${props.dataTestId}-minutes-row`}
        >
          {around.before ? <span>{around.before.trim()}</span> : <></>}
          <Input
            id={minutesId}
            type={InputType.NUMBER}
            value={minutesText}
            ariaLabel={translate(props.minutesLabel)}
            ariaInvalid={Boolean(error)}
            ariaDescribedby={error ? errorId : undefined}
            dataTestId={`${props.dataTestId}-minutes`}
            outerDivClassName="relative w-24 rounded-md shadow-sm"
            onChange={(value: string): void => {
              props.onChange({
                enabled: true,
                minutes: parseMinutes(value) ?? value,
              });
            }}
            onBlur={props.onBlur}
          />
          {around.after ? <span>{around.after.trim()}</span> : <></>}
        </div>
      ) : (
        <></>
      )}

      {props.enabled && error ? (
        <p
          id={errorId}
          className="mt-1 pl-14 text-sm text-red-600"
          role="alert"
          data-testid={`${props.dataTestId}-error`}
        >
          {error}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};

export default MinutesSettingField;
