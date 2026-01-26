// Tailwind
import { Logger } from "../../Utils/Logger";
import Icon from "../Icon/Icon";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export enum InputType {
  TEXT = "text",
  NUMBER = "number",
  DATE = "date",
  DATETIME_LOCAL = "datetime-local",
  URL = "url",
  TIME = "time",
}

export interface ComponentProps {
  initialValue?: undefined | string | Date;
  onClick?: undefined | (() => void);
  placeholder?: undefined | string;
  className?: undefined | string;
  onChange?: undefined | ((value: string) => void);
  value?: string | Date | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  type?: InputType;
  onFocus?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  tabIndex?: number | undefined;
  onEnterPress?: (() => void) | undefined;
  error?: string | undefined;
  outerDivClassName?: string | undefined;
  autoFocus?: boolean | undefined;
  disableSpellCheck?: boolean | undefined;
  showSecondsForDateTime?: boolean | undefined;
  autoComplete?: string | undefined;
}

const Input: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  let className: string = "";

  if (!props.className) {
    className =
      "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";
  } else {
    className = props.className;
  }

  if (props.error) {
    className +=
      " border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500";
  }

  if (props.disabled) {
    className += " bg-gray-100 text-gray-500 cursor-not-allowed";
  }

  const [value, setValue] = useState<string | Date>("");
  const [displayValue, setDisplayValue] = useState<string>("");
  const ref: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (
      props.type === InputType.DATE ||
      props.type === InputType.DATETIME_LOCAL
    ) {
      if (value && (value as unknown) instanceof Date) {
        let dateString: string = "";
        try {
          if (props.type === InputType.DATETIME_LOCAL) {
            dateString = OneUptimeDate.toDateTimeLocalString(value as any);
          } else {
            dateString = OneUptimeDate.asDateForDatabaseQuery(value);
          }
        } catch (e: any) {
          Logger.error(e);
        }
        setDisplayValue(dateString);
      } else if (
        value &&
        (value as any).includes &&
        !(value as any).includes(" - ")
      ) {
        // " - " is for InBetween dates.
        const date: Date = OneUptimeDate.fromString(value);
        let dateString: string = "";
        try {
          if (props.type === InputType.DATETIME_LOCAL) {
            dateString = OneUptimeDate.toDateTimeLocalString(date);
          } else {
            dateString = OneUptimeDate.asDateForDatabaseQuery(date);
          }
        } catch (err: any) {
          Logger.error(err);
        }
        setDisplayValue(dateString);
      } else if (
        !value ||
        ((value as any).includes && !(value as any).includes(" - "))
      ) {
        setDisplayValue("");
      }
    } else {
      setDisplayValue(value as string);
    }
  }, [value]);

  useEffect(() => {
    const input: HTMLInputElement | null = ref.current;
    if (input) {
      input.value = displayValue;
    }
  }, [ref, displayValue]);

  useEffect(() => {
    if (props.initialValue) {
      setValue(props.initialValue);
    }

    if (props.value) {
      setValue(props.value);
    }
  }, []);

  useEffect(() => {
    if (props.initialValue) {
      setValue(props.initialValue);
    }
  }, [props.initialValue]);

  useEffect(() => {
    setValue(props.value ? props.value : props.initialValue || "");
  }, [props.value]);

  return (
    <>
      <div
        className={
          props.outerDivClassName ||
          `relative mt-2 mb-1 rounded-md shadow-sm w-full`
        }
      >
        <input
          autoFocus={props.autoFocus}
          ref={ref}
          onFocus={props.onFocus}
          onClick={props.onClick}
          data-testid={props.dataTestId}
          spellCheck={!props.disableSpellCheck}
          autoComplete={props.autoComplete}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={props.error ? "input-error-message" : undefined}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const value: string | Date = e.target.value;

            if (
              (props.type === InputType.DATE ||
                props.type === InputType.DATETIME_LOCAL) &&
              value
            ) {
              const date: Date = OneUptimeDate.fromString(value);
              const dateString: string = OneUptimeDate.toString(date);
              setValue(dateString);
              if (props.onChange) {
                props.onChange(dateString);
              }
            } else {
              setValue(value);
              if (props.onChange) {
                props.onChange(value);
              }
            }
          }}
          tabIndex={props.tabIndex}
          onKeyDown={
            props.onEnterPress
              ? (event: React.KeyboardEvent<HTMLInputElement>) => {
                  if (event.key === "Enter") {
                    props.onEnterPress?.();
                  }
                }
              : undefined
          }
          readOnly={props.readOnly || props.disabled || false}
          type={props.type || "text"}
          step={
            props.type === InputType.DATETIME_LOCAL &&
            props.showSecondsForDateTime
              ? "1"
              : undefined
          }
          placeholder={props.placeholder}
          className={className}
          onBlur={() => {
            if (props.onBlur) {
              props.onBlur();
            }
          }}
        />

        {props.error && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3" aria-hidden="true">
            <Icon icon={IconProp.ErrorSolid} className="h-5 w-5 text-red-500" />
          </div>
        )}
      </div>

      {props.error && (
        <p id="input-error-message" data-testid="error-message" className="mt-1 text-sm text-red-400" role="alert">
          {props.error}
        </p>
      )}
    </>
  );
};

export default Input;
