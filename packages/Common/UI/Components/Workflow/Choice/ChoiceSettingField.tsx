/*
 * A step's setting that is a choice of a few: what a Page step's page is
 * about - a new alert, an incident, or an alert.
 *
 * It is asked as one question with a row for each answer (ChoiceRows): the
 * answer's name and, under it, what choosing it means. A dropdown would hide
 * the other answers and what each of them does behind a click, and the
 * settings under this one change with the answer, so the answers are worth
 * seeing together.
 *
 * A choice is always made: while nothing is stored, the first choice is the
 * one in force, and is drawn as chosen. A stored value that is none of the
 * choices - a workflow written by hand - leaves every row unchosen, and the
 * note under them says what the setting holds.
 */

import {
  Argument,
  ArgumentChoice,
  getArgumentChoice,
} from "../../../../Types/Workflow/Component";
import { translationKey, Translator } from "../../../Utils/TranslateTemplate";
import useTranslator from "../../../Utils/UseTranslator";
import ChoiceRows, { ChoiceRowOption } from "../../ChoiceRows/ChoiceRows";
import React, { FunctionComponent, ReactElement } from "react";

export const UNKNOWN_CHOICE_NOTE: string = translationKey(
  "This is set to “{{value}}”, which is not one of the choices. Pick one.",
);

export interface ChoiceSettingFieldProps {
  argument: Argument;
  // The setting as it is stored.
  value: unknown;
  onChange: (value: string) => void;
  dataTestId?: string | undefined;
}

const ChoiceSettingField: FunctionComponent<ChoiceSettingFieldProps> = (
  props: ChoiceSettingFieldProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dataTestId: string = props.dataTestId || "choice-setting-field";
  const choices: Array<ArgumentChoice> = props.argument.choices || [];

  const chosen: ArgumentChoice | null = getArgumentChoice(
    props.argument,
    props.value,
  );

  const options: Array<ChoiceRowOption<string>> = choices.map(
    (choice: ArgumentChoice): ChoiceRowOption<string> => {
      return {
        value: choice.value,
        title: choice.label,
        description: choice.description,
        dataTestId: `${dataTestId}-${choice.value}`,
      };
    },
  );

  // Something is stored, and it is none of the choices.
  const unknownValue: string | null =
    !chosen && props.value !== undefined && props.value !== null
      ? String(
          typeof props.value === "string"
            ? props.value
            : JSON.stringify(props.value),
        )
      : null;

  return (
    <div data-testid={dataTestId}>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ChoiceRows<string>
          value={chosen ? chosen.value : null}
          options={options}
          onPick={(value: string) => {
            props.onChange(value);
          }}
          ariaLabel={props.argument.name}
        />
      </div>
      {unknownValue !== null && (
        <p
          role="alert"
          data-testid={`${dataTestId}-unknown`}
          className="mt-1 text-sm text-red-400"
        >
          {translator.translateTemplate(UNKNOWN_CHOICE_NOTE, {
            value:
              unknownValue.length > 60
                ? `${unknownValue.slice(0, 60)}…`
                : unknownValue,
          })}
        </p>
      )}
    </div>
  );
};

export default ChoiceSettingField;
