/*
 * A Switch / Case step's settings: the value to check, and the list of cases
 * it is compared with, each a comparison and a value.
 *
 * What is stored is Types/Workflow/Components/SwitchCases' shape. This reads
 * it into what the settings show, works out what an edit writes back, and
 * says what is missing or worth knowing about each case.
 *
 * Each case is an If / Else condition without its value to check, so a case
 * is read and changed through If / Else's own ConditionModel: choosing a
 * comparison picks how the values are compared exactly as it does there (a
 * number comparison compares numbers, is true compares true or false), and a
 * case is described, checked and annotated in the same words. The cases are
 * handed to ConditionModel as the If / Else settings they would be.
 *
 * Pure: no DOM, no React.
 */

import Dictionary from "../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  CONDITION_ARGUMENT_IDS,
  ConditionValueType,
} from "../../../../Types/Workflow/Components/Condition";
import { ConditionComparisonId } from "../../../../Types/Workflow/Components/ConditionComparison";
import { SWITCH_ARGUMENT_IDS } from "../../../../Types/Workflow/Components/Switch";
import {
  SwitchCase,
  SwitchCasesReading,
  createSwitchCase,
  getNextSwitchCaseId,
  getSwitchCaseLabel,
  nameTemplateValue,
  parseSwitchCases,
  readSwitchCases,
  shortReferenceName,
  toStoredSwitchCases,
} from "../../../../Types/Workflow/Components/SwitchCases";
import {
  TemplateExpression,
  TemplateExpressionKind,
  parseTemplateExpressions,
} from "../../../../Types/Workflow/TemplateSyntax";
import {
  ComparisonChange,
  ConditionNote,
  ConditionState,
  VALUE_TO_CHECK_LABEL,
  isBlankConditionValue,
  patchForComparison,
  patchForCompareAs,
  readConditionState,
  getConditionNotes,
  showsCompareAs,
} from "../Condition/ConditionModel";
import {
  translatePlural,
  translationKey,
} from "../../../Utils/TranslateTemplate";

const IDS: typeof CONDITION_ARGUMENT_IDS = CONDITION_ARGUMENT_IDS;

// The setting names, as the step's metadata has them.
export const CASES_LABEL: string = translationKey("Cases");
export const ADD_CASE_LABEL: string = translationKey("Add case");

export interface SwitchState {
  valueToCheck: unknown;
  cases: Array<SwitchCase>;
  // False when the stored cases are not a list at all (SwitchCases).
  isReadable: boolean;
}

type ReadSwitchStateFunction = (args: JSONObject | undefined) => SwitchState;

export const readSwitchState: ReadSwitchStateFunction = (
  args: JSONObject | undefined,
): SwitchState => {
  const values: JSONObject = args || {};
  const reading: SwitchCasesReading = parseSwitchCases(
    values[SWITCH_ARGUMENT_IDS.cases],
  );

  return {
    valueToCheck: values[SWITCH_ARGUMENT_IDS.valueToCheck],
    cases: reading.cases,
    isReadable: reading.isReadable,
  };
};

type PatchForCasesFunction = (cases: Array<SwitchCase>) => JSONObject;

/** What a change to the list writes: the whole list, as it is saved. */
export const patchForCases: PatchForCasesFunction = (
  cases: Array<SwitchCase>,
): JSONObject => {
  return { [SWITCH_ARGUMENT_IDS.cases]: toStoredSwitchCases(cases) };
};

type CaseAsConditionFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
) => JSONObject;

/*
 * A case as the If / Else settings it would be: the step's value to check,
 * the case's comparison, its value as Compare with, and its Compare as for
 * both values.
 */
const caseAsCondition: CaseAsConditionFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
): JSONObject => {
  return {
    [IDS.valueToCheck]: (valueToCheck ?? "") as JSONValue,
    [IDS.comparison]: switchCase.comparison,
    [IDS.compareWith]: switchCase.value,
    [IDS.valueToCheckType]: switchCase.compareAs,
    [IDS.compareWithType]: switchCase.compareAs,
  };
};

type ApplyConditionPatchFunction = (
  switchCase: SwitchCase,
  patch: JSONObject,
) => SwitchCase;

// An If / Else patch, written into the case it was made for.
const applyConditionPatch: ApplyConditionPatchFunction = (
  switchCase: SwitchCase,
  patch: JSONObject,
): SwitchCase => {
  const next: SwitchCase = { ...switchCase };

  if (patch[IDS.comparison] !== undefined) {
    next.comparison = String(patch[IDS.comparison]);
  }

  if (patch[IDS.compareWith] !== undefined) {
    const value: unknown = patch[IDS.compareWith];
    next.value = value === null ? "" : String(value);
  }

  if (patch[IDS.valueToCheckType] !== undefined) {
    next.compareAs = String(patch[IDS.valueToCheckType]);
  }

  return next;
};

type GetCaseConditionStateFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
) => ConditionState;

/** A case as If / Else's settings read it: its comparison and Compare as. */
export const getCaseConditionState: GetCaseConditionStateFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
): ConditionState => {
  return readConditionState(caseAsCondition(valueToCheck, switchCase));
};

type MapCaseFunction = (
  cases: Array<SwitchCase>,
  id: string,
  change: (switchCase: SwitchCase) => SwitchCase,
) => Array<SwitchCase>;

const mapCase: MapCaseFunction = (
  cases: Array<SwitchCase>,
  id: string,
  change: (switchCase: SwitchCase) => SwitchCase,
): Array<SwitchCase> => {
  return cases.map((switchCase: SwitchCase): SwitchCase => {
    return switchCase.id === id ? change(switchCase) : switchCase;
  });
};

export interface CaseComparisonChange {
  cases: Array<SwitchCase>;
  /*
   * What the case's value held, when the new comparison hides it (is empty,
   * is true): the settings keep it, and put it back if a comparison that uses
   * a value is chosen again. See ConditionModel.patchForComparison.
   */
  hiddenValue?: unknown;
}

type ChangeCaseComparisonFunction = (data: {
  cases: Array<SwitchCase>;
  id: string;
  next: ConditionComparisonId;
  valueToCheck: unknown;
  hiddenValue?: unknown;
}) => CaseComparisonChange;

/**
 * What choosing a comparison for a case writes: If / Else's own rules, for
 * that case alone.
 */
export const changeCaseComparison: ChangeCaseComparisonFunction = (data: {
  cases: Array<SwitchCase>;
  id: string;
  next: ConditionComparisonId;
  valueToCheck: unknown;
  hiddenValue?: unknown;
}): CaseComparisonChange => {
  const switchCase: SwitchCase | undefined = data.cases.find(
    (candidate: SwitchCase): boolean => {
      return candidate.id === data.id;
    },
  );

  if (!switchCase) {
    return { cases: data.cases };
  }

  const change: ComparisonChange = patchForComparison({
    state: getCaseConditionState(data.valueToCheck, switchCase),
    next: data.next,
    hiddenCompareWith: data.hiddenValue,
  });

  const result: CaseComparisonChange = {
    cases: mapCase(data.cases, data.id, (current: SwitchCase): SwitchCase => {
      return applyConditionPatch(current, change.patch);
    }),
  };

  if (change.hiddenCompareWith !== undefined) {
    result.hiddenValue = change.hiddenCompareWith;
  }

  return result;
};

type ChangeCaseValueFunction = (
  cases: Array<SwitchCase>,
  id: string,
  value: string,
) => Array<SwitchCase>;

export const changeCaseValue: ChangeCaseValueFunction = (
  cases: Array<SwitchCase>,
  id: string,
  value: string,
): Array<SwitchCase> => {
  return mapCase(cases, id, (switchCase: SwitchCase): SwitchCase => {
    return { ...switchCase, value: value };
  });
};

type ChangeCaseCompareAsFunction = (
  cases: Array<SwitchCase>,
  id: string,
  type: ConditionValueType,
) => Array<SwitchCase>;

/** Compare as, for one case: the same type for both values. */
export const changeCaseCompareAs: ChangeCaseCompareAsFunction = (
  cases: Array<SwitchCase>,
  id: string,
  type: ConditionValueType,
): Array<SwitchCase> => {
  return mapCase(cases, id, (switchCase: SwitchCase): SwitchCase => {
    return applyConditionPatch(switchCase, patchForCompareAs(type));
  });
};

type AddCaseFunction = (
  cases: Array<SwitchCase>,
  // Ids the step has had while its settings were open: never reused.
  usedIds: Array<string>,
) => Array<SwitchCase>;

/** A new, empty case at the end: is equal to, as text. */
export const addCase: AddCaseFunction = (
  cases: Array<SwitchCase>,
  usedIds: Array<string>,
): Array<SwitchCase> => {
  return [...cases, createSwitchCase(getNextSwitchCaseId(cases, usedIds))];
};

type RemoveCaseFunction = (
  cases: Array<SwitchCase>,
  id: string,
) => Array<SwitchCase>;

export const removeCase: RemoveCaseFunction = (
  cases: Array<SwitchCase>,
  id: string,
): Array<SwitchCase> => {
  return cases.filter((switchCase: SwitchCase): boolean => {
    return switchCase.id !== id;
  });
};

type MoveCaseFunction = (
  cases: Array<SwitchCase>,
  from: number,
  to: number,
) => Array<SwitchCase>;

/** A case dragged from one place in the list to another. */
export const moveCase: MoveCaseFunction = (
  cases: Array<SwitchCase>,
  from: number,
  to: number,
): Array<SwitchCase> => {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= cases.length ||
    to >= cases.length
  ) {
    return cases;
  }

  const next: Array<SwitchCase> = [...cases];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as SwitchCase);
  return next;
};

type PutCaseBackFunction = (
  cases: Array<SwitchCase>,
  switchCase: SwitchCase,
  index: number,
) => Array<SwitchCase>;

/** A removed case, put back where it was, or at the end of a shorter list. */
export const putCaseBack: PutCaseBackFunction = (
  cases: Array<SwitchCase>,
  switchCase: SwitchCase,
  index: number,
): Array<SwitchCase> => {
  if (
    cases.some((candidate: SwitchCase): boolean => {
      return candidate.id === switchCase.id;
    })
  ) {
    return cases;
  }

  const next: Array<SwitchCase> = [...cases];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, switchCase);
  return next;
};

export interface SwitchCaseErrors {
  comparison?: string | undefined;
  value?: string | undefined;
}

type GetCaseErrorsFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
) => SwitchCaseErrors;

/** What a case still needs before the step can be saved. */
export const getCaseErrors: GetCaseErrorsFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
): SwitchCaseErrors => {
  const state: ConditionState = getCaseConditionState(valueToCheck, switchCase);
  const errors: SwitchCaseErrors = {};

  if (!state.comparison) {
    errors.comparison = translationKey("Choose a comparison.");
    return errors;
  }

  if (
    state.comparison.usesCompareWith &&
    isBlankConditionValue(state.compareWith)
  ) {
    errors.value = translationKey("Type or pick what to compare with.");
  }

  return errors;
};

export interface SwitchErrors {
  valueToCheck?: string | undefined;
  // By case id.
  cases: Dictionary<SwitchCaseErrors>;
  // The stored cases cannot be read at all.
  unreadableCases?: string | undefined;
}

type ValidateSwitchFunction = (state: SwitchState) => SwitchErrors;

/** What has to be filled in before the step can be saved. */
export const validateSwitch: ValidateSwitchFunction = (
  state: SwitchState,
): SwitchErrors => {
  const errors: SwitchErrors = { cases: {} };

  if (isBlankConditionValue(state.valueToCheck)) {
    errors.valueToCheck = translationKey("Pick or type the value to check.");
  }

  if (!state.isReadable) {
    errors.unreadableCases = translationKey(
      "The cases saved for this step could not be read. Add the cases again.",
    );
  }

  for (const switchCase of state.cases) {
    const caseErrors: SwitchCaseErrors = getCaseErrors(
      state.valueToCheck,
      switchCase,
    );

    if (caseErrors.comparison || caseErrors.value) {
      errors.cases[switchCase.id] = caseErrors;
    }
  }

  return errors;
};

type HasSwitchErrorsFunction = (errors: SwitchErrors) => boolean;

export const hasSwitchErrors: HasSwitchErrorsFunction = (
  errors: SwitchErrors,
): boolean => {
  return Boolean(
    errors.valueToCheck ||
      errors.unreadableCases ||
      Object.keys(errors.cases).length > 0,
  );
};

type GetCaseNotesFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
) => Array<ConditionNote>;

/**
 * What is worth knowing about a case's value, in If / Else's words: a value
 * that will not compare the way it reads. Only the case's own value is
 * looked at; the value to check is the same for every case.
 */
export const getCaseNotes: GetCaseNotesFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
): Array<ConditionNote> => {
  return getConditionNotes(
    getCaseConditionState(valueToCheck, switchCase),
  ).filter((note: ConditionNote): boolean => {
    return !note.id.endsWith(VALUE_TO_CHECK_LABEL);
  });
};

type CaseShowsCompareAsFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
) => boolean;

/**
 * Whether Compare as decides anything for a case: it does for is equal to
 * and the number comparisons, not for is empty or is true, as in If / Else.
 */
export const caseShowsCompareAs: CaseShowsCompareAsFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
): boolean => {
  return showsCompareAs(getCaseConditionState(valueToCheck, switchCase));
};

type GetCaseCompareAsFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
) => ConditionValueType | null;

/** How a case compares: one type for both values, or null when mixed. */
export const getCaseCompareAs: GetCaseCompareAsFunction = (
  valueToCheck: unknown,
  switchCase: SwitchCase,
): ConditionValueType | null => {
  return getCaseConditionState(valueToCheck, switchCase).compareAs.type;
};

/** A step a connection leads to: its id on the canvas and its title. */
export interface ConnectedStep {
  componentId: string;
  title: string;
}

// The steps each output of the step is connected to, by output id.
export type OutputConnections = Dictionary<Array<ConnectedStep>>;

export interface RemovedConnectedCase {
  switchCase: SwitchCase;
  // Where it was in the list when the settings opened.
  index: number;
  // What it is called on the canvas.
  label: string;
  steps: Array<ConnectedStep>;
}

type GetRemovedConnectedCasesFunction = (data: {
  // The cases as they were when the settings opened.
  originalCases: Array<SwitchCase>;
  cases: Array<SwitchCase>;
  connections: OutputConnections | undefined;
}) => Array<RemovedConnectedCase>;

/**
 * The cases taken out since the settings opened that had a step connected
 * to their output: saving removes those connections, so the settings say so,
 * and offer to put the case back.
 */
export const getRemovedConnectedCases: GetRemovedConnectedCasesFunction =
  (data: {
    originalCases: Array<SwitchCase>;
    cases: Array<SwitchCase>;
    connections: OutputConnections | undefined;
  }): Array<RemovedConnectedCase> => {
    const remaining: Set<string> = new Set<string>(
      data.cases.map((switchCase: SwitchCase): string => {
        return switchCase.id;
      }),
    );

    const removed: Array<RemovedConnectedCase> = [];

    data.originalCases.forEach((switchCase: SwitchCase, index: number) => {
      const steps: Array<ConnectedStep> =
        (data.connections || {})[switchCase.id] || [];

      if (remaining.has(switchCase.id) || steps.length === 0) {
        return;
      }

      removed.push({
        switchCase: switchCase,
        index: index,
        label: getSwitchCaseLabel(switchCase, index),
        steps: steps,
      });
    });

    return removed;
  };

type DescribeValueToCheckFunction = (value: unknown) => string | null;

/*
 * The value to check in a few words, for the step on the canvas: a single
 * reference by its name (incidentSeverity.name), anything else as typed.
 */
const describeValueToCheck: DescribeValueToCheckFunction = (
  value: unknown,
): string | null => {
  if (isBlankConditionValue(value)) {
    return null;
  }

  const text: string = typeof value === "string" ? value : String(value);
  const expressions: Array<TemplateExpression> = text.includes("{{")
    ? parseTemplateExpressions(text.slice(0, 2000))
    : [];

  const references: Array<TemplateExpression> = expressions.filter(
    (expression: TemplateExpression): boolean => {
      return expression.kind === TemplateExpressionKind.Reference;
    },
  );

  const only: TemplateExpression | undefined = references[0];

  if (
    references.length === 1 &&
    only &&
    only.startIndex === 0 &&
    only.endIndex === text.trim().length
  ) {
    return shortReferenceName(only.inner);
  }

  const named: string = nameTemplateValue(text).trim();

  return named.length > 40 ? `${named.slice(0, 39).trimEnd()}…` : named;
};

type SummarizeSwitchFunction = (
  args: JSONObject | undefined,
) => string | null;

/**
 * The step in one line, for the canvas: what it checks, and against how many
 * cases - "Checks incidentSeverity.name against 2 cases". The cases
 * themselves name the outputs under it. Null until the value to check is set.
 */
export const summarizeSwitch: SummarizeSwitchFunction = (
  args: JSONObject | undefined,
): string | null => {
  const values: JSONObject = args || {};
  const value: string | null = describeValueToCheck(
    values[SWITCH_ARGUMENT_IDS.valueToCheck],
  );

  if (!value) {
    return null;
  }

  const count: number = readSwitchCases(
    values[SWITCH_ARGUMENT_IDS.cases],
  ).length;

  return translatePlural(
    {
      one: "Checks {{value}} against {{count}} case",
      other: "Checks {{value}} against {{count}} cases",
    },
    count,
    { value: value },
  );
};
