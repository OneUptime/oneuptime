import { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import Text from "Common/Types/Text";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface RadioOption extends DropdownOption {}

export type RadioValue = DropdownValue;

export interface ComponentProps {
  options: Array<RadioOption>;
  initialValue?: undefined | RadioValue;
  className?: undefined | string;
  onChange?: undefined | ((value: RadioValue | null) => void);
  value?: RadioValue | undefined;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  tabIndex?: number | undefined;
  error?: string | undefined;
  dataTestId?: string | undefined;
}

const Radio: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [value, setValue] = useState<RadioValue | undefined>(
    props.initialValue || props.value || undefined,
  );

  const groupName: string = Text.generateRandomText();

  return (
    <div
      className={`mt-2 space-y-2 ${props.className}`}
      data-testid={props.dataTestId}
    >
      {props.options.map((option: RadioOption, index: number) => {
        return (
          <div key={index} className="flex items-center gap-x-3">
            <input
              tabIndex={props.tabIndex}
              defaultChecked={value === option.value}
              onClick={() => {
                setValue(option.value);
                props.onChange && props.onChange(option.value);
                props.onBlur && props.onBlur();
                props.onFocus && props.onFocus();
              }}
              name={groupName}
              type="radio"
              className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600"
            />
            <label className="block text-sm font-medium leading-6 text-gray-900">
              {option.label}
            </label>
          </div>
        );
      })}

      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default Radio;
