import FieldError from "../Forms/Fields/FieldError";
import { DropdownOption, DropdownValue } from "../Dropdown/Dropdown";
import joinAriaIds from "../../Utils/AriaIds";
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
  ariaLabelledby?: string | undefined;
  // What describes the choice besides its error, read first: its field's help.
  ariaDescribedby?: string | undefined;
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
      aria-labelledby={props.ariaLabelledby}
      aria-invalid={props.error ? "true" : undefined}
      aria-describedby={joinAriaIds(
        props.ariaDescribedby,
        props.error ? errorId : undefined,
      )}
    >
      {props.options.map((option: RadioOption, index: number) => {
        const optionId: string = `${groupName}-option-${index}`;
        /*
         * An option may say in one line what picking it means ("Signs in as
         * the account the probe runs as."). It sits under the option's own
         * label, so a choice of modes reads as plain options rather than a
         * switch whose help explains both, and the line describes the radio.
         *
         * The radio sits level with its label's first line, and never
         * shrinks: a label long enough to wrap ("Payments platform
         * engineering managers, EU and US regions (Level 3 of 3)" on a
         * phone) squeezed a centred radio to a dot halfway down its two
         * lines. A one-line label reads as it always did: mt-1 centres the
         * radio on its leading-6 line.
         */
        const descriptionId: string = `${optionId}-description`;
        const hasDescription: boolean = Boolean(option.description);
        return (
          <div key={index} className="flex items-start gap-x-3">
            <input
              id={optionId}
              tabIndex={props.tabIndex}
              aria-describedby={hasDescription ? descriptionId : undefined}
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
              /*
               * accent-indigo-600 is what colours the browser's own radio:
               * the text- and ring- classes are for the Tailwind forms
               * plugin, which the product does not load, so a checked radio
               * was the browser's blue beside the indigo ones of the same
               * form ("All incidents" over a rule's Match Condition).
               */
              className="mt-1 h-4 w-4 flex-none border-gray-300 text-indigo-600 accent-indigo-600 focus:ring-indigo-600"
            />
            {hasDescription ? (
              <div className="min-w-0">
                <label
                  htmlFor={optionId}
                  className="block text-sm font-medium leading-6 text-gray-900"
                >
                  {option.label}
                </label>
                <p id={descriptionId} className="text-sm text-gray-500">
                  {option.description}
                </p>
              </div>
            ) : (
              <label
                htmlFor={optionId}
                className="block min-w-0 break-words text-sm font-medium leading-6 text-gray-900"
              >
                {option.label}
              </label>
            )}
          </div>
        );
      })}

      {props.error && <FieldError id={errorId} message={props.error} />}
    </div>
  );
};

export default Radio;
