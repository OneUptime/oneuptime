import {
  REPEAT_CHOICES,
  RepeatChoice,
  RepeatChoiceConfig,
  isRepeatChoice,
} from "./RepeatChoice";
import Radio, {
  RadioOption,
  RadioValue,
} from "Common/UI/Components/Radio/Radio";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  config: RepeatChoiceConfig;
  // The answer the form's two columns make.
  value: RepeatChoice;
  onChange: (choice: RepeatChoice) => void;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

/*
 * Stop, or start again from the first level: two plain answers, each with
 * one line saying what it means, where a switch whose help explained both
 * modes used to be (RepeatChoice.ts).
 */
const RepeatChoiceField: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const options: Array<RadioOption> = REPEAT_CHOICES.map(
    (choice: RepeatChoice): RadioOption => {
      const copy: { title: string; description: string } =
        props.config.copy.choices[choice];

      return {
        value: choice,
        label: translator.translateText(copy.title) || copy.title,
        description:
          translator.translateText(copy.description) || copy.description,
      };
    },
  );

  return (
    <Radio
      className="mt-0"
      dataTestId={`${props.config.dataTestId}-choice`}
      ariaLabelledby={props.ariaLabelledby}
      options={options}
      value={props.value}
      error={props.error}
      onChange={(value: RadioValue | null): void => {
        if (isRepeatChoice(value)) {
          props.onChange(value);
        }
      }}
    />
  );
};

export default RepeatChoiceField;
