/*
 * One value cell.
 *
 * The control comes from the column's type in the model schema, so nobody is
 * asked whether the thing they are typing is Text, Number or Boolean - the
 * model already said. A value can also come from an earlier step or a
 * variable, through the same picker every other workflow setting has:
 *
 * - a text cell is the chip editor, so a title can be "Alert: " followed by
 *   the webhook's alert name, shown as a chip;
 * - a number, a switch, a date or a colour keeps its control, with { }
 *   beside it, and a picked value replaces it as a chip, with "abc" to type a
 *   value again.
 */

import Color from "../../../../Types/Color";
import IconProp from "../../../../Types/Icon/IconProp";
import { DictionaryFilterOperatorOption } from "../../Dictionary/DictionaryFilterOperator";
import ColorPicker from "../../Forms/Fields/ColorPicker";
import Icon from "../../Icon/Icon";
import Input, { InputType } from "../../Input/Input";
import { ValuePickerContextValue, useValuePicker } from "../ValuePicker/ValuePickerContext";
import ValuePickerMenu from "../ValuePicker/ValuePickerMenu";
import ValuePickerPopup, {
  ValuePickerCloseReason,
  ValuePickerPopupMode,
} from "../ValuePicker/ValuePickerPopup";
import { TYPE_A_VALUE_LABEL } from "../ValuePicker/ValueSingleField";
import ValueTextField, {
  INSERT_VALUE_BUTTON_CLASS,
  INSERT_VALUE_BUTTON_IDLE_CLASS,
  INSERT_VALUE_BUTTON_OPEN_CLASS,
  INSERT_VALUE_LABEL,
} from "../ValuePicker/ValueTextField";
import { ColumnValueMode, ModelColumnControl } from "./ColumnRow";
import { containsTemplateExpression } from "./ColumnRowSerialization";
import React, { FunctionComponent, ReactElement, useRef, useState } from "react";

export interface ComponentProps {
  control: ModelColumnControl;
  valueMode: ColumnValueMode;
  text: string;
  values: Array<string>;
  /** Absent in record mode, where every row is an equality. */
  operatorOption?: DictionaryFilterOperatorOption | undefined;
  placeholder?: string | undefined;
  /**
   * Every edit reports as one change.
   *
   * Deliberately not three callbacks: two of them fired from a single event
   * both close over the same render's row, so the second silently discards the
   * first - which is what made a raw cell impossible to type into and the
   * "typing {{ turns this into a reference" behaviour dead.
   */
  onChange: (
    change: Partial<{
      text: string;
      values: Array<string>;
      valueMode: ColumnValueMode;
    }>,
  ) => void;
  tabIndex?: number | undefined;
  ariaLabelledby?: string | undefined;
  /** Focused on mount, so picking a field lands the caret in its value box. */
  autoFocus?: boolean | undefined;
  dataTestId?: string | undefined;
}

const INPUT_WRAPPER_CLASS: string = "relative w-full";

/*
 * Text of any kind: the cell is the chip editor in every mode, so there is
 * nothing to switch between - a reference is just part of the text.
 */
const TEXT_CONTROLS: Array<ModelColumnControl> = [
  ModelColumnControl.Text,
  ModelColumnControl.LongText,
  ModelColumnControl.ObjectId,
  ModelColumnControl.Unsupported,
];

const ColumnValueInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const picker: ValuePickerContextValue = useValuePicker();
  const isReference: boolean = props.valueMode === ColumnValueMode.Reference;
  const dataTestId: string = props.dataTestId || "model-column";
  const cellRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);

  type SetTextFunction = (value: string) => void;

  /*
   * A text cell holding a {{ }} reference is a reference: it is written as the
   * string it is, whatever the column's type.
   */
  const setTextAndDetectReference: SetTextFunction = (value: string): void => {
    props.onChange({
      text: value,
      valueMode: containsTemplateExpression(value)
        ? ColumnValueMode.Reference
        : ColumnValueMode.Literal,
    });
  };

  /*
   * Spelled "{ }" rather than drawn as an icon, as in every other workflow
   * setting: the shared variable glyph is a dashed square that reads as a
   * placeholder or a spinner.
   */
  const insertValueButton: ReactElement | null = picker.isAvailable ? (
    <button
      type="button"
      aria-label={INSERT_VALUE_LABEL}
      title={INSERT_VALUE_LABEL}
      aria-haspopup="dialog"
      aria-expanded={isPickerOpen}
      data-testid={`${dataTestId}-insert-value`}
      className={`${INSERT_VALUE_BUTTON_CLASS} ${
        isPickerOpen
          ? INSERT_VALUE_BUTTON_OPEN_CLASS
          : INSERT_VALUE_BUTTON_IDLE_CLASS
      }`}
      onClick={() => {
        setIsPickerOpen(!isPickerOpen);
      }}
    >
      {"{ }"}
    </button>
  ) : null;

  // Back to the column's own control, empty: it cannot show the reference.
  const typeAValueButton: ReactElement = (
    <button
      type="button"
      aria-label={TYPE_A_VALUE_LABEL}
      title={TYPE_A_VALUE_LABEL}
      data-testid={`${dataTestId}-type-a-value`}
      className="mt-0.5 shrink-0 rounded-md border border-gray-200 px-1.5 py-1 font-mono text-[11px] leading-none text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      onClick={() => {
        props.onChange({ valueMode: ColumnValueMode.Literal, text: "" });
      }}
    >
      abc
    </button>
  );

  const pickerPopup: ReactElement | null = isPickerOpen ? (
    <ValuePickerPopup
      anchorRef={cellRef}
      mode={ValuePickerPopupMode.Popover}
      ariaLabel="Use a value"
      onClose={(reason: ValuePickerCloseReason) => {
        setIsPickerOpen(false);

        if (reason !== ValuePickerCloseReason.Outside) {
          cellRef.current
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
          setIsPickerOpen(false);
          props.onChange({
            text: reference,
            valueMode: ColumnValueMode.Reference,
          });
        }}
      />
    </ValuePickerPopup>
  ) : null;

  // An operator like "is not set" takes no value at all.
  if (props.operatorOption?.hidesValueInput) {
    return (
      <div className="flex h-9 items-center rounded-md border border-dashed border-gray-200 px-3 text-xs text-gray-400">
        No value needed
      </div>
    );
  }

  if (props.operatorOption?.expectsMultiValue) {
    return (
      <MultiValueInput
        values={props.values}
        placeholder={props.placeholder}
        ariaLabelledby={props.ariaLabelledby}
        dataTestId={props.dataTestId}
        onChange={(values: Array<string>) => {
          props.onChange({ values: values });
        }}
      />
    );
  }

  const isTextControl: boolean = TEXT_CONTROLS.includes(props.control);

  /*
   * Text, typed or with references in it. Kept-raw values are the exception:
   * they keep the plain box below until they are edited.
   */
  if (isTextControl && props.valueMode !== ColumnValueMode.Raw) {
    return (
      <ValueTextField
        value={props.text}
        multiline={props.control === ModelColumnControl.LongText}
        monospace={props.control === ModelColumnControl.ObjectId}
        placeholder={props.placeholder}
        ariaLabelledby={props.ariaLabelledby}
        autoFocus={props.autoFocus}
        dataTestId={dataTestId}
        isCompact={true}
        onChange={setTextAndDetectReference}
      />
    );
  }

  // A typed column holding a value from an earlier step: the value, as a chip.
  if (isReference) {
    return (
      <div className="flex w-full items-start gap-1">
        <div className="min-w-0 flex-1">
          <ValueTextField
            value={props.text}
            multiline={false}
            ariaLabelledby={props.ariaLabelledby}
            autoFocus={props.autoFocus}
            dataTestId={dataTestId}
            isCompact={true}
            onChange={(value: string) => {
              props.onChange({ text: value });
            }}
          />
        </div>
        {typeAValueButton}
      </div>
    );
  }

  type RenderControlFunction = () => ReactElement;

  const renderControl: RenderControlFunction = (): ReactElement => {
    /*
     * A value the typed control cannot hold - text where the column wants a
     * number, most often - is edited as text and written back exactly as it
     * was read. Forcing it through the typed control would rewrite it.
     */
    if (props.valueMode === ColumnValueMode.Raw) {
      return (
        <Input
          value={props.text}
          placeholder={props.placeholder}
          outerDivClassName={INPUT_WRAPPER_CLASS}
          ariaLabelledby={props.ariaLabelledby}
          dataTestId={props.dataTestId}
          tabIndex={props.tabIndex}
          autoFocus={props.autoFocus}
          onChange={(value: string) => {
            /*
             * The first keystroke ends raw mode: what is in the box is now what
             * the builder means, so it is written in the column's own type. The
             * mode and the text move together in one change - reported
             * separately, the second report would overwrite the first and the
             * cell could never be typed into at all.
             */
            props.onChange({
              text: value,
              valueMode: value.includes("{{")
                ? ColumnValueMode.Reference
                : ColumnValueMode.Literal,
            });
          }}
        />
      );
    }

    switch (props.control) {
      case ModelColumnControl.Boolean:
        return (
          <BooleanSegments
            value={props.text}
            ariaLabelledby={props.ariaLabelledby}
            autoFocus={props.autoFocus}
            dataTestId={props.dataTestId}
            onChange={(value: string) => {
              props.onChange({ text: value });
            }}
          />
        );

      case ModelColumnControl.Number:
        return (
          <Input
            type={InputType.NUMBER}
            value={props.text}
            placeholder={props.placeholder || "0"}
            outerDivClassName={INPUT_WRAPPER_CLASS}
            ariaLabelledby={props.ariaLabelledby}
            dataTestId={props.dataTestId}
            tabIndex={props.tabIndex}
            autoFocus={props.autoFocus}
            onChange={(value: string) => {
              props.onChange({ text: value });
            }}
          />
        );

      case ModelColumnControl.Date:
        return (
          <Input
            type={InputType.DATETIME_LOCAL}
            value={props.text}
            outerDivClassName={INPUT_WRAPPER_CLASS}
            ariaLabelledby={props.ariaLabelledby}
            dataTestId={props.dataTestId}
            tabIndex={props.tabIndex}
            autoFocus={props.autoFocus}
            onChange={(value: string) => {
              props.onChange({ text: value });
            }}
          />
        );

      case ModelColumnControl.Color:
        return (
          <ColorPicker
            value={props.text}
            placeholder={props.placeholder || "#000000"}
            ariaLabelledby={props.ariaLabelledby}
            dataTestId={props.dataTestId}
            tabIndex={props.tabIndex}
            onChange={(value: Color | null) => {
              props.onChange({ text: value ? value.toString() : "" });
            }}
          />
        );

      default:
        // Text kept raw: the plain box, until it is edited.
        return (
          <Input
            value={props.text}
            placeholder={props.placeholder}
            outerDivClassName={INPUT_WRAPPER_CLASS}
            ariaLabelledby={props.ariaLabelledby}
            dataTestId={props.dataTestId}
            tabIndex={props.tabIndex}
            autoFocus={props.autoFocus}
            onChange={setTextAndDetectReference}
          />
        );
    }
  };

  return (
    <div ref={cellRef} className="flex w-full items-center gap-1">
      <div className="min-w-0 flex-1">{renderControl()}</div>
      {props.valueMode === ColumnValueMode.Raw ? null : insertValueButton}
      {pickerPopup}
    </div>
  );
};

interface BooleanSegmentsProps {
  value: string;
  ariaLabelledby?: string | undefined;
  autoFocus?: boolean | undefined;
  dataTestId?: string | undefined;
  onChange: (value: string) => void;
}

/*
 * Three states, not two. A boolean column with nothing typed into it is not
 * "false" - it is a field the record does not set, and a toggle cannot say
 * that. (The shared Toggle component also fires its onChange twice per click.)
 */
const BooleanSegments: FunctionComponent<BooleanSegmentsProps> = (
  props: BooleanSegmentsProps,
): ReactElement => {
  const segments: Array<{ label: string; value: string }> = [
    { label: "True", value: "true" },
    { label: "False", value: "false" },
    { label: "Not set", value: "" },
  ];

  return (
    <div
      className="inline-flex rounded-md border border-gray-300 bg-white p-0.5"
      role="group"
      aria-labelledby={props.ariaLabelledby}
      data-testid={props.dataTestId}
    >
      {segments.map((segment: { label: string; value: string }) => {
        const isSelected: boolean = props.value === segment.value;

        return (
          <button
            key={segment.label}
            type="button"
            autoFocus={props.autoFocus && segment.value === "true"}
            aria-pressed={isSelected}
            className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              isSelected
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-500 hover:text-gray-700"
            }`}
            onClick={() => {
              props.onChange(segment.value);
            }}
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
};

interface MultiValueInputProps {
  values: Array<string>;
  placeholder?: string | undefined;
  ariaLabelledby?: string | undefined;
  dataTestId?: string | undefined;
  onChange: (values: Array<string>) => void;
}

/*
 * "is any of" holds a list. The previous editor rendered a multi-select whose
 * options were only ever the suggestions it had been handed, so a value nobody
 * had suggested could not be entered at all - which for a list of IDs is every
 * value. This is a chip input: type, press Enter or comma, and it is in.
 */
const MultiValueInput: FunctionComponent<MultiValueInputProps> = (
  props: MultiValueInputProps,
): ReactElement => {
  const [draft, setDraft] = React.useState<string>("");

  type CommitDraftFunction = () => void;

  const commitDraft: CommitDraftFunction = (): void => {
    const entry: string = draft.trim();

    if (entry === "" || props.values.includes(entry)) {
      setDraft("");
      return;
    }

    props.onChange([...props.values, entry]);
    setDraft("");
  };

  return (
    <div className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5">
      {props.values.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {props.values.map((value: string, index: number) => {
            return (
              <span
                key={`${value}-${index}`}
                className="inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700"
              >
                {containsTemplateExpression(value) ? (
                  <span className="font-mono text-indigo-600">{value}</span>
                ) : (
                  value
                )}
                <button
                  type="button"
                  aria-label={`Remove ${value}`}
                  className="text-gray-400 hover:text-gray-600"
                  onClick={() => {
                    props.onChange(
                      props.values.filter((_entry: string, i: number) => {
                        return i !== index;
                      }),
                    );
                  }}
                >
                  <Icon icon={IconProp.Close} className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <input
        type="text"
        value={draft}
        aria-labelledby={props.ariaLabelledby}
        data-testid={props.dataTestId}
        placeholder={props.placeholder || "Type a value and press Enter"}
        className="block w-full border-0 p-0 text-sm placeholder-gray-400 focus:outline-none focus:ring-0"
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const value: string = event.target.value;

          if (value.endsWith(",")) {
            setDraft(value.slice(0, -1));
            /*
             * setDraft is async, so commit from the typed text rather than from
             * state, which still holds the previous keystroke here.
             */
            const entry: string = value.slice(0, -1).trim();

            if (entry !== "" && !props.values.includes(entry)) {
              props.onChange([...props.values, entry]);
            }

            setDraft("");
            return;
          }

          setDraft(value);
        }}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
            return;
          }

          if (
            event.key === "Backspace" &&
            draft === "" &&
            props.values.length > 0
          ) {
            props.onChange(props.values.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
      />
    </div>
  );
};

export default ColumnValueInput;
