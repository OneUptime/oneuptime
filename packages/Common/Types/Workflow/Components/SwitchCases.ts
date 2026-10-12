/*
 * The cases of a Switch / Case step: what is stored for each, how a stored
 * list is read back, what each case is called on the canvas, the output each
 * one becomes, and how a value is matched against them.
 *
 * A case is stored as
 *
 *   { "id": "case-1", "comparison": "==", "value": "Critical Incident", "compareAs": "text" }
 *
 * - id: the case's output on the canvas, which a connection leaves from (an
 *   edge's sourceHandle). It stays the same when the case is edited or moved,
 *   so a connection follows its case; a removed case's id is never handed to
 *   a new one while the settings are open.
 * - comparison: stored as If / Else stores its Comparison ("==", "contains",
 *   "is empty", ...: ConditionOperator).
 * - value: what the value to check is compared with (If / Else's Compare
 *   with). Unused by is empty and is not empty; "true" or "false" for is true
 *   and is false, which are == compared as true or false, as in If / Else.
 * - compareAs: how both values are compared (If / Else's Compare as): text,
 *   number or boolean. Missing compares as text.
 *
 * Matching is If / Else's own evaluateCondition, case by case from the top.
 * The first case that matches is taken and nothing after it is checked; when
 * none does, Default is. So a case matches exactly when an If / Else with that
 * comparison, value and Compare as would say Yes.
 *
 * Pure: the runner, the canvas, the settings, the graph checks and the help
 * all read cases through here, so they never disagree on a case's output or
 * its name.
 */

import BadDataException from "../../Exception/BadDataException";
import { JSONObject, JSONValue } from "../../JSON";
import { Port } from "../Component";
import {
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpression,
  TemplateExpressionKind,
  parseReferencePath,
  parseTemplateExpressions,
} from "../TemplateSyntax";
import { ConditionOperator, ConditionValueType } from "./Condition";
import {
  ConditionComparison,
  ConditionComparisonId,
  ConditionComparisonKind,
  comparisonForStoredCondition,
} from "./ConditionComparison";
import {
  ConditionTypes,
  ResolvedConditionOperator,
  evaluateCondition,
  getEffectiveConditionTypes,
  resolveConditionOperator,
} from "./ConditionEvaluation";
import {
  SWITCH_ARGUMENT_IDS,
  SWITCH_DEFAULT_PORT,
  SWITCH_DEFAULT_PORT_ID,
  SWITCH_IN_PORT_ID,
} from "./Switch";

export interface SwitchCase {
  id: string;
  // The stored comparison: a ConditionOperator, or what a workflow holds.
  comparison: string;
  // What the value to check is compared with, as text.
  value: string;
  // How both values are compared: a ConditionValueType, or "" for text.
  compareAs: string;
}

export const SWITCH_CASE_ID_PREFIX: string = "case-";

// An output id a connection can hold, and nothing a reference could become.
const CASE_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{1,64}$/;

const RESERVED_CASE_IDS: Array<string> = [
  SWITCH_DEFAULT_PORT_ID,
  SWITCH_IN_PORT_ID,
];

// How long a case's name on the canvas gets before it is cut.
export const SWITCH_CASE_LABEL_MAX_LENGTH: number = 40;

// How much of a value a sentence about a case quotes.
const SENTENCE_VALUE_MAX_LENGTH: number = 60;

// Text longer than this is cut before anything looks for references in it.
const MAX_TEXT_TO_READ: number = 2000;

type TextOfFunction = (value: unknown) => string;

/*
 * A stored value as text: what If / Else compares too (ConditionEvaluation
 * reads true as "true", 500 as "500" and an object as its JSON).
 */
const textOf: TextOfFunction = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return String(value);
};

type ShortenFunction = (text: string, maxLength: number) => string;

// Cut at a whole character, so an emoji is never split in two.
const shorten: ShortenFunction = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  const characters: Array<string> = Array.from(
    text.slice(0, maxLength * 2),
  ).slice(0, maxLength - 1);

  return `${characters.join("").trimEnd()}…`;
};

type CaseNumberFunction = (index: number) => string;

const caseNumber: CaseNumberFunction = (index: number): string => {
  return `Case ${index + 1}`;
};

export interface SwitchCasesReading {
  cases: Array<SwitchCase>;
  /*
   * False when the stored cases are not a list at all (a JSON object, text
   * that is not a list): nothing can be read from them. An empty or missing
   * list reads fine, as no cases.
   */
  isReadable: boolean;
}

type ParseSwitchCasesFunction = (raw: unknown) => SwitchCasesReading;

/**
 * The stored cases, read the way every reader reads them.
 *
 * A list is what the settings write. A JSON text of a list is accepted too,
 * for a workflow written by hand. Anything in the list that is not an object
 * is skipped. A case keeps its id when it is a usable output id, not taken by
 * an earlier case and not one of the step's own outputs; any other case gets
 * the first free "case-N", in list order. That is the same on the canvas and
 * in the runner, so their outputs always match, and the settings save it.
 */
export const parseSwitchCases: ParseSwitchCasesFunction = (
  raw: unknown,
): SwitchCasesReading => {
  let list: unknown = raw;

  if (list === undefined || list === null) {
    return { cases: [], isReadable: true };
  }

  if (typeof list === "string") {
    if (list.trim() === "") {
      return { cases: [], isReadable: true };
    }

    try {
      list = JSON.parse(list);
    } catch {
      return { cases: [], isReadable: false };
    }
  }

  if (!Array.isArray(list)) {
    return { cases: [], isReadable: false };
  }

  const objects: Array<Record<string, unknown>> = list.filter(
    (item: unknown): item is Record<string, unknown> => {
      return Boolean(item) && typeof item === "object" && !Array.isArray(item);
    },
  );

  const taken: Set<string> = new Set<string>();

  const keptIds: Array<string | null> = objects.map(
    (item: Record<string, unknown>): string | null => {
      const id: unknown = item["id"];

      if (
        typeof id !== "string" ||
        !CASE_ID_PATTERN.test(id) ||
        RESERVED_CASE_IDS.includes(id) ||
        taken.has(id)
      ) {
        return null;
      }

      taken.add(id);
      return id;
    },
  );

  let next: number = 1;

  const cases: Array<SwitchCase> = objects.map(
    (item: Record<string, unknown>, index: number): SwitchCase => {
      let id: string | null = keptIds[index] || null;

      if (!id) {
        while (taken.has(`${SWITCH_CASE_ID_PREFIX}${next}`)) {
          next++;
        }

        id = `${SWITCH_CASE_ID_PREFIX}${next}`;
        taken.add(id);
      }

      return {
        id: id,
        comparison: textOf(item["comparison"]),
        value: textOf(item["value"]),
        compareAs: textOf(item["compareAs"]),
      };
    },
  );

  return { cases: cases, isReadable: true };
};

type ReadSwitchCasesFunction = (raw: unknown) => Array<SwitchCase>;

/** The stored cases, or none when they cannot be read. */
export const readSwitchCases: ReadSwitchCasesFunction = (
  raw: unknown,
): Array<SwitchCase> => {
  return parseSwitchCases(raw).cases;
};

type GetNextSwitchCaseIdFunction = (
  cases: Array<SwitchCase>,
  alsoTaken?: Array<string> | undefined,
) => string;

/**
 * The id for a new case: one past the highest "case-N" the list has, or has
 * had while the settings were open (`alsoTaken`). A removed case's id is not
 * handed out again, so the connection it had until the settings are saved
 * does not move to the new case.
 */
export const getNextSwitchCaseId: GetNextSwitchCaseIdFunction = (
  cases: Array<SwitchCase>,
  alsoTaken?: Array<string> | undefined,
): string => {
  let highest: number = 0;

  for (const id of [
    ...cases.map((switchCase: SwitchCase): string => {
      return switchCase.id;
    }),
    ...(alsoTaken || []),
  ]) {
    if (!id.startsWith(SWITCH_CASE_ID_PREFIX)) {
      continue;
    }

    const number: number = Number(id.slice(SWITCH_CASE_ID_PREFIX.length));

    if (Number.isInteger(number) && number > highest) {
      highest = number;
    }
  }

  return `${SWITCH_CASE_ID_PREFIX}${highest + 1}`;
};

type CreateSwitchCaseFunction = (id: string) => SwitchCase;

/** A case as it starts: is equal to, nothing to compare with yet, as text. */
export const createSwitchCase: CreateSwitchCaseFunction = (
  id: string,
): SwitchCase => {
  return {
    id: id,
    comparison: ConditionOperator.EqualTo,
    value: "",
    compareAs: ConditionValueType.Text,
  };
};

type GetStarterSwitchCasesFunction = () => Array<SwitchCase>;

/*
 * A new Switch / Case step's cases. Two, so the step shows what it is for -
 * one value, several ways to go - on the canvas before it is opened, and
 * each can be connected straight away.
 */
export const getStarterSwitchCases: GetStarterSwitchCasesFunction =
  (): Array<SwitchCase> => {
    return [
      createSwitchCase(`${SWITCH_CASE_ID_PREFIX}1`),
      createSwitchCase(`${SWITCH_CASE_ID_PREFIX}2`),
    ];
  };

type ToStoredSwitchCasesFunction = (cases: Array<SwitchCase>) => JSONValue;

/** The cases as they are saved. */
export const toStoredSwitchCases: ToStoredSwitchCasesFunction = (
  cases: Array<SwitchCase>,
): JSONValue => {
  return cases.map((switchCase: SwitchCase): JSONObject => {
    return {
      id: switchCase.id,
      comparison: switchCase.comparison,
      value: switchCase.value,
      compareAs: switchCase.compareAs,
    };
  });
};

type GetSwitchCaseComparisonFunction = (
  switchCase: SwitchCase,
) => ConditionComparison | null;

/**
 * The comparison a case reads as, in If / Else's words, or null when its
 * stored comparison is not one the step knows.
 */
export const getSwitchCaseComparison: GetSwitchCaseComparisonFunction = (
  switchCase: SwitchCase,
): ConditionComparison | null => {
  return comparisonForStoredCondition({
    operator: switchCase.comparison,
    compareWith: switchCase.value,
    valueToCheckType: switchCase.compareAs,
    compareWithType: switchCase.compareAs,
  });
};

type IsBlankFunction = (text: string) => boolean;

const isBlank: IsBlankFunction = (text: string): boolean => {
  return text.trim() === "";
};

type IsSwitchCaseSetUpFunction = (switchCase: SwitchCase) => boolean;

/**
 * Whether a case says what it compares: a comparison the step knows, and a
 * value to compare with when that comparison uses one.
 */
export const isSwitchCaseSetUp: IsSwitchCaseSetUpFunction = (
  switchCase: SwitchCase,
): boolean => {
  const comparison: ConditionComparison | null =
    getSwitchCaseComparison(switchCase);

  if (!comparison) {
    return false;
  }

  return !comparison.usesCompareWith || !isBlank(switchCase.value);
};

const GENERIC_FIELD_NAMES: Array<string> = [
  "name",
  "id",
  "_id",
  "value",
  "title",
  "text",
  "key",
  "type",
];

type ShortReferenceNameFunction = (inner: string) => string;

/**
 * A reference in a word or two, for a case's name and the step's summary on
 * the canvas: a variable by its name, a value from a step by the last field
 * it reads - and the field before it when the last is as plain as "name"
 * (incidentSeverity.name), or by the value's id when it reads no field.
 */
export const shortReferenceName: ShortReferenceNameFunction = (
  inner: string,
): string => {
  const parsed: ParsedReferencePath = parseReferencePath(inner);

  if (
    parsed.rootType === ReferenceRootType.LocalVariable ||
    parsed.rootType === ReferenceRootType.GlobalVariable
  ) {
    return parsed.variableName || inner;
  }

  if (parsed.rootType !== ReferenceRootType.ComponentReturnValue) {
    return inner;
  }

  // local.components.<step>.returnValues.<value>[.<field>...]
  const segments: Array<string> = inner.split(".").slice(4);

  if (segments.length === 0) {
    return parsed.componentId || inner;
  }

  if (segments.length === 1) {
    return segments[0] as string;
  }

  const last: string = segments[segments.length - 1] as string;

  if (GENERIC_FIELD_NAMES.includes(last.toLowerCase())) {
    return segments.slice(-2).join(".");
  }

  return last;
};

type NameTemplateValueFunction = (text: string) => string;

/**
 * A value as words: every {{...}} reference in it named by
 * shortReferenceName, the rest as typed.
 */
export const nameTemplateValue: NameTemplateValueFunction = (
  text: string,
): string => {
  const readable: string = shorten(text, MAX_TEXT_TO_READ);

  if (!readable.includes("{{")) {
    return readable;
  }

  let named: string = "";
  let position: number = 0;

  for (const expression of parseTemplateExpressions(readable)) {
    if (expression.kind !== TemplateExpressionKind.Reference) {
      continue;
    }

    named += readable.slice(position, expression.startIndex);
    named += shortReferenceName(expression.inner);
    position = expression.endIndex;
  }

  return named + readable.slice(position);
};

type HasReferenceFunction = (text: string) => boolean;

const hasReference: HasReferenceFunction = (text: string): boolean => {
  if (!text.includes("{{")) {
    return false;
  }

  return parseTemplateExpressions(shorten(text, MAX_TEXT_TO_READ)).some(
    (expression: TemplateExpression): boolean => {
      return expression.kind === TemplateExpressionKind.Reference;
    },
  );
};

type GetSwitchCaseLabelFunction = (
  switchCase: SwitchCase,
  index: number,
) => string;

/**
 * What a case's output is called on the canvas: the value it matches -
 * "Critical Incident" - for is equal to, the comparison and the value for
 * the rest - "contains timeout" - and the comparison alone for those that
 * need no value - "is empty". "Case 2" until it says what it compares.
 */
export const getSwitchCaseLabel: GetSwitchCaseLabelFunction = (
  switchCase: SwitchCase,
  index: number,
): string => {
  const comparison: ConditionComparison | null =
    getSwitchCaseComparison(switchCase);

  if (!comparison) {
    return caseNumber(index);
  }

  if (!comparison.usesCompareWith) {
    return comparison.label;
  }

  const value: string = nameTemplateValue(switchCase.value).trim();

  if (!value) {
    return caseNumber(index);
  }

  return shorten(
    comparison.id === ConditionComparisonId.EqualTo
      ? value
      : `${comparison.label} ${value}`,
    SWITCH_CASE_LABEL_MAX_LENGTH,
  );
};

type QuoteCaseValueFunction = (switchCase: SwitchCase) => string;

/*
 * A case's value as a sentence quotes it: a number compared as a number and
 * true or false compared as true or false read as themselves, a reference by
 * its name, anything else in quotes so its spaces and capitals show.
 */
const quoteCaseValue: QuoteCaseValueFunction = (
  switchCase: SwitchCase,
): string => {
  const raw: string = switchCase.value;

  if (hasReference(raw)) {
    return shorten(nameTemplateValue(raw), SENTENCE_VALUE_MAX_LENGTH);
  }

  const types: ConditionTypes = getEffectiveConditionTypes(
    switchCase.compareAs,
    switchCase.compareAs,
  );

  const readsAsItself: boolean =
    (types.compareWith === ConditionValueType.Number &&
      !isBlank(raw) &&
      !isNaN(Number(raw))) ||
    (types.compareWith === ConditionValueType.Boolean &&
      (raw === "true" || raw === "false"));

  if (readsAsItself) {
    return raw;
  }

  return `“${shorten(raw, SENTENCE_VALUE_MAX_LENGTH)}”`;
};

type DescribeSwitchCaseConditionFunction = (
  switchCase: SwitchCase,
) => string | null;

/**
 * What a case asks of the value, in the words of If / Else's comparisons:
 * "is equal to “Critical Incident”", "is greater than 500", "is empty".
 * Null while it does not say yet.
 */
export const describeSwitchCaseCondition: DescribeSwitchCaseConditionFunction =
  (switchCase: SwitchCase): string | null => {
    const comparison: ConditionComparison | null =
      getSwitchCaseComparison(switchCase);

    if (!comparison) {
      return null;
    }

    if (!comparison.usesCompareWith) {
      return comparison.label;
    }

    if (isBlank(switchCase.value)) {
      return null;
    }

    return `${comparison.label} ${quoteCaseValue(switchCase)}`;
  };

type GetSwitchCasePortFunction = (
  switchCase: SwitchCase,
  index: number,
) => Port;

/** A case's output: its id, its name, and when it runs. */
export const getSwitchCasePort: GetSwitchCasePortFunction = (
  switchCase: SwitchCase,
  index: number,
): Port => {
  const condition: string | null = describeSwitchCaseCondition(switchCase);

  let description: string =
    "Runs next when this case matches. It is not set up yet.";

  if (condition) {
    description =
      index === 0
        ? `Runs next when the value ${condition}.`
        : `Runs next when the value ${condition} and no case above it matches.`;
  }

  return {
    id: switchCase.id,
    title: getSwitchCaseLabel(switchCase, index),
    description: description,
  };
};

type GetSwitchOutPortsFunction = (
  args: JSONObject | undefined | null,
) => Array<Port>;

/**
 * A Switch / Case step's outputs, read from its settings: one per case, in
 * the order the cases are checked, then Default.
 */
export const getSwitchOutPorts: GetSwitchOutPortsFunction = (
  args: JSONObject | undefined | null,
): Array<Port> => {
  const cases: Array<SwitchCase> = readSwitchCases(
    args ? args[SWITCH_ARGUMENT_IDS.cases] : undefined,
  );

  return [
    ...cases.map((switchCase: SwitchCase, index: number): Port => {
      return getSwitchCasePort(switchCase, index);
    }),
    SWITCH_DEFAULT_PORT,
  ];
};

type FindUnknownComparisonFunction = (
  cases: Array<SwitchCase>,
) => { index: number; switchCase: SwitchCase } | null;

/** The first case whose comparison the step does not know, if any. */
export const findSwitchCaseWithUnknownComparison: FindUnknownComparisonFunction =
  (
    cases: Array<SwitchCase>,
  ): { index: number; switchCase: SwitchCase } | null => {
    for (let index: number = 0; index < cases.length; index++) {
      const switchCase: SwitchCase = cases[index] as SwitchCase;

      if (!resolveConditionOperator(switchCase.comparison)) {
        return { index: index, switchCase: switchCase };
      }
    }

    return null;
  };

type GetUnknownComparisonMessageFunction = (data: {
  index: number;
  switchCase: SwitchCase;
}) => string;

/** Why a run stops on a case whose comparison the step does not know. */
export const getUnknownSwitchComparisonMessage: GetUnknownComparisonMessageFunction =
  (data: { index: number; switchCase: SwitchCase }): string => {
    return `Switch / Case cannot compare case ${data.index + 1} with "${shorten(
      data.switchCase.comparison,
      SENTENCE_VALUE_MAX_LENGTH,
    )}". Open the step and choose a comparison for it, such as is equal to.`;
  };

export interface SwitchCaseCheck {
  index: number;
  switchCase: SwitchCase;
  isMatch: boolean;
}

export interface SwitchEvaluation {
  // The case taken, or null when no case matched and Default is taken.
  matched: { index: number; switchCase: SwitchCase } | null;
  // Every case checked, in order: up to the one that matched, or all of them.
  checks: Array<SwitchCaseCheck>;
}

type EvaluateSwitchFunction = (data: {
  valueToCheck: JSONValue | undefined;
  cases: Array<SwitchCase>;
}) => SwitchEvaluation;

/**
 * Which case a value takes: the first one, from the top, that If / Else
 * would say Yes to, or none (Default). A case that matches ends the
 * checking. Every case's comparison is checked before any is compared, so a
 * step with a broken case fails on every run rather than only on the values
 * that reach it: a BadDataException that names the case.
 */
export const evaluateSwitch: EvaluateSwitchFunction = (data: {
  valueToCheck: JSONValue | undefined;
  cases: Array<SwitchCase>;
}): SwitchEvaluation => {
  const unknown: { index: number; switchCase: SwitchCase } | null =
    findSwitchCaseWithUnknownComparison(data.cases);

  if (unknown) {
    throw new BadDataException(getUnknownSwitchComparisonMessage(unknown));
  }

  const checks: Array<SwitchCaseCheck> = [];

  for (let index: number = 0; index < data.cases.length; index++) {
    const switchCase: SwitchCase = data.cases[index] as SwitchCase;

    const isMatch: boolean = evaluateCondition({
      valueToCheck: data.valueToCheck,
      operator: switchCase.comparison,
      compareWith: switchCase.value,
      valueToCheckType: switchCase.compareAs,
      compareWithType: switchCase.compareAs,
    });

    checks.push({ index: index, switchCase: switchCase, isMatch: isMatch });

    if (isMatch) {
      return {
        matched: { index: index, switchCase: switchCase },
        checks: checks,
      };
    }
  }

  return { matched: null, checks: checks };
};

type ListCaseNumbersFunction = (count: number) => string;

// "case 1", "cases 1 and 2", "cases 1 to 4".
const listCaseNumbers: ListCaseNumbersFunction = (count: number): string => {
  if (count === 1) {
    return "Case 1";
  }

  if (count === 2) {
    return "Cases 1 and 2";
  }

  return `Cases 1 to ${count}`;
};

type DescribeSwitchEvaluationFunction = (data: {
  evaluation: SwitchEvaluation;
  /*
   * The cases as configured, which the sentence names: never the values a
   * run resolved them to, which can be a secret variable's.
   */
  configuredCases: Array<SwitchCase>;
}) => string;

/**
 * Why the step went the way it did, for the run's Steps view: which case
 * matched, what it asked, and that the cases above it did not - or that no
 * case did. The value itself is shown with what the step received.
 */
export const describeSwitchEvaluation: DescribeSwitchEvaluationFunction =
  (data: {
    evaluation: SwitchEvaluation;
    configuredCases: Array<SwitchCase>;
  }): string => {
    const matched: { index: number; switchCase: SwitchCase } | null =
      data.evaluation.matched;
    const caseCount: number = data.configuredCases.length;

    if (!matched) {
      if (caseCount === 0) {
        return "This step has no cases, so it took Default.";
      }

      return caseCount === 1
        ? "The one case did not match, so the step took Default."
        : `None of the ${caseCount} cases matched, so the step took Default.`;
    }

    const configured: SwitchCase =
      data.configuredCases[matched.index] || matched.switchCase;
    const condition: string | null = describeSwitchCaseCondition(configured);

    const sentence: string = condition
      ? `Case ${matched.index + 1} matched: the value ${condition}.`
      : `Case ${matched.index + 1} matched.`;

    if (matched.index === 0) {
      return sentence;
    }

    return `${sentence} ${listCaseNumbers(matched.index)} did not.`;
  };

type DescribeSwitchCaseCheckFunction = (data: {
  check: SwitchCaseCheck;
  configuredCases: Array<SwitchCase>;
}) => string;

/** One line of the run's log for one case checked. */
export const describeSwitchCaseCheck: DescribeSwitchCaseCheckFunction = (data: {
  check: SwitchCaseCheck;
  configuredCases: Array<SwitchCase>;
}): string => {
  const configured: SwitchCase =
    data.configuredCases[data.check.index] || data.check.switchCase;

  return `Case ${data.check.index + 1} (${getSwitchCaseLabel(
    configured,
    data.check.index,
  )}): ${data.check.isMatch ? "matched" : "no match"}.`;
};

type SameCaseFunction = (first: SwitchCase, second: SwitchCase) => boolean;

/*
 * Whether two cases ask the same of a value, so the later one can never be
 * reached: the same comparison, compared the same way, with the same value
 * where the comparison uses one.
 */
const asksTheSame: SameCaseFunction = (
  first: SwitchCase,
  second: SwitchCase,
): boolean => {
  const firstOperator: ResolvedConditionOperator | null =
    resolveConditionOperator(first.comparison);
  const secondOperator: ResolvedConditionOperator | null =
    resolveConditionOperator(second.comparison);

  if (!firstOperator || firstOperator !== secondOperator) {
    return false;
  }

  const firstComparison: ConditionComparison | null =
    getSwitchCaseComparison(first);

  if (firstComparison?.kind === ConditionComparisonKind.Presence) {
    return true;
  }

  const firstTypes: ConditionTypes = getEffectiveConditionTypes(
    first.compareAs,
    first.compareAs,
  );
  const secondTypes: ConditionTypes = getEffectiveConditionTypes(
    second.compareAs,
    second.compareAs,
  );

  return (
    firstTypes.compareWith === secondTypes.compareWith &&
    first.value === second.value
  );
};

export interface ShadowedSwitchCase {
  index: number;
  // The earlier case that asks the same, which is always taken first.
  sameAsIndex: number;
}

type FindShadowedSwitchCasesFunction = (
  cases: Array<SwitchCase>,
) => Array<ShadowedSwitchCase>;

/**
 * The cases that repeat an earlier one, which can never be taken: whatever
 * would match them matches the earlier case first. Only cases that say what
 * they compare are counted, so two new, empty cases are not.
 */
export const findShadowedSwitchCases: FindShadowedSwitchCasesFunction = (
  cases: Array<SwitchCase>,
): Array<ShadowedSwitchCase> => {
  const shadowed: Array<ShadowedSwitchCase> = [];

  for (let index: number = 1; index < cases.length; index++) {
    const switchCase: SwitchCase = cases[index] as SwitchCase;

    if (!isSwitchCaseSetUp(switchCase)) {
      continue;
    }

    for (let earlier: number = 0; earlier < index; earlier++) {
      const earlierCase: SwitchCase = cases[earlier] as SwitchCase;

      if (
        isSwitchCaseSetUp(earlierCase) &&
        asksTheSame(earlierCase, switchCase)
      ) {
        shadowed.push({ index: index, sameAsIndex: earlier });
        break;
      }
    }
  }

  return shadowed;
};
