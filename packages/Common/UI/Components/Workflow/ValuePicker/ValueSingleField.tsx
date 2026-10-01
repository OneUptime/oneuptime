/*
 * A setting that holds one value of its own kind - a number, a password, a
 * switch, a date - which can also be taken from an earlier step or a
 * variable.
 *
 * Its own control cannot show a reference (a number box will not hold
 * "{{...}}", and a password box would hide it), so it is one or the other:
 * the control, with { } beside it; or, once a value has been picked, that
 * value as a chip, with a button to type a value again. This is the record
 * editor's typed cells, for a step's own settings.
 */

import Input, { InputType } from "../../Input/Input";
import Toggle from "../../Toggle/Toggle";
import { containsTemplateExpression } from "./TemplateText";
import { ValuePickerContextValue, useValuePicker } from "./ValuePickerContext";
import ValuePickerMenu from "./ValuePickerMenu";
import ValuePickerPopup, {
  ValuePickerCloseReason,
  ValuePickerPopupMode,
} from "./ValuePickerPopup";
import ValueTextField, { INSERT_VALUE_LABEL } from "./ValueTextField";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";

export enum ValueSingleFieldKind {
  Number = "Number",
  Password = "Password",
  Boolean = "Boolean",
  Date = "Date",
  DateTime = "DateTime",
}

export const TYPE_A_VALUE_LABEL: string = "Type a value instead";

const INPUT_TYPE: Partial<Record<ValueSingleFieldKind, InputType>> = {
  [ValueSingleFieldKind.Number]: InputType.NUMBER,
  [ValueSingleFieldKind.Password]: InputType.PASSWORD,
  [ValueSingleFieldKind.Date]: InputType.DATE,
  [ValueSingleFieldKind.DateTime]: InputType.DATETIME_LOCAL,
};

export interface ValueSingleFieldProps {
  kind: ValueSingleFieldKind;
  value: unknown;
  onChange: (value: string | boolean) => void;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  error?: string | undefined;
  autoFocus?: boolean | undefined;
  tabIndex?: number | undefined;
  disabled?: boolean | undefined;
  dataTestId?: string | undefined;
  onBlur?: (() => void) | undefined;
}

const ValueSingleField: FunctionComponent<ValueSingleFieldProps> = (
  props: ValueSingleFieldProps,
): ReactElement => {
  const picker: ValuePickerContextValue = useValuePicker();
  const dataTestId: string = props.dataTestId || "value-single-field";

  const boxRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState<boolean>(false);

  const canPick: boolean = picker.isAvailable && !props.disabled;
  const holdsReference: boolean = containsTemplateExpression(props.value);

  if (holdsReference) {
    return (
      <div className="flex w-full items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <ValueTextField
            value={props.value}
            onChange={(value: string) => {
              props.onChange(value);
            }}
            multiline={false}
            ariaLabelledby={props.ariaLabelledby}
            error={props.error}
            autoFocus={props.autoFocus}
            tabIndex={props.tabIndex}
            disabled={props.disabled}
            dataTestId={dataTestId}
            onBlur={props.onBlur}
          />
        </div>
        {!props.disabled && (
          <button
            type="button"
            className="mt-1 shrink-0 rounded-md border border-gray-200 px-1.5 py-1 font-mono text-[11px] leading-none text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            aria-label={TYPE_A_VALUE_LABEL}
            title={TYPE_A_VALUE_LABEL}
            data-testid={`${dataTestId}-type-a-value`}
            onClick={() => {
              props.onChange(
                props.kind === ValueSingleFieldKind.Boolean ? false : "",
              );
            }}
          >
            abc
          </button>
        )}
      </div>
    );
  }

  const insertButton: ReactElement | null = canPick ? (
    <button
      type="button"
      className={`shrink-0 rounded px-1.5 py-1 font-mono text-[11px] leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        isPopoverOpen
          ? "bg-indigo-50 text-indigo-600"
          : "text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
      }`}
      aria-label={INSERT_VALUE_LABEL}
      title={INSERT_VALUE_LABEL}
      aria-haspopup="dialog"
      aria-expanded={isPopoverOpen}
      data-testid={`${dataTestId}-insert-value`}
      onClick={() => {
        setIsPopoverOpen(!isPopoverOpen);
      }}
    >
      {"{ }"}
    </button>
  ) : null;

  return (
    <div className="w-full">
      <div ref={boxRef} className="flex w-full items-center gap-1.5">
        <div className="min-w-0 flex-1">
          {props.kind === ValueSingleFieldKind.Boolean ? (
            <Toggle
              value={props.value === true || props.value === "true"}
              onChange={(value: boolean) => {
                props.onChange(value);
              }}
              ariaLabelledby={props.ariaLabelledby}
              error={props.error}
              dataTestId={dataTestId}
              onBlur={() => {
                props.onBlur?.();
              }}
            />
          ) : (
            <Input
              type={INPUT_TYPE[props.kind] || InputType.TEXT}
              value={
                props.value === undefined || props.value === null
                  ? ""
                  : String(props.value)
              }
              placeholder={props.placeholder}
              ariaLabelledby={props.ariaLabelledby}
              error={props.error}
              autoFocus={props.autoFocus}
              tabIndex={props.tabIndex}
              disabled={props.disabled}
              dataTestId={dataTestId}
              outerDivClassName="relative w-full"
              onChange={(value: string) => {
                props.onChange(value);
              }}
              onBlur={props.onBlur}
            />
          )}
        </div>
        {insertButton}
      </div>

      {isPopoverOpen && (
        <ValuePickerPopup
          anchorRef={boxRef}
          mode={ValuePickerPopupMode.Popover}
          ariaLabel="Use a value"
          onClose={(reason: ValuePickerCloseReason) => {
            setIsPopoverOpen(false);

            if (reason !== ValuePickerCloseReason.Outside) {
              boxRef.current
                ?.querySelector<HTMLElement>(
                  `[data-testid="${dataTestId}-insert-value"]`,
                )
                ?.focus();
            }
          }}
        >
          <ValuePickerMenu
            hasSearchBox={true}
            onPick={(reference: string) => {
              setIsPopoverOpen(false);
              // The control cannot hold a reference: the value becomes it.
              props.onChange(reference);
            }}
          />
        </ValuePickerPopup>
      )}
    </div>
  );
};

export default ValueSingleField;
