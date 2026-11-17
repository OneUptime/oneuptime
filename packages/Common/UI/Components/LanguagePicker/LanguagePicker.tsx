import IconProp from "../../../Types/Icon/IconProp";
import Dropdown, { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import {
  findDropdownOption,
  readPickedDropdownValue,
} from "../Dropdown/DropdownChoices";
import Icon, { SizeProp } from "../Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The language picker at the foot of every front end: the Dashboard, the
 * admin dashboard, Accounts and a status page. It is the shared Dropdown,
 * so its height, border, focus ring, menu, keyboard and dark look are every
 * other picker's (#9294); each front end had its own raw <select>, drawn as
 * a line of grey text. A language is always chosen, so it has no clear
 * control. Each language is named in its own words ("Deutsch", "العربية"),
 * never looked up, and read the way its letters run.
 */

export interface LanguagePickerLanguage {
  code: string;
  nativeName: string;
}

export interface ComponentProps {
  // The id of the box a person types into, which the hidden label names.
  inputId: string;
  // "Switch language", in the reader's language already.
  label: string;
  languages: Array<LanguagePickerLanguage>;
  value: string;
  onChange: (code: string) => void;
  className?: string | undefined;
}

export const LANGUAGE_PICKER_CLASS_NAME: string =
  "flex items-center gap-1.5 text-sm text-gray-500";

export const LANGUAGE_PICKER_DROPDOWN_CLASS_NAME: string =
  "relative w-44 max-w-full overflow-visible";

export function getLanguagePickerOptions(
  languages: Array<LanguagePickerLanguage>,
): Array<DropdownOption> {
  return languages.map((language: LanguagePickerLanguage): DropdownOption => {
    return {
      value: language.code,
      label: language.nativeName,
      isUserContent: true,
    };
  });
}

const LanguagePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const options: Array<DropdownOption> = getLanguagePickerOptions(
    props.languages,
  );

  return (
    <div
      className={props.className || LANGUAGE_PICKER_CLASS_NAME}
      data-testid="language-picker"
    >
      <Icon
        icon={IconProp.Language}
        size={SizeProp.Small}
        className="h-4 w-4 shrink-0"
      />
      <label htmlFor={props.inputId} className="sr-only">
        {props.label}
      </label>
      <Dropdown
        inputId={props.inputId}
        className={LANGUAGE_PICKER_DROPDOWN_CLASS_NAME}
        options={options}
        value={findDropdownOption(options, props.value)}
        isClearable={false}
        onChange={(next: DropdownValue | Array<DropdownValue> | null): void => {
          const picked: string | null = readPickedDropdownValue(next);

          if (picked !== null && picked !== props.value) {
            props.onChange(picked);
          }
        }}
      />
    </div>
  );
};

export default LanguagePicker;
