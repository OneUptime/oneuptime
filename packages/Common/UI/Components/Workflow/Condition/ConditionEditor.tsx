/*
 * The If / Else step's settings, as the sentence they make:
 *
 *   If [value to check  { }]
 *      [is equal to ▾] [production  { }]
 *   ▸ Compare as  Text
 *   Yes  when Webhook › Request Body › environment is equal to “production”.
 *   No   otherwise.
 *
 * The maintainer found the old form "extremely hard to understand and use":
 * five stacked fields called Input 1 Type, Input 1, Operator, Input 2 Type and
 * Input 2, two of them asking for a type (Text, Boolean, Number, Null,
 * Undefined) before anything was compared, and nothing saying what Yes and No
 * mean. Now both values are value pickers, the comparison is said in words,
 * how the values are compared is chosen for you (and can be changed under
 * Compare as), and the condition is read back as a sentence that says where
 * the workflow goes.
 *
 * It edits the same stored settings as before (see ConditionModel), so every
 * existing workflow opens as it is and runs as it did.
 */

import CollapsibleSection from "../../CollapsibleSection/CollapsibleSection";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "../../Dropdown/Dropdown";
import Icon from "../../Icon/Icon";
import { ReferenceChip } from "../ValuePicker/ReferenceChip";
import {
  ValuePickerContextValue,
  useValuePicker,
} from "../ValuePicker/ValuePickerContext";
import ValueTextField from "../ValuePicker/ValueTextField";
import {
  COMPARE_AS_LABEL,
  COMPARE_WITH_LABEL,
  COMPARISON_LABEL,
  ComparisonChange,
  ConditionErrors,
  ConditionNote,
  ConditionNoteTone,
  ConditionPhrasePart,
  ConditionPhrasePartKind,
  ConditionState,
  VALUE_TO_CHECK_LABEL,
  describeConditionMet,
  getConditionNotes,
  hasConditionErrors,
  patchForCompareAs,
  patchForComparison,
  patchForDefaults,
  readConditionState,
  showsCompareAs,
  validateCondition,
} from "./ConditionModel";
import IconProp from "../../../../Types/Icon/IconProp";
import { JSONObject } from "../../../../Types/JSON";
import {
  CONDITION_ARGUMENT_IDS,
  ConditionValueType,
} from "../../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARE_AS_OPTIONS,
  CONDITION_COMPARISON_GROUPS,
  ConditionCompareAsOption,
  ConditionComparisonGroup,
  ConditionComparisonId,
  getConditionComparison,
} from "../../../../Types/Workflow/Components/ConditionComparison";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface ConditionEditorProps {
  // The step's settings as stored.
  arguments: JSONObject | undefined;
  // The settings to write, merged into the stored ones.
  onChange: (patch: JSONObject) => void;
  // Whether something must be filled in before the step can be saved.
  onValidationChange: (hasErrors: boolean) => void;
}

// The test id of each part, `workflow-argument-<id>` as every setting has.
export const CONDITION_TEST_IDS: {
  readonly root: string;
  readonly valueToCheck: string;
  readonly comparison: string;
  readonly compareWith: string;
  readonly compareAs: string;
  readonly summary: string;
  readonly notes: string;
} = {
  root: "if-else-condition",
  valueToCheck: `workflow-argument-${CONDITION_ARGUMENT_IDS.valueToCheck}`,
  comparison: `workflow-argument-${CONDITION_ARGUMENT_IDS.comparison}`,
  compareWith: `workflow-argument-${CONDITION_ARGUMENT_IDS.compareWith}`,
  compareAs: "if-else-compare-as",
  summary: "if-else-summary",
  notes: "if-else-notes",
};

export const CHOOSE_FROM_LIST_LABEL: string = "Choose from the list instead";

const COMPARISON_OPTIONS: Array<DropdownOption | DropdownOptionGroup> =
  CONDITION_COMPARISON_GROUPS.flatMap(
    (
      group: ConditionComparisonGroup,
    ): Array<DropdownOption | DropdownOptionGroup> => {
      const options: Array<DropdownOption> = group.ids.map(
        (id: ConditionComparisonId): DropdownOption => {
          return { value: id, label: getConditionComparison(id).label };
        },
      );

      return group.title ? [{ label: group.title, options: options }] : options;
    },
  );

const COMPARE_WITH_PLACEHOLDER: Record<ConditionValueType, string> = {
  [ConditionValueType.Text]: "e.g. production",
  [ConditionValueType.Number]: "e.g. 200",
  [ConditionValueType.Boolean]: "true or false",
  [ConditionValueType.Null]: "e.g. production",
  [ConditionValueType.Undefined]: "e.g. production",
};

interface Touched {
  valueToCheck?: boolean | undefined;
  comparison?: boolean | undefined;
  compareWith?: boolean | undefined;
}

const ConditionEditor: FunctionComponent<ConditionEditorProps> = (
  props: ConditionEditorProps,
): ReactElement => {
  const picker: ValuePickerContextValue = useValuePicker();
  const compareAsName: string = `if-else-compare-as-${useId()}`;

  const state: ConditionState = readConditionState(props.arguments);
  const errors: ConditionErrors = validateCondition(state);
  const hasErrors: boolean = hasConditionErrors(errors);
  const notes: Array<ConditionNote> = getConditionNotes(state);

  const [touched, setTouched] = useState<Touched>({});

  type MarkTouchedFunction = (field: keyof Touched) => void;

  // An error shows under a field once it has been left, as in every form.
  const markTouched: MarkTouchedFunction = (field: keyof Touched): void => {
    setTouched((current: Touched) => {
      return current[field] ? current : { ...current, [field]: true };
    });
  };

  // A Compare with that the chosen comparison hides, to put back.
  const hiddenCompareWithRef: React.MutableRefObject<unknown> =
    useRef<unknown>(undefined);

  // What it shows when nothing has been chosen is written straight away.
  useEffect(() => {
    const defaults: JSONObject | null = patchForDefaults(props.arguments);

    if (defaults) {
      props.onChange(defaults);
    }
  }, []);

  useEffect(() => {
    props.onValidationChange(hasErrors);
  }, [hasErrors]);

  /*
   * A workflow that compares a value as Null or Undefined opens with Compare
   * as showing, and its note, so the choice can be seen where it is made.
   */
  const [isCompareAsOpenOnLoad] = useState<boolean>(() => {
    return state.compareAs.type === null;
  });

  type ChooseComparisonFunction = (value: DropdownValue | null) => void;

  const chooseComparison: ChooseComparisonFunction = (
    value: DropdownValue | null,
  ): void => {
    markTouched("comparison");

    if (typeof value !== "string") {
      return;
    }

    const change: ComparisonChange = patchForComparison({
      state: state,
      next: value as ConditionComparisonId,
      hiddenCompareWith: hiddenCompareWithRef.current,
    });

    hiddenCompareWithRef.current = change.hiddenCompareWith;
    props.onChange(change.patch);
  };

  const selectedComparison: DropdownOption | undefined = state.comparison
    ? {
        value: state.comparison.id,
        label: state.comparison.label,
      }
    : undefined;

  const showsCompareWith: boolean = state.comparison
    ? state.comparison.usesCompareWith
    : true;

  const compareAsType: ConditionValueType | null = state.compareAs.type;

  const selectedCompareAs: ConditionCompareAsOption | undefined =
    CONDITION_COMPARE_AS_OPTIONS.find((option: ConditionCompareAsOption) => {
      return option.type === compareAsType;
    });

  const renderPhrasePart: (
    part: ConditionPhrasePart,
    index: number,
  ) => ReactElement = (
    part: ConditionPhrasePart,
    index: number,
  ): ReactElement => {
    switch (part.kind) {
      case ConditionPhrasePartKind.Reference:
        return (
          <ReferenceChip
            key={index}
            reference={part.reference || part.text}
            description={picker.describeReference(part.reference || part.text)}
            dataTestId="if-else-summary-reference"
          />
        );
      case ConditionPhrasePartKind.Value:
        return (
          <span key={index} className="font-medium text-gray-900">
            {part.text}
          </span>
        );
      case ConditionPhrasePartKind.Missing:
        return (
          <span key={index} className="italic text-gray-400">
            {part.text}
          </span>
        );
      case ConditionPhrasePartKind.Text:
      default:
        return <React.Fragment key={index}>{part.text}</React.Fragment>;
    }
  };

  const comparisonControl: ReactElement = state.operatorIsReference ? (
    <div className="space-y-1">
      <ValueTextField
        value={state.operator}
        onChange={(value: string) => {
          props.onChange({ [CONDITION_ARGUMENT_IDS.comparison]: value });
        }}
        multiline={false}
        ariaLabel={COMPARISON_LABEL}
        dataTestId={CONDITION_TEST_IDS.comparison}
        error={touched.comparison ? errors.comparison : undefined}
        onBlur={() => {
          markTouched("comparison");
        }}
      />
      <button
        type="button"
        className="text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:underline"
        data-testid="if-else-choose-comparison"
        onClick={() => {
          props.onChange({
            [CONDITION_ARGUMENT_IDS.comparison]: ConditionComparisonId.EqualTo,
          });
        }}
      >
        {CHOOSE_FROM_LIST_LABEL}
      </button>
    </div>
  ) : (
    <Dropdown
      options={COMPARISON_OPTIONS}
      value={selectedComparison}
      onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
        chooseComparison(Array.isArray(value) ? null : value);
      }}
      placeholder="Choose a comparison"
      ariaLabel={COMPARISON_LABEL}
      isClearable={false}
      className="relative w-full"
      dataTestId={CONDITION_TEST_IDS.comparison}
      error={touched.comparison ? errors.comparison : undefined}
      onBlur={() => {
        markTouched("comparison");
      }}
    />
  );

  return (
    <div className="space-y-4" data-testid={CONDITION_TEST_IDS.root}>
      {/*
        The sentence. "If" starts it, then the value to check; the comparison
        and what it is compared with share the next line where they fit.
      */}
      <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[2.25rem_minmax(0,1fr)]">
        <div
          className="pt-0 text-sm font-semibold text-gray-700 sm:pt-2"
          aria-hidden="true"
        >
          If
        </div>
        <div className="min-w-0">
          <ValueTextField
            value={state.valueToCheck}
            onChange={(value: string) => {
              props.onChange({
                [CONDITION_ARGUMENT_IDS.valueToCheck]: value,
              });
            }}
            multiline={false}
            placeholder="Pick a value with { } or type one"
            ariaLabel={VALUE_TO_CHECK_LABEL}
            autoFocus={true}
            dataTestId={CONDITION_TEST_IDS.valueToCheck}
            error={touched.valueToCheck ? errors.valueToCheck : undefined}
            onBlur={() => {
              markTouched("valueToCheck");
            }}
          />
        </div>

        <div className="hidden sm:block" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
          <div className="w-full sm:w-64 sm:shrink-0">{comparisonControl}</div>
          {showsCompareWith && (
            <div className="min-w-0 flex-1">
              <ValueTextField
                value={state.compareWith}
                onChange={(value: string) => {
                  props.onChange({
                    [CONDITION_ARGUMENT_IDS.compareWith]: value,
                  });
                }}
                multiline={false}
                placeholder={
                  COMPARE_WITH_PLACEHOLDER[
                    compareAsType || ConditionValueType.Text
                  ]
                }
                ariaLabel={COMPARE_WITH_LABEL}
                dataTestId={CONDITION_TEST_IDS.compareWith}
                error={touched.compareWith ? errors.compareWith : undefined}
                onBlur={() => {
                  markTouched("compareWith");
                }}
              />
            </div>
          )}
        </div>
      </div>

      {showsCompareAs(state) && (
        <div data-testid={CONDITION_TEST_IDS.compareAs}>
          <CollapsibleSection
            title={COMPARE_AS_LABEL}
            badge={selectedCompareAs ? selectedCompareAs.label : "Mixed"}
            defaultCollapsed={!isCompareAsOpenOnLoad}
            headerClassName="!py-1"
          >
            <div className="space-y-2">
              <div
                role="radiogroup"
                aria-label={COMPARE_AS_LABEL}
                className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1"
              >
                {CONDITION_COMPARE_AS_OPTIONS.map(
                  (option: ConditionCompareAsOption) => {
                    const isChecked: boolean = option.type === compareAsType;

                    return (
                      <label
                        key={option.type}
                        className={`cursor-pointer rounded-md px-3 py-1 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-indigo-500 ${
                          isChecked
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        data-testid={`if-else-compare-as-${option.type}`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={compareAsName}
                          value={option.type}
                          checked={isChecked}
                          onChange={() => {
                            props.onChange(patchForCompareAs(option.type));
                          }}
                        />
                        {option.label}
                      </label>
                    );
                  },
                )}
              </div>
              {selectedCompareAs && (
                <p className="text-xs text-gray-500">
                  {selectedCompareAs.description}
                </p>
              )}
            </div>
          </CollapsibleSection>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="space-y-2" data-testid={CONDITION_TEST_IDS.notes}>
          {notes.map((note: ConditionNote) => {
            return (
              <li
                key={note.id}
                data-tone={note.tone}
                className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
                  note.tone === ConditionNoteTone.Warning
                    ? "border border-amber-200 bg-amber-50 text-amber-800"
                    : "border border-gray-200 bg-gray-50 text-gray-700"
                }`}
              >
                <div className="mt-0.5 shrink-0">
                  <Icon
                    icon={
                      note.tone === ConditionNoteTone.Warning
                        ? IconProp.Alert
                        : IconProp.Info
                    }
                    className="h-4 w-4"
                  />
                </div>
                <span>{note.text}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/*
        Where the workflow goes, in words: what the two outputs mean for this
        condition, read back from what is set right now.
      */}
      <div
        className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700"
        data-testid={CONDITION_TEST_IDS.summary}
      >
        <div className="flex items-start gap-2">
          <span className="mt-px inline-flex w-9 shrink-0 justify-center rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-px text-xs font-semibold text-emerald-700">
            Yes
          </span>
          <p className="min-w-0 leading-6" data-testid="if-else-summary-yes">
            {describeConditionMet(state).map(renderPhrasePart)}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <span className="mt-px inline-flex w-9 shrink-0 justify-center rounded-md border border-gray-200 bg-white px-1.5 py-px text-xs font-semibold text-gray-600">
            No
          </span>
          <p className="min-w-0 leading-6" data-testid="if-else-summary-no">
            otherwise.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ConditionEditor;
