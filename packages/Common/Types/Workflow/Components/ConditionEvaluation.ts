/*
 * How the If / Else step decides between Yes and No.
 *
 * The step used to build a line of JavaScript out of its settings -
 * `const input1 = <value>; const input2 = <value>; return input1 <op> input2;`
 * - and run it in the script sandbox, which also gives scripts an HTTP
 * client. The comparison was written into that code as it was stored, so an
 * operator taken from a reference (a webhook's body, say) was code that ran.
 * This decides the same way without writing or running any code: each value
 * is converted exactly as that line converted it, and compared with the rule
 * JavaScript applies to the operator. Every workflow that already runs gives
 * the same answer (Tests/Types/Workflow/ConditionEvaluation.test.ts holds this
 * against the old code, for every operator and type).
 *
 * What changed on purpose:
 * - a comparison the step does not know fails the run with a sentence that
 *   says so. Before, it was pasted into the code: a syntax error at best;
 * - "is empty" and "is not empty" are new;
 * - a word comparison is matched without regard to case or extra spaces
 *   ("Contains" used to fail the run).
 *
 * Pure: the builder uses it too, to describe a condition in words.
 */

import BadDataException from "../../Exception/BadDataException";
import { JSONValue } from "../../JSON";
import { ConditionOperator, ConditionValueType } from "./Condition";

/*
 * Operators the editor never offered that the old code still ran correctly
 * when a workflow held them (one written through the API, say).
 */
export enum LegacyConditionOperator {
  StrictEqualTo = "===",
  StrictNotEqualTo = "!==",
}

export type ResolvedConditionOperator =
  | ConditionOperator
  | LegacyConditionOperator;

export type ConditionPrimitive = string | number | boolean | null | undefined;

const KNOWN_OPERATORS: Array<ResolvedConditionOperator> = [
  ...Object.values(ConditionOperator),
  ...Object.values(LegacyConditionOperator),
];

type NormalizeConditionOperatorTextFunction = (raw: string) => string;

/** A stored comparison as it is matched: trimmed, lower case, single spaces. */
export const normalizeConditionOperatorText: NormalizeConditionOperatorTextFunction =
  (raw: string): string => {
    return raw.trim().replace(/\s+/g, " ").toLowerCase();
  };

type ResolveConditionOperatorFunction = (
  raw: unknown,
) => ResolvedConditionOperator | null;

/**
 * The comparison a stored operator means, or null when it is not one the
 * step knows. Nothing stored is "is equal to", as it always was.
 */
export const resolveConditionOperator: ResolveConditionOperatorFunction = (
  raw: unknown,
): ResolvedConditionOperator | null => {
  // The old code compared with `operator || "=="`.
  if (!raw) {
    return ConditionOperator.EqualTo;
  }

  const normalized: string = normalizeConditionOperatorText(String(raw));

  if (normalized === "") {
    return ConditionOperator.EqualTo;
  }

  return (
    KNOWN_OPERATORS.find((operator: ResolvedConditionOperator) => {
      return operator === normalized;
    }) || null
  );
};

const VALUE_TYPES: Array<string> = Object.values(ConditionValueType);

type GetConditionValueTypeFunction = (raw: unknown) => ConditionValueType;

/**
 * The type a stored "input-N-type" means. Missing, or anything that is not
 * one of the types, compares as Text, which is what the old code did with
 * it (exact spelling: "Number" was never a number).
 */
export const getConditionValueType: GetConditionValueTypeFunction = (
  raw: unknown,
): ConditionValueType => {
  if (typeof raw === "string" && VALUE_TYPES.includes(raw)) {
    return raw as ConditionValueType;
  }

  return ConditionValueType.Text;
};

type IsNullishConditionTypeFunction = (type: ConditionValueType) => boolean;

export const isNullishConditionType: IsNullishConditionTypeFunction = (
  type: ConditionValueType,
): boolean => {
  return (
    type === ConditionValueType.Null || type === ConditionValueType.Undefined
  );
};

const TYPE_PRIORITY: Record<ConditionValueType, number> = {
  [ConditionValueType.Boolean]: 2,
  [ConditionValueType.Number]: 1,
  [ConditionValueType.Text]: 0,
  [ConditionValueType.Null]: 0,
  [ConditionValueType.Undefined]: 0,
};

export interface ConditionTypes {
  valueToCheck: ConditionValueType;
  compareWith: ConditionValueType;
}

type GetEffectiveConditionTypesFunction = (
  valueToCheckType: unknown,
  compareWithType: unknown,
) => ConditionTypes;

/**
 * How each value is really compared. Two different types meet at the more
 * specific one (true or false over number over text), so text "200" and
 * number 200 are both numbers. Null and Undefined are never changed, nor
 * change the other side.
 */
export const getEffectiveConditionTypes: GetEffectiveConditionTypesFunction = (
  valueToCheckType: unknown,
  compareWithType: unknown,
): ConditionTypes => {
  const first: ConditionValueType = getConditionValueType(valueToCheckType);
  const second: ConditionValueType = getConditionValueType(compareWithType);

  if (
    first === second ||
    isNullishConditionType(first) ||
    isNullishConditionType(second)
  ) {
    return { valueToCheck: first, compareWith: second };
  }

  const common: ConditionValueType =
    TYPE_PRIORITY[first] >= TYPE_PRIORITY[second] ? first : second;

  return { valueToCheck: common, compareWith: common };
};

type ConditionTextOfFunction = (value: JSONValue | undefined) => string;

/*
 * The text a value is read as before its type applies, as the old code read
 * it: objects (null among them) as JSON, nothing as "".
 */
const conditionTextOf: ConditionTextOfFunction = (
  value: JSONValue | undefined,
): string => {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value ?? "");
};

type ToConditionValueFunction = (
  value: JSONValue | undefined,
  type: ConditionValueType,
) => ConditionPrimitive;

/** A value as it is compared under a type. */
export const toConditionValue: ToConditionValueFunction = (
  value: JSONValue | undefined,
  type: ConditionValueType,
): ConditionPrimitive => {
  const text: string = conditionTextOf(value);

  switch (type) {
    case ConditionValueType.Boolean:
      return text === "true";
    case ConditionValueType.Number: {
      const number: number = Number(text);
      // Not a number counts as 0; -0 was written out as 0.
      return isNaN(number) || number === 0 ? 0 : number;
    }
    case ConditionValueType.Null:
      return null;
    case ConditionValueType.Undefined:
      return undefined;
    case ConditionValueType.Text:
    default:
      return text;
  }
};

type ToNumberFunction = (value: ConditionPrimitive) => number;

// JavaScript's ToNumber, for the values a condition compares.
const toNumber: ToNumberFunction = (value: ConditionPrimitive): number => {
  if (value === undefined) {
    return NaN;
  }

  if (value === null) {
    return 0;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (typeof value === "number") {
    return value;
  }

  return Number(value);
};

type CompareFunction = (
  left: ConditionPrimitive,
  right: ConditionPrimitive,
) => boolean;

// JavaScript's ==, for the values a condition compares.
const looselyEquals: CompareFunction = (
  left: ConditionPrimitive,
  right: ConditionPrimitive,
): boolean => {
  const leftIsNullish: boolean = left === null || left === undefined;
  const rightIsNullish: boolean = right === null || right === undefined;

  if (leftIsNullish || rightIsNullish) {
    return leftIsNullish && rightIsNullish;
  }

  if (typeof left === typeof right) {
    return left === right;
  }

  if (typeof left === "boolean") {
    return looselyEquals(left ? 1 : 0, right);
  }

  if (typeof right === "boolean") {
    return looselyEquals(left, right ? 1 : 0);
  }

  // A number and a string: the string is read as a number.
  return toNumber(left) === toNumber(right);
};

type LessThanFunction = (
  left: ConditionPrimitive,
  right: ConditionPrimitive,
) => boolean | undefined;

/*
 * JavaScript's < : two strings letter by letter, anything else as numbers.
 * Undefined when a side is not a number, which makes <, >, <= and >= all
 * false.
 */
const lessThan: LessThanFunction = (
  left: ConditionPrimitive,
  right: ConditionPrimitive,
): boolean | undefined => {
  if (typeof left === "string" && typeof right === "string") {
    return left < right;
  }

  const leftNumber: number = toNumber(left);
  const rightNumber: number = toNumber(right);

  if (isNaN(leftNumber) || isNaN(rightNumber)) {
    return undefined;
  }

  return leftNumber < rightNumber;
};

type IsUnresolvedReferenceFunction = (text: string) => boolean;

const WHOLE_REFERENCE: RegExp = /^\{\{\s*(?:local|global)\.[^{}]*\}\}$/;

/*
 * A value that is still one whole {{local.…}} or {{global.…}} reference when
 * the step runs points at nothing: the runner leaves a reference it cannot
 * resolve as it was written.
 */
const isUnresolvedReference: IsUnresolvedReferenceFunction = (
  text: string,
): boolean => {
  return WHOLE_REFERENCE.test(text);
};

type IsEmptyConditionValueFunction = (value: JSONValue | undefined) => boolean;

/**
 * What "is empty" means: nothing at all, blank text, an empty list or object
 * (which a reference hands over as "[]" or "{}"), or a reference that found
 * nothing to point at - a field the webhook did not send, say. 0 and false
 * are values, not empty.
 */
export const isEmptyConditionValue: IsEmptyConditionValueFunction = (
  value: JSONValue | undefined,
): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    const text: string = value.trim();

    if (text === "" || isUnresolvedReference(text)) {
      return true;
    }

    if (text.startsWith("[") || text.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(text);

        if (Array.isArray(parsed)) {
          return parsed.length === 0;
        }

        if (parsed && typeof parsed === "object") {
          return Object.keys(parsed as Record<string, unknown>).length === 0;
        }
      } catch {
        return false;
      }
    }

    return false;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }

  return false;
};

export interface ConditionInputs {
  valueToCheck: JSONValue | undefined;
  operator: JSONValue | undefined;
  compareWith?: JSONValue | undefined;
  valueToCheckType?: JSONValue | undefined;
  compareWithType?: JSONValue | undefined;
}

type EvaluateConditionFunction = (inputs: ConditionInputs) => boolean;

/**
 * Whether the condition is met: true continues on Yes, false on No. Throws
 * a BadDataException for a comparison the step does not know.
 */
export const evaluateCondition: EvaluateConditionFunction = (
  inputs: ConditionInputs,
): boolean => {
  const operator: ResolvedConditionOperator | null = resolveConditionOperator(
    inputs.operator,
  );

  if (!operator) {
    throw new BadDataException(
      `If / Else cannot compare with "${String(inputs.operator)}". Open the step and choose a comparison, such as is equal to.`,
    );
  }

  if (operator === ConditionOperator.IsEmpty) {
    return isEmptyConditionValue(inputs.valueToCheck);
  }

  if (operator === ConditionOperator.IsNotEmpty) {
    return !isEmptyConditionValue(inputs.valueToCheck);
  }

  const types: ConditionTypes = getEffectiveConditionTypes(
    inputs.valueToCheckType,
    inputs.compareWithType,
  );

  const left: ConditionPrimitive = toConditionValue(
    inputs.valueToCheck,
    types.valueToCheck,
  );
  const right: ConditionPrimitive = toConditionValue(
    inputs.compareWith,
    types.compareWith,
  );

  switch (operator) {
    case ConditionOperator.EqualTo:
      return looselyEquals(left, right);
    case ConditionOperator.NotEqualTo:
      return !looselyEquals(left, right);
    case LegacyConditionOperator.StrictEqualTo:
      return left === right;
    case LegacyConditionOperator.StrictNotEqualTo:
      return left !== right;
    case ConditionOperator.GreaterThan:
      return lessThan(right, left) === true;
    case ConditionOperator.LessThan:
      return lessThan(left, right) === true;
    case ConditionOperator.GreaterThanOrEqualTo: {
      const isLess: boolean | undefined = lessThan(left, right);
      return isLess === undefined ? false : !isLess;
    }
    case ConditionOperator.LessThanOrEqualTo: {
      const isGreater: boolean | undefined = lessThan(right, left);
      return isGreater === undefined ? false : !isGreater;
    }
    case ConditionOperator.Contains:
      return String(left).includes(String(right));
    case ConditionOperator.DoesNotContain:
      return !String(left).includes(String(right));
    case ConditionOperator.StartsWith:
      return String(left).startsWith(String(right));
    case ConditionOperator.EndsWith:
      return String(left).endsWith(String(right));
    default:
      return false;
  }
};
