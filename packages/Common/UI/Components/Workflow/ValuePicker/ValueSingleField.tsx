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
 *
 * A switch draws its name and help beside it, the way every switch field in
 * a form does, with { } at the end of that row. Given a title, the field
 * labels itself in every state: the switch by its title, and the box a picked
 * value shows in by the same title above it.
 */

import FieldLabelElement from "../../Forms/Fields/FieldLabel";
import Input, { InputType } from "../../Input/Input";
import Toggle from "../../Toggle/Toggle";
import { containsTemplateExpression } from "./TemplateText";
import { ValuePickerContextValue, useValuePicker } from "./ValuePickerContext";
import ValuePickerMenu from "./ValuePickerMenu";
import ValuePickerPopup, {
  ValuePickerCloseReason,
  ValuePickerPopupMode,
} from "./ValuePickerPopup";
import ValueTextField, {
  INSERT_VALUE_BUTTON_CLASS,
  INSERT_VALUE_BUTTON_IDLE_CLASS,
  INSERT_VALUE_BUTTON_OPEN_CLASS,
  INSERT_VALUE_LABEL,
} from "./ValueTextField";
import React, {
  FunctionComponent,
  ReactElement,
  useId,
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
  /*
   * The setting's name and help, for a field whose form draws no label for
   * it (Field.customElementDrawsOwnLabel): beside a switch, as a switch field
   * has them, and above anything else. Like a switch field's, the name says
   * nothing about being optional. Without a title, the label is the
   * caller's, and ariaLabelledby points at it.
   */
  title?: string | undefined;
  description?: string | ReactElement | undefined;
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
  const isSwitch: boolean = props.kind === ValueSingleFieldKind.Boolean;

  const labelId: string = `value-single-field-label-${useId()}`;
  const hasOwnLabel: boolean = Boolean(props.title);
  const ariaLabelledby: string | undefined = hasOwnLabel
    ? labelId
    : props.ariaLabelledby;

  type WithLabelFunction = (control: ReactElement) => ReactElement;

  // The title above a box, as FormField would have drawn it.
  const withLabel: WithLabelFunction = (
    control: ReactElement,
  ): ReactElement => {
    if (!hasOwnLabel) {
      return control;
    }

    return (
      <div className="w-full">
        <FieldLabelElement
          title={props.title || ""}
          id={labelId}
          description={props.description}
          hideOptionalLabel={true}
        />
        <div className="mt-2">{control}</div>
      </div>
    );
  };

  if (holdsReference) {
    return withLabel(
      <div className="flex w-full items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <ValueTextField
            value={props.value}
            onChange={(value: string) => {
              props.onChange(value);
            }}
            multiline={false}
            ariaLabelledby={ariaLabelledby}
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
      </div>,
    );
  }

  const insertButton: ReactElement | null = canPick ? (
    <button
      type="button"
      className={`${INSERT_VALUE_BUTTON_CLASS} ${
        isPopoverOpen
          ? INSERT_VALUE_BUTTON_OPEN_CLASS
          : INSERT_VALUE_BUTTON_IDLE_CLASS
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

  /*
   * A switch's row starts at the top: its title and help sit beside it, and
   * { } lines up with the switch rather than with the middle of the help.
   */
  const control: ReactElement = (
    <div className="w-full">
      <div
        ref={boxRef}
        className={`flex w-full gap-1.5 ${
          isSwitch ? "items-start" : "items-center"
        }`}
      >
        <div className="min-w-0 flex-1">
          {isSwitch ? (
            <Toggle
              value={props.value === true || props.value === "true"}
              onChange={(value: boolean) => {
                props.onChange(value);
              }}
              title={props.title}
              description={props.description}
              ariaLabelledby={hasOwnLabel ? undefined : props.ariaLabelledby}
              error={props.error}
              disabled={props.disabled}
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
              ariaLabelledby={ariaLabelledby}
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

  // A switch labels itself, beside it; anything else under its title.
  return isSwitch ? control : withLabel(control);
};

export default ValueSingleField;
