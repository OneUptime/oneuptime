/*
 * A Dropdown or Multi Select Dropdown custom field, in a step's settings: its own
 * options, with { } beside them for a value from an earlier step. An option since
 * removed that a step still holds is shown as it is, and can be changed; what is
 * written is the option's value, as the record's own page writes it.
 */

import Color from "../../../../Types/Color";
import { CustomFieldDropdownOption } from "../../../../Types/CustomField/CustomFieldDropdownOption";
import { DropdownOption } from "../../Dropdown/Dropdown";
import ListValueInput from "../LinkedRecord/ListValueInput";
import { containsTemplateExpression } from "../ValuePicker/TemplateText";
import React, { FunctionComponent, ReactElement, useMemo } from "react";

export interface ComponentProps {
  choices: Array<CustomFieldDropdownOption>;
  value?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
  isList?: boolean | undefined;
  values?: Array<string> | undefined;
  onChangeList?: ((values: Array<string>) => void) | undefined;
  onPickReference?: ((reference: string) => void) | undefined;
  ariaLabelledby?: string | undefined;
  autoFocus?: boolean | undefined;
  dataTestId: string;
}

type IsReferenceTextFunction = (text: string) => boolean;

// Anything but an option is refused when the step runs, so only a reference is.
const isReferenceText: IsReferenceTextFunction = (text: string): boolean => {
  return containsTemplateExpression(text.trim());
};

const CustomFieldChoiceInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const options: Array<DropdownOption> = useMemo(() => {
    return props.choices.map(
      (choice: CustomFieldDropdownOption): DropdownOption => {
        const option: DropdownOption = {
          value: choice.value,
          // Something a person named, drawn as it is rather than looked up.
          label: choice.value,
          isUserContent: true,
        };

        if (choice.color) {
          option.color = new Color(choice.color);
        }

        return option;
      },
    );
  }, [props.choices]);

  const known: Map<string, DropdownOption> = useMemo(() => {
    return new Map<string, DropdownOption>(
      options.map((option: DropdownOption): [string, DropdownOption] => {
        return [String(option.value).toLowerCase(), option];
      }),
    );
  }, [options]);

  return (
    <ListValueInput
      options={options}
      known={known}
      value={props.value}
      onChange={props.onChange}
      isList={props.isList}
      values={props.values}
      onChangeList={props.onChangeList}
      onPickReference={props.onPickReference}
      isCreatableText={isReferenceText}
      ariaLabelledby={props.ariaLabelledby}
      autoFocus={props.autoFocus}
      dataTestId={props.dataTestId}
    />
  );
};

export default CustomFieldChoiceInput;
