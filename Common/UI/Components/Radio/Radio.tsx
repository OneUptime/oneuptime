import { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import Text from "../../../Types/Text";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useState,
} from "react";

export type RadioOption = DropdownOption;

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
  ariaLabel?: string | undefined;
}

const Radio: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const uniqueId: string = useId();
  const errorId: string = `radio-error-${uniqueId}`;
  const [value, setValue] = useState<RadioValue | undefined>(
    props.initialValue || props.value || undefined,
  );

  useEffect(() => {
    setValue(props.value);
  }, [props.value]);

  const groupName: string = Text.generateRandomText();

  return (
    <div
      className={`mt-2 space-y-2 ${props.className}`}
      data-testid={props.dataTestId}
      role="radiogroup"
      aria-label={props.ariaLabel}
      aria-invalid={props.error ? "true" : undefined}
      aria-describedby={props.error ? errorId : undefined}
    >
      {props.options.map((option: RadioOption, index: number) => {
        const optionId: string = `${groupName}-option-${index}`;
        return (
          <div key={index} className="flex items-center gap-x-3">
            <input
              id={optionId}
              tabIndex={props.tabIndex}
              checked={value === option.value}
              onChange={() => {
                setValue(option.value);
                if (props.onChange) {
                  props.onChange(option.value);
                }
                if (props.onBlur) {
                  props.onBlur();
                }
                if (props.onFocus) {
                  props.onFocus();
                }
              }}
              name={groupName}
              type="radio"
              className="h-4 w-4 border-gray-300 text-indigo-600 focus:ring-indigo-600"
            />
            <label
              htmlFor={optionId}
              className="block text-sm font-medium leading-6 text-gray-900"
            >
              {option.label}
            </label>
          </div>
        );
      })}

      {props.error && (
        <p
          id={errorId}
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
          role="alert"
        >
          {props.error}
        </p>
      )}
    </div>
  );
};

export default Radio;
