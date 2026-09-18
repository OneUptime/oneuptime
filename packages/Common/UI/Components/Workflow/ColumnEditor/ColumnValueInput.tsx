/*
 * One value cell.
 *
 * The control comes from the column's type in the model schema, so nobody is
 * asked whether the thing they are typing is Text, Number or Boolean - the
 * model already said. What is left for the builder to choose is the one thing
 * the schema genuinely cannot know: whether this value is typed in, or read
 * from an earlier step at run time.
 */

import Color from "../../../../Types/Color";
import IconProp from "../../../../Types/Icon/IconProp";
import AutocompleteTextInput from "../../AutocompleteTextInput/AutocompleteTextInput";
import { DictionaryFilterOperatorOption } from "../../Dictionary/DictionaryFilterOperator";
import ColorPicker from "../../Forms/Fields/ColorPicker";
import Icon from "../../Icon/Icon";
import Input, { InputType } from "../../Input/Input";
import TextArea from "../../TextArea/TextArea";
import { ColumnValueMode, ModelColumnControl } from "./ColumnRow";
import { containsTemplateExpression } from "./ColumnRowSerialization";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  control: ModelColumnControl;
  valueMode: ColumnValueMode;
  text: string;
  values: Array<string>;
  /** Absent in record mode, where every row is an equality. */
  operatorOption?: DictionaryFilterOperatorOption | undefined;
  placeholder?: string | undefined;
  /** The other steps' return values and the workflow's variables. */
  suggestions?: Array<string> | undefined;
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

const MONO_INPUT_CLASS: string =
  "block w-full rounded-md border-0 bg-transparent py-1 pl-0 pr-0 font-mono text-xs text-indigo-900 placeholder-indigo-300 focus:outline-none focus:ring-0";

const ColumnValueInput: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const isReference: boolean = props.valueMode === ColumnValueMode.Reference;

  type SetTextFunction = (value: string) => void;

  /*
   * Typing "{{" anywhere in a text control means the builder is reaching for
   * another step's output, so the cell becomes a reference there and then and
   * keeps what has been typed. Without this the autocomplete would never open
   * unless the reference button had been found first.
   */
  const setTextAndDetectReference: SetTextFunction = (value: string): void => {
    if (!isReference && value.includes("{{")) {
      props.onChange({ text: value, valueMode: ColumnValueMode.Reference });
      return;
    }

    props.onChange({ text: value });
  };

  /*
   * Spelled "{ }" rather than drawn as an icon. The shared variable glyph is a
   * dashed square that reads as a placeholder or a spinner, and this button has
   * to say what it does at a glance - it is the only route from a typed value to
   * an earlier step's output, which is how most of these payloads are built.
   */
  const referenceButton: ReactElement = (
    <button
      type="button"
      aria-pressed={isReference}
      title={
        isReference
          ? "Type a value instead"
          : "Use a value from an earlier step"
      }
      aria-label={
        isReference
          ? "Type a value instead"
          : "Use a value from an earlier step"
      }
      data-testid={`${props.dataTestId || "model-column"}-reference-toggle`}
      className={`shrink-0 rounded-md border px-1.5 py-1 font-mono text-[11px] leading-none transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
        isReference
          ? "border-indigo-200 bg-white text-indigo-500 hover:bg-indigo-50"
          : "border-transparent text-gray-400 hover:border-gray-200 hover:bg-gray-50 hover:text-gray-600"
      }`}
      onClick={() => {
        props.onChange({
          valueMode: isReference
            ? ColumnValueMode.Literal
            : ColumnValueMode.Reference,
        });
      }}
    >
      {isReference ? "abc" : "{ }"}
    </button>
  );

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

  if (isReference) {
    return (
      <div className="flex w-full items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50/40 px-2 py-1">
        <span className="shrink-0 font-mono text-[11px] text-indigo-400">
          {"{ }"}
        </span>
        <div className="min-w-0 flex-1">
          <AutocompleteTextInput
            value={props.text}
            placeholder="{{local.components.step.returnValues.value}}"
            suggestions={props.suggestions}
            className={MONO_INPUT_CLASS}
            outerDivClassName={INPUT_WRAPPER_CLASS}
            disableSpellCheck={true}
            autoFocus={props.autoFocus}
            ariaLabelledby={props.ariaLabelledby}
            dataTestId={props.dataTestId}
            onChange={(value: string) => {
              props.onChange({ text: value });
            }}
          />
        </div>
        {referenceButton}
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

      case ModelColumnControl.LongText:
        return (
          <TextArea
            value={props.text}
            placeholder={props.placeholder}
            className="block w-full rounded-md border border-gray-300 bg-white py-2 px-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-y min-h-16"
            ariaLabelledby={props.ariaLabelledby}
            dataTestId={props.dataTestId}
            tabIndex={props.tabIndex}
            autoFocus={props.autoFocus}
            onChange={setTextAndDetectReference}
          />
        );

      default:
        return (
          <AutocompleteTextInput
            value={props.text}
            placeholder={props.placeholder}
            suggestions={props.suggestions}
            outerDivClassName={INPUT_WRAPPER_CLASS}
            className={
              props.control === ModelColumnControl.ObjectId
                ? "block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 font-mono text-xs text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                : undefined
            }
            ariaLabelledby={props.ariaLabelledby}
            autoFocus={props.autoFocus}
            dataTestId={props.dataTestId}
            onChange={setTextAndDetectReference}
          />
        );
    }
  };

  return (
    <div className="flex w-full items-center gap-1">
      <div className="min-w-0 flex-1">{renderControl()}</div>
      {referenceButton}
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
