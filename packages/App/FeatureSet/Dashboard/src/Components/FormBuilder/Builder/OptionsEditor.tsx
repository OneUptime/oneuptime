import FormsCopy from "../FormsCopy";
import IconProp from "Common/Types/Icon/IconProp";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Input from "Common/UI/Components/Input/Input";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The options of a dropdown or multi-select question, one text box each,
 * in the order the public form lists them: add one, edit one, remove one.
 * Enter in the last box adds the next, so a list can be typed out without
 * reaching for the mouse.
 */

export interface ComponentProps {
  options: Array<string>;
  onChange: (options: Array<string>) => void;
  // For the test ids and the boxes' names.
  questionId: string;
}

const OptionsEditor: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  const tx: (text: string) => string = (text: string): string => {
    return translateString(text) || text;
  };

  const setOption: (index: number, value: string) => void = (
    index: number,
    value: string,
  ): void => {
    const options: Array<string> = [...props.options];
    options[index] = value;
    props.onChange(options);
  };

  const removeOption: (index: number) => void = (index: number): void => {
    props.onChange(
      props.options.filter((_option: string, at: number): boolean => {
        return at !== index;
      }),
    );
  };

  const addOption: () => void = (): void => {
    props.onChange([
      ...props.options,
      `${tx(FormsCopy.optionPlaceholder)} ${props.options.length + 1}`,
    ]);
  };

  return (
    <div data-testid={`form-question-options-${props.questionId}`}>
      <ul className="space-y-2">
        {props.options.map((option: string, index: number): ReactElement => {
          return (
            <li key={index} className="flex items-center gap-2">
              <span
                className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-gray-300"
                aria-hidden="true"
              />
              <Input
                className="flex-1"
                value={option}
                ariaLabel={`${tx(FormsCopy.optionPlaceholder)} ${index + 1}`}
                placeholder={tx(FormsCopy.optionPlaceholder)}
                dataTestId={`form-question-option-${props.questionId}-${index}`}
                onChange={(value: string) => {
                  setOption(index, value);
                }}
                onEnterPress={() => {
                  if (index === props.options.length - 1) {
                    addOption();
                  }
                }}
              />
              <button
                type="button"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`${tx(FormsCopy.removeOption)} ${index + 1}`}
                title={tx(FormsCopy.removeOption)}
                disabled={props.options.length <= 1}
                data-testid={`form-question-remove-option-${props.questionId}-${index}`}
                onClick={() => {
                  removeOption(index);
                }}
              >
                <Icon icon={IconProp.Close} className="h-4 w-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2">
        <Button
          title={FormsCopy.addOption}
          icon={IconProp.Add}
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          className="!ml-0"
          dataTestId={`form-question-add-option-${props.questionId}`}
          onClick={addOption}
        />
      </div>
    </div>
  );
};

export default OptionsEditor;
