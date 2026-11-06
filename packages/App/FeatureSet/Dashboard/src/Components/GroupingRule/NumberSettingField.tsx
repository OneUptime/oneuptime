import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import { GroupingRuleTranslateFunction } from "../../Utils/GroupingRule/GroupingRuleSetup";
import useGroupingRuleTranslate from "./GroupingRuleTranslate";
import Input, { InputType } from "Common/UI/Components/Input/Input";
import Toggle from "Common/UI/Components/Toggle/Toggle";
import {
  TemplateAround,
  translateTemplateAround,
} from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement, useId } from "react";

export interface ComponentProps {
  // The switch's label and the line of help under it (English keys).
  title: string;
  description: string;
  /*
   * What the number means, as one sentence with a {{slot}} that the number
   * box is drawn in: "Within {{minutes}} minutes of the previous incident".
   * Each language puts the box where its grammar wants it.
   */
  sentence: string;
  // The sentence's placeholder for the box, and the box's test id part.
  slot: string;
  // The box's accessible name, the setting's own name: "Time Window".
  valueLabel: string;
  enabled: boolean;
  value: unknown;
  // The switch was flipped.
  onToggle: (enabled: boolean) => void;
  // The box now holds this text.
  onValueChange: (text: string) => void;
  onBlur?: (() => void) | undefined;
  error?: string | undefined;
  dataTestId: string;
}

/*
 * One setting that is a switch and a number, drawn as one: the switch says
 * what it does, and only when it is on does the sentence with the number in
 * it appear beneath it. The grouping rule's minutes settings
 * (MinutesSettingField) and its count of incidents to wait for
 * (MinimumCountSettingField) are this shape, and say what the number means
 * themselves.
 */
const NumberSettingField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translate: GroupingRuleTranslateFunction = useGroupingRuleTranslate();
  const valueId: string = `${props.slot}-setting-${useId()}`;
  const errorId: string = `${valueId}-error`;

  const valueText: string =
    props.value === undefined || props.value === null
      ? ""
      : String(props.value);

  /*
   * The words before the box and after it are items of the row, each a box
   * of its own: the box is not set apart from them in a language read right
   * to left (TemplateAroundOptions), or an empty half holding the isolate's
   * mark alone would be one more item, a gap before the box.
   */
  const around: TemplateAround = translateTemplateAround(
    props.sentence,
    props.slot,
    {},
    { setsSlotApart: false },
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
          props.onToggle(enabled);
        }}
        onBlur={(): void => {
          props.onBlur?.();
        }}
      />

      {props.enabled ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 pl-14 text-sm text-gray-700"
          data-testid={`${props.dataTestId}-${props.slot}-row`}
        >
          {around.before ? <span>{around.before.trim()}</span> : <></>}
          <Input
            id={valueId}
            type={InputType.NUMBER}
            value={valueText}
            ariaLabel={translate(props.valueLabel)}
            ariaInvalid={Boolean(error)}
            ariaDescribedby={error ? errorId : undefined}
            dataTestId={`${props.dataTestId}-${props.slot}`}
            outerDivClassName="relative w-24 rounded-md shadow-sm"
            onChange={(text: string): void => {
              props.onValueChange(text);
            }}
            onBlur={props.onBlur}
          />
          {around.after ? <span>{around.after.trim()}</span> : <></>}
        </div>
      ) : (
        <></>
      )}

      {props.enabled && error ? (
        <FieldError
          id={errorId}
          message={error}
          className="mt-1 pl-14 text-sm text-red-600"
          dataTestId={`${props.dataTestId}-error`}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default NumberSettingField;
