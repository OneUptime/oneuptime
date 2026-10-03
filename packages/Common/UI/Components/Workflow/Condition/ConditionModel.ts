/*
 * The If / Else settings as a sentence: If [value to check] [comparison]
 * [compare with], continue on Yes, otherwise on No.
 *
 * What is stored does not change - "input-1", "operator", "input-2" and the
 * two types, exactly as every saved workflow, template and docs page has them
 * (Types/Workflow/Components/Condition). This reads them into what the
 * settings show, works out what a choice writes back, and says the condition
 * in words. Writing back only ever touches what the choice is about: opening
 * a step and saving it unchanged stores what was there.
 *
 * How the two values are compared ("Compare as") is chosen for the person
 * and tucked away:
 * - a comparison of numbers (is greater than...) compares as numbers;
 * - a comparison of text (contains...) compares as text;
 * - is true and is false compare as true or false;
 * - is equal to keeps whatever it was, text for a new step.
 * Compare as can still say otherwise; it then holds until the next change of
 * comparison.
 *
 * Pure: no DOM, no React.
 */

import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  CONDITION_ARGUMENT_IDS,
  ConditionValueType,
} from "../../../../Types/Workflow/Components/Condition";
import {
  CONDITION_VALUE_TYPE_LABELS,
  ConditionComparison,
  ConditionComparisonId,
  ConditionComparisonKind,
  comparisonForStoredCondition,
  getConditionComparison,
} from "../../../../Types/Workflow/Components/ConditionComparison";
import {
  ConditionTypes,
  getEffectiveConditionTypes,
  isNullishConditionType,
} from "../../../../Types/Workflow/Components/ConditionEvaluation";
import { ReferenceDescription } from "../ValuePicker/ReferenceDescription";
import {
  TemplateSegment,
  TemplateSegmentKind,
  containsTemplateExpression,
  isSingleReference,
  splitTemplateText,
} from "../ValuePicker/TemplateText";
import {
  TemplateValues,
  translatableTerm,
  translateTemplate,
  translationKey,
} from "../../../Utils/TranslateTemplate";

const IDS: typeof CONDITION_ARGUMENT_IDS = CONDITION_ARGUMENT_IDS;

// The setting names, as the step's metadata has them.
export const VALUE_TO_CHECK_LABEL: string = translationKey("Value to check");
export const COMPARISON_LABEL: string = translationKey("Comparison");
export const COMPARE_WITH_LABEL: string = translationKey("Compare with");
export const COMPARE_AS_LABEL: string = translationKey("Compare as");

export interface ConditionCompareAs {
  /*
   * What both values are compared as. Null when they are not compared the
   * same way: a workflow that still compares a value as Null or Undefined.
   */
  type: ConditionValueType | null;
  // How each value is compared, after the step's own rules.
  types: ConditionTypes;
}

export interface ConditionState {
  valueToCheck: unknown;
  compareWith: unknown;
  // The comparison as stored.
  operator: unknown;
  // The comparison is a reference, taken from a value when the step runs.
  operatorIsReference: boolean;
  // Null when the stored comparison is not one the step knows.
  comparison: ConditionComparison | null;
  compareAs: ConditionCompareAs;
}

type ReadConditionStateFunction = (
  args: JSONObject | undefined,
) => ConditionState;

export const readConditionState: ReadConditionStateFunction = (
  args: JSONObject | undefined,
): ConditionState => {
  const values: JSONObject = args || {};
  const operator: unknown = values[IDS.comparison];
  const operatorIsReference: boolean = containsTemplateExpression(operator);

  const types: ConditionTypes = getEffectiveConditionTypes(
    values[IDS.valueToCheckType],
    values[IDS.compareWithType],
  );

  const isUniform: boolean =
    types.valueToCheck === types.compareWith &&
    !isNullishConditionType(types.valueToCheck);

  return {
    valueToCheck: values[IDS.valueToCheck],
    compareWith: values[IDS.compareWith],
    operator: operator,
    operatorIsReference: operatorIsReference,
    comparison: operatorIsReference
      ? null
      : comparisonForStoredCondition({
          operator: operator,
          compareWith: values[IDS.compareWith],
          valueToCheckType: values[IDS.valueToCheckType],
          compareWithType: values[IDS.compareWithType],
        }),
    compareAs: {
      type: isUniform ? types.valueToCheck : null,
      types: types,
    },
  };
};

type IsBlankFunction = (value: unknown) => boolean;

/** Nothing there to compare: no value, or only spaces. 0 and false are values. */
export const isBlankConditionValue: IsBlankFunction = (
  value: unknown,
): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  return false;
};

/*
 * Whether "Compare as" is offered. It decides nothing for is empty, is not
 * empty, is true and is false, nor for the text comparisons, which compare
 * text - unless a workflow already compares them some other way, which is
 * then shown so it can be seen and changed.
 */
type ShowsCompareAsFunction = (state: ConditionState) => boolean;

export const showsCompareAs: ShowsCompareAsFunction = (
  state: ConditionState,
): boolean => {
  const kind: ConditionComparisonKind | undefined = state.comparison?.kind;

  if (!kind) {
    return state.operatorIsReference;
  }

  if (
    kind === ConditionComparisonKind.Equality ||
    kind === ConditionComparisonKind.Order
  ) {
    return true;
  }

  if (kind === ConditionComparisonKind.Text) {
    return state.compareAs.type !== ConditionValueType.Text;
  }

  return false;
};

type TypesPatchFunction = (type: ConditionValueType) => JSONObject;

const typesPatch: TypesPatchFunction = (
  type: ConditionValueType,
): JSONObject => {
  return {
    [IDS.valueToCheckType]: type,
    [IDS.compareWithType]: type,
  };
};

export interface ComparisonChange {
  // The arguments to write.
  patch: JSONObject;
  /*
   * What Compare with held, when the new comparison hides it: the settings
   * keep it, and put it back if a comparison that uses it is chosen again.
   */
  hiddenCompareWith?: unknown;
}

type PatchForComparisonFunction = (data: {
  state: ConditionState;
  next: ConditionComparisonId;
  // A Compare with that an earlier change hid, to put back.
  hiddenCompareWith?: unknown;
}) => ComparisonChange;

/**
 * What choosing a comparison writes: the operator, the types it compares as
 * (see the rules at the top), and Compare with when it hides or shows.
 */
export const patchForComparison: PatchForComparisonFunction = (data: {
  state: ConditionState;
  next: ConditionComparisonId;
  hiddenCompareWith?: unknown;
}): ComparisonChange => {
  const next: ConditionComparison = getConditionComparison(data.next);
  const previous: ConditionComparison | null = data.state.comparison;
  const currentType: ConditionValueType | null = data.state.compareAs.type;

  const patch: JSONObject = {
    [IDS.comparison]: next.operator,
  };

  const change: ComparisonChange = { patch: patch };

  const previousShowedCompareWith: boolean =
    !previous || previous.usesCompareWith;

  // Compare with is hidden: keep what it held to put back later.
  if (!next.usesCompareWith) {
    if (
      previousShowedCompareWith &&
      !isBlankConditionValue(data.state.compareWith)
    ) {
      change.hiddenCompareWith = data.state.compareWith;
    } else if (data.hiddenCompareWith !== undefined) {
      change.hiddenCompareWith = data.hiddenCompareWith;
    }
  }

  /*
   * True or false is part of is true and is false, not a choice the person
   * made: leaving them, the values are compared as text again.
   */
  const leavesTrueOrFalse: boolean =
    previous?.kind === ConditionComparisonKind.TrueOrFalse &&
    next.kind !== ConditionComparisonKind.TrueOrFalse;

  if (next.kind === ConditionComparisonKind.TrueOrFalse) {
    return {
      ...change,
      patch: {
        ...patch,
        ...typesPatch(ConditionValueType.Boolean),
        [IDS.compareWith]: next.fixedCompareWith as string,
      },
    };
  }

  if (next.kind === ConditionComparisonKind.Presence) {
    patch[IDS.compareWith] = "";

    if (leavesTrueOrFalse) {
      Object.assign(patch, typesPatch(ConditionValueType.Text));
    }

    return change;
  }

  // Compare with is shown again: what was hidden comes back.
  if (!previousShowedCompareWith) {
    patch[IDS.compareWith] =
      data.hiddenCompareWith !== undefined
        ? (data.hiddenCompareWith as JSONValue)
        : "";
  }

  if (next.kind === ConditionComparisonKind.Order) {
    if (
      leavesTrueOrFalse ||
      currentType === ConditionValueType.Text ||
      currentType === ConditionValueType.Boolean
    ) {
      Object.assign(patch, typesPatch(ConditionValueType.Number));
    }

    return change;
  }

  if (next.kind === ConditionComparisonKind.Text) {
    if (
      leavesTrueOrFalse ||
      (currentType && currentType !== ConditionValueType.Text)
    ) {
      Object.assign(patch, typesPatch(ConditionValueType.Text));
    }

    return change;
  }

  // Equality keeps how the values are compared.
  if (leavesTrueOrFalse) {
    Object.assign(patch, typesPatch(ConditionValueType.Text));
  }

  return change;
};

type PatchForCompareAsFunction = (type: ConditionValueType) => JSONObject;

/** What choosing how to compare writes: the same type for both values. */
export const patchForCompareAs: PatchForCompareAsFunction = (
  type: ConditionValueType,
): JSONObject => {
  return typesPatch(type);
};

/*
 * A new step says "is equal to" before anything is chosen, and the step runs
 * a missing comparison as one, so it is written straight away: what the
 * settings show is what is stored.
 */
type DefaultsPatchFunction = (
  args: JSONObject | undefined,
) => JSONObject | null;

export const patchForDefaults: DefaultsPatchFunction = (
  args: JSONObject | undefined,
): JSONObject | null => {
  const operator: unknown = (args || {})[IDS.comparison];

  if (operator === undefined || operator === null || operator === "") {
    return { [IDS.comparison]: ConditionComparisonId.EqualTo };
  }

  return null;
};

export interface ConditionErrors {
  valueToCheck?: string | undefined;
  comparison?: string | undefined;
  compareWith?: string | undefined;
}

type ValidateConditionFunction = (state: ConditionState) => ConditionErrors;

/** What has to be filled in before the step can be saved. */
export const validateCondition: ValidateConditionFunction = (
  state: ConditionState,
): ConditionErrors => {
  const errors: ConditionErrors = {};

  if (isBlankConditionValue(state.valueToCheck)) {
    errors.valueToCheck = translationKey("Pick or type the value to check.");
  }

  if (!state.comparison && !state.operatorIsReference) {
    errors.comparison = translationKey("Choose a comparison.");
  }

  const usesCompareWith: boolean = state.comparison
    ? state.comparison.usesCompareWith
    : true;

  if (usesCompareWith && isBlankConditionValue(state.compareWith)) {
    errors.compareWith = translationKey("Type or pick what to compare with.");
  }

  return errors;
};

type HasConditionErrorsFunction = (errors: ConditionErrors) => boolean;

export const hasConditionErrors: HasConditionErrorsFunction = (
  errors: ConditionErrors,
): boolean => {
  return Boolean(
    errors.valueToCheck || errors.comparison || errors.compareWith,
  );
};

export enum ConditionNoteTone {
  Info = "Info",
  Warning = "Warning",
}

export interface ConditionNote {
  id: string;
  tone: ConditionNoteTone;
  text: string;
}

type TextOfFunction = (value: unknown) => string;

const textOf: TextOfFunction = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
};

type ShortenFunction = (text: string) => string;

const shorten: ShortenFunction = (text: string): string => {
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
};

type GetConditionNotesFunction = (
  state: ConditionState,
) => Array<ConditionNote>;

/**
 * What the person should know about the condition as it stands, beyond what
 * is missing: a value that will not compare the way it reads, or a type the
 * settings no longer offer.
 */
export const getConditionNotes: GetConditionNotesFunction = (
  state: ConditionState,
): Array<ConditionNote> => {
  const notes: Array<ConditionNote> = [];
  const comparison: ConditionComparison | null = state.comparison;

  if (!comparison || !comparison.usesCompareWith) {
    return notes;
  }

  const types: ConditionTypes = state.compareAs.types;

  if (state.compareAs.type === null) {
    const sides: Array<string> = [];

    if (isNullishConditionType(types.valueToCheck)) {
      sides.push(VALUE_TO_CHECK_LABEL);
    }

    if (isNullishConditionType(types.compareWith)) {
      sides.push(COMPARE_WITH_LABEL);
    }

    const nullishType: ConditionValueType = isNullishConditionType(
      types.valueToCheck,
    )
      ? types.valueToCheck
      : types.compareWith;

    // Whole sentences, one for each side and one for both.
    const values: TemplateValues = {
      side: translatableTerm(sides[0] || VALUE_TO_CHECK_LABEL),
      otherSide: translatableTerm(sides[1] || COMPARE_WITH_LABEL),
      type: translatableTerm(CONDITION_VALUE_TYPE_LABELS[nullishType], {
        inSentence: true,
      }),
      compareAs: translatableTerm(COMPARE_AS_LABEL),
    };

    notes.push({
      id: "legacy-type",
      tone: ConditionNoteTone.Warning,
      text:
        sides.length > 1
          ? translateTemplate(
              "{{side}} and {{otherSide}} are compared as {{type}}, which ignores what they hold. This step no longer offers that: choose how to compare under {{compareAs}}, or choose is empty to check for a missing value.",
              values,
            )
          : translateTemplate(
              "{{side}} is compared as {{type}}, which ignores what it holds. This step no longer offers that: choose how to compare under {{compareAs}}, or choose is empty to check for a missing value.",
              values,
            ),
    });

    return notes;
  }

  const literalSides: Array<{ label: string; value: unknown }> = [
    { label: VALUE_TO_CHECK_LABEL, value: state.valueToCheck },
    { label: COMPARE_WITH_LABEL, value: state.compareWith },
  ].filter((side: { label: string; value: unknown }) => {
    return (
      !isBlankConditionValue(side.value) &&
      !containsTemplateExpression(side.value)
    );
  });

  if (state.compareAs.type === ConditionValueType.Number) {
    for (const side of literalSides) {
      const text: string = textOf(side.value);

      if (isNaN(Number(text))) {
        notes.push({
          id: `not-a-number-${side.label}`,
          tone: ConditionNoteTone.Warning,
          text: translateTemplate(
            '"{{value}}" is not a number, so it is compared as 0.',
            { value: shorten(text) },
          ),
        });
      }
    }
  }

  if (state.compareAs.type === ConditionValueType.Boolean) {
    for (const side of literalSides) {
      const text: string = textOf(side.value);

      if (text !== "true" && text !== "false") {
        notes.push({
          id: `not-true-or-false-${side.label}`,
          tone: ConditionNoteTone.Warning,
          text: translateTemplate(
            'Only true counts as true, so "{{value}}" is compared as false.',
            { value: shorten(text) },
          ),
        });
      }
    }
  }

  if (
    comparison.kind === ConditionComparisonKind.Order &&
    state.compareAs.type === ConditionValueType.Text
  ) {
    notes.push({
      id: "order-as-text",
      tone: ConditionNoteTone.Info,
      text: translateTemplate(
        'Compared as text, letter by letter: "10" comes before "9". That suits dates written 2026-10-01. For numbers, choose Number under {{compareAs}}.',
        { compareAs: translatableTerm(COMPARE_AS_LABEL) },
      ),
    });
  }

  return notes;
};

/*
 * The condition in words, for the summary under the settings:
 * "when Webhook › Request Body › environment is equal to “production”".
 */
export enum ConditionPhrasePartKind {
  // Words of the sentence.
  Text = "Text",
  // A value typed in, quoted when it is text.
  Value = "Value",
  // A value from a step or a variable, drawn as its chip.
  Reference = "Reference",
  // A value not set yet.
  Missing = "Missing",
}

export interface ConditionPhrasePart {
  kind: ConditionPhrasePartKind;
  text: string;
  // For a Reference: the reference as stored.
  reference?: string | undefined;
}

type DescribeReferenceFunction = (
  reference: string,
) => ReferenceDescription | null;

type PhraseValueFunction = (data: {
  value: unknown;
  missing: string;
  compareAs: ConditionValueType | null;
}) => Array<ConditionPhrasePart>;

const phraseValue: PhraseValueFunction = (data: {
  value: unknown;
  missing: string;
  compareAs: ConditionValueType | null;
}): Array<ConditionPhrasePart> => {
  if (isBlankConditionValue(data.value)) {
    return [{ kind: ConditionPhrasePartKind.Missing, text: data.missing }];
  }

  const text: string = textOf(data.value);

  if (isSingleReference(text)) {
    return [
      {
        kind: ConditionPhrasePartKind.Reference,
        text: text.trim(),
        reference: text.trim(),
      },
    ];
  }

  const segments: Array<TemplateSegment> = splitTemplateText(text);
  const hasReference: boolean = segments.some((segment: TemplateSegment) => {
    return segment.kind === TemplateSegmentKind.Reference;
  });

  if (!hasReference) {
    /*
     * A number or true / false compared as one reads as itself; anything
     * else is text, in quotes so its spaces and capitals show.
     */
    const readsAsItself: boolean =
      (data.compareAs === ConditionValueType.Number &&
        text.trim() !== "" &&
        !isNaN(Number(text))) ||
      (data.compareAs === ConditionValueType.Boolean &&
        (text === "true" || text === "false"));

    return [
      {
        kind: ConditionPhrasePartKind.Value,
        text: readsAsItself ? text : `“${text}”`,
      },
    ];
  }

  // Text with values in it: quoted, the values as chips.
  const parts: Array<ConditionPhrasePart> = [
    { kind: ConditionPhrasePartKind.Value, text: "“" },
  ];

  for (const segment of segments) {
    if (segment.kind === TemplateSegmentKind.Reference) {
      parts.push({
        kind: ConditionPhrasePartKind.Reference,
        text: segment.text,
        reference: segment.text,
      });
    } else {
      parts.push({ kind: ConditionPhrasePartKind.Value, text: segment.text });
    }
  }

  parts.push({ kind: ConditionPhrasePartKind.Value, text: "”" });

  return parts;
};

type CompareAsSuffixFunction = (state: ConditionState) => string;

// How the values are compared, when it is not the obvious way.
const compareAsSuffix: CompareAsSuffixFunction = (
  state: ConditionState,
): string => {
  const comparison: ConditionComparison | null = state.comparison;

  if (!comparison || !comparison.usesCompareWith) {
    return "";
  }

  const type: ConditionValueType | null = state.compareAs.type;

  if (type === null) {
    const types: ConditionTypes = state.compareAs.types;
    return `, compared as ${CONDITION_VALUE_TYPE_LABELS[
      types.valueToCheck
    ].toLowerCase()} and ${CONDITION_VALUE_TYPE_LABELS[
      types.compareWith
    ].toLowerCase()}`;
  }

  if (comparison.kind === ConditionComparisonKind.Text) {
    return type === ConditionValueType.Text
      ? ""
      : `, compared as ${type === ConditionValueType.Number ? "numbers" : "true or false"}`;
  }

  if (type === ConditionValueType.Number) {
    return ", compared as numbers";
  }

  if (type === ConditionValueType.Boolean) {
    return ", compared as true or false";
  }

  return comparison.kind === ConditionComparisonKind.Order
    ? ", compared as text"
    : "";
};

type DescribeConditionFunction = (
  state: ConditionState,
  options?: { withCompareAs?: boolean | undefined } | undefined,
) => Array<ConditionPhrasePart>;

/**
 * When the condition is met, as the words after "Yes:": "when <value to
 * check> <comparison> <compare with>", and how they are compared when that
 * is not the obvious way. Missing values read as what they are for, so the
 * sentence is whole from the first moment.
 */
export const describeConditionMet: DescribeConditionFunction = (
  state: ConditionState,
  options?: { withCompareAs?: boolean | undefined } | undefined,
): Array<ConditionPhrasePart> => {
  const parts: Array<ConditionPhrasePart> = [
    { kind: ConditionPhrasePartKind.Text, text: "when " },
    ...phraseValue({
      value: state.valueToCheck,
      missing: "the value to check",
      compareAs: state.compareAs.type,
    }),
  ];

  if (state.operatorIsReference) {
    parts.push(
      { kind: ConditionPhrasePartKind.Text, text: " compared by " },
      ...phraseValue({
        value: state.operator,
        missing: "",
        compareAs: null,
      }),
      { kind: ConditionPhrasePartKind.Text, text: " with " },
      ...phraseValue({
        value: state.compareWith,
        missing: "the value to compare with",
        compareAs: state.compareAs.type,
      }),
    );
  } else if (!state.comparison) {
    parts.push({
      kind: ConditionPhrasePartKind.Missing,
      text: " … (choose a comparison)",
    });
  } else {
    parts.push({
      kind: ConditionPhrasePartKind.Text,
      text: ` ${state.comparison.label}`,
    });

    if (state.comparison.usesCompareWith) {
      parts.push(
        { kind: ConditionPhrasePartKind.Text, text: " " },
        ...phraseValue({
          value: state.compareWith,
          missing: "the value to compare with",
          compareAs: state.compareAs.type,
        }),
      );
    }
  }

  const suffix: string =
    options?.withCompareAs === false ? "" : compareAsSuffix(state);

  parts.push({ kind: ConditionPhrasePartKind.Text, text: `${suffix}.` });

  return parts;
};

type ShortReferenceLabelFunction = (
  reference: string,
  describeReference: DescribeReferenceFunction,
) => string;

/*
 * A reference in a few words, for where a chip does not fit: the last thing
 * it names - "environment" for the webhook body's environment field, the
 * variable's name for a variable.
 */
export const shortReferenceLabel: ShortReferenceLabelFunction = (
  reference: string,
  describeReference: DescribeReferenceFunction,
): string => {
  const description: ReferenceDescription | null = describeReference(reference);

  if (!description) {
    return reference;
  }

  const last: string =
    description.parts[description.parts.length - 1] || description.source;
  const dot: number = last.lastIndexOf(".");

  return dot === -1 ? last : last.slice(dot + 1);
};

type SummarizeConditionFunction = (data: {
  args: JSONObject | undefined;
  describeReference: DescribeReferenceFunction;
}) => string | null;

/**
 * The condition in one line, for the step on the canvas:
 * `environment is equal to “production”`. Null until the value to check and
 * the comparison are set.
 */
export const summarizeCondition: SummarizeConditionFunction = (data: {
  args: JSONObject | undefined;
  describeReference: DescribeReferenceFunction;
}): string | null => {
  const state: ConditionState = readConditionState(data.args);

  if (isBlankConditionValue(state.valueToCheck) || !state.comparison) {
    return null;
  }

  // Without the leading "when " and the closing full stop.
  const parts: Array<ConditionPhrasePart> = describeConditionMet(state, {
    withCompareAs: false,
  }).slice(1);

  return parts
    .map((part: ConditionPhrasePart) => {
      if (part.kind === ConditionPhrasePartKind.Reference) {
        return shortReferenceLabel(
          part.reference || part.text,
          data.describeReference,
        );
      }

      if (part.kind === ConditionPhrasePartKind.Missing) {
        return "…";
      }

      return part.text;
    })
    .join("")
    .replace(/\.$/, "");
};
