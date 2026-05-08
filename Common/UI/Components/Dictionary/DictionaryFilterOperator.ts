import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import NotContains from "../../../Types/BaseDatabase/NotContains";
import StartsWith from "../../../Types/BaseDatabase/StartsWith";
import EndsWith from "../../../Types/BaseDatabase/EndsWith";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThan from "../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import { ObjectType } from "../../../Types/JSON";

/*
 * UI-facing operator identifiers. We store these in the Dictionary form
 * state and translate to the corresponding backend operator wrapper at
 * the API boundary so the existing serialization pipeline works.
 */
export enum DictionaryFilterOperator {
  EqualTo = "EqualTo",
  NotEqual = "NotEqual",
  Contains = "Contains",
  NotContains = "NotContains",
  StartsWith = "StartsWith",
  EndsWith = "EndsWith",
  GreaterThan = "GreaterThan",
  LessThan = "LessThan",
  GreaterThanOrEqual = "GreaterThanOrEqual",
  LessThanOrEqual = "LessThanOrEqual",
  IsEmpty = "IsEmpty",
  IsNotEmpty = "IsNotEmpty",
}

export interface DictionaryFilterOperatorOption {
  operator: DictionaryFilterOperator;
  label: string;
  symbol: string;
  // Operators like IsEmpty/IsNotEmpty don't take a user-supplied value.
  hidesValueInput?: boolean | undefined;
  // Numeric operators force a numeric value input.
  expectsNumericValue?: boolean | undefined;
}

export const DICTIONARY_FILTER_OPERATOR_OPTIONS: ReadonlyArray<DictionaryFilterOperatorOption> =
  [
    {
      operator: DictionaryFilterOperator.EqualTo,
      label: "equals",
      symbol: "=",
    },
    {
      operator: DictionaryFilterOperator.NotEqual,
      label: "does not equal",
      symbol: "!=",
    },
    {
      operator: DictionaryFilterOperator.Contains,
      label: "contains",
      symbol: "contains",
    },
    {
      operator: DictionaryFilterOperator.NotContains,
      label: "does not contain",
      symbol: "does not contain",
    },
    {
      operator: DictionaryFilterOperator.StartsWith,
      label: "starts with",
      symbol: "starts with",
    },
    {
      operator: DictionaryFilterOperator.EndsWith,
      label: "ends with",
      symbol: "ends with",
    },
    {
      operator: DictionaryFilterOperator.GreaterThan,
      label: "greater than",
      symbol: ">",
      expectsNumericValue: true,
    },
    {
      operator: DictionaryFilterOperator.GreaterThanOrEqual,
      label: "greater than or equal",
      symbol: ">=",
      expectsNumericValue: true,
    },
    {
      operator: DictionaryFilterOperator.LessThan,
      label: "less than",
      symbol: "<",
      expectsNumericValue: true,
    },
    {
      operator: DictionaryFilterOperator.LessThanOrEqual,
      label: "less than or equal",
      symbol: "<=",
      expectsNumericValue: true,
    },
    {
      operator: DictionaryFilterOperator.IsEmpty,
      label: "is empty",
      symbol: "is empty",
      hidesValueInput: true,
    },
    {
      operator: DictionaryFilterOperator.IsNotEmpty,
      label: "is not empty",
      symbol: "is not empty",
      hidesValueInput: true,
    },
  ];

export type DictionaryEntryValue =
  | string
  | number
  | boolean
  | EqualTo<string>
  | NotEqual<string>
  | Search<string>
  | NotContains<string>
  | StartsWith<string>
  | EndsWith<string>
  | GreaterThan<number>
  | GreaterThanOrEqual<number>
  | LessThan<number>
  | LessThanOrEqual<number>
  | IsNull
  | NotNull;

export const getOperatorOption: (
  operator: DictionaryFilterOperator,
) => DictionaryFilterOperatorOption = (
  operator: DictionaryFilterOperator,
): DictionaryFilterOperatorOption => {
  return (
    DICTIONARY_FILTER_OPERATOR_OPTIONS.find(
      (option: DictionaryFilterOperatorOption) => {
        return option.operator === operator;
      },
    ) ?? DICTIONARY_FILTER_OPERATOR_OPTIONS[0]!
  );
};

/*
 * Detect operator wrapper instances or `_type`-tagged plain objects
 * (already-deserialized vs raw-from-storage).
 */
type ObjectTypeLike = { _type?: string };

const matchesObjectType: (value: unknown, type: ObjectType) => boolean = (
  value: unknown,
  type: ObjectType,
): boolean => {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as ObjectTypeLike)._type === type,
  );
};

interface RawValueAndOperator {
  operator: DictionaryFilterOperator;
  rawValue: string;
}

/**
 * Inspect a stored dictionary entry value (which may be a plain string,
 * a hydrated operator instance, or a raw `{_type, value}` JSON shape)
 * and recover the operator + display value used to populate the form.
 */
export const detectOperatorFromValue: (
  value: unknown,
) => RawValueAndOperator = (value: unknown): RawValueAndOperator => {
  if (value === null || value === undefined) {
    return {
      operator: DictionaryFilterOperator.EqualTo,
      rawValue: "",
    };
  }

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return {
      operator: DictionaryFilterOperator.EqualTo,
      rawValue: String(value),
    };
  }

  if (value instanceof IsNull || matchesObjectType(value, ObjectType.IsNull)) {
    return { operator: DictionaryFilterOperator.IsEmpty, rawValue: "" };
  }
  if (
    value instanceof NotNull ||
    matchesObjectType(value, ObjectType.NotNull)
  ) {
    return { operator: DictionaryFilterOperator.IsNotEmpty, rawValue: "" };
  }

  const wrapperValue: string =
    value instanceof Object && "value" in value
      ? String(
          (value as { value?: unknown }).value === undefined ||
            (value as { value?: unknown }).value === null
            ? ""
            : (value as { value?: unknown }).value,
        )
      : "";

  if (
    value instanceof NotEqual ||
    matchesObjectType(value, ObjectType.NotEqual)
  ) {
    return {
      operator: DictionaryFilterOperator.NotEqual,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof EqualTo ||
    matchesObjectType(value, ObjectType.EqualTo)
  ) {
    return {
      operator: DictionaryFilterOperator.EqualTo,
      rawValue: wrapperValue,
    };
  }
  if (value instanceof Search || matchesObjectType(value, ObjectType.Search)) {
    return {
      operator: DictionaryFilterOperator.Contains,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof NotContains ||
    matchesObjectType(value, ObjectType.NotContains)
  ) {
    return {
      operator: DictionaryFilterOperator.NotContains,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof StartsWith ||
    matchesObjectType(value, ObjectType.StartsWith)
  ) {
    return {
      operator: DictionaryFilterOperator.StartsWith,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof EndsWith ||
    matchesObjectType(value, ObjectType.EndsWith)
  ) {
    return {
      operator: DictionaryFilterOperator.EndsWith,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof GreaterThan ||
    matchesObjectType(value, ObjectType.GreaterThan)
  ) {
    return {
      operator: DictionaryFilterOperator.GreaterThan,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof GreaterThanOrEqual ||
    matchesObjectType(value, ObjectType.GreaterThanOrEqual)
  ) {
    return {
      operator: DictionaryFilterOperator.GreaterThanOrEqual,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof LessThan ||
    matchesObjectType(value, ObjectType.LessThan)
  ) {
    return {
      operator: DictionaryFilterOperator.LessThan,
      rawValue: wrapperValue,
    };
  }
  if (
    value instanceof LessThanOrEqual ||
    matchesObjectType(value, ObjectType.LessThanOrEqual)
  ) {
    return {
      operator: DictionaryFilterOperator.LessThanOrEqual,
      rawValue: wrapperValue,
    };
  }

  // Unknown structure — fall back to bare equality with stringified value.
  return {
    operator: DictionaryFilterOperator.EqualTo,
    rawValue: wrapperValue,
  };
};

/**
 * Build the actual stored dictionary value for an operator + raw value.
 * `EqualTo` produces a bare string for backwards compatibility with
 * existing saved filters; everything else produces an operator wrapper
 * instance.
 */
export const buildDictionaryValue: (input: {
  operator: DictionaryFilterOperator;
  rawValue: string;
}) => DictionaryEntryValue = (input: {
  operator: DictionaryFilterOperator;
  rawValue: string;
}): DictionaryEntryValue => {
  const { operator, rawValue } = input;
  const trimmed: string = rawValue ?? "";

  switch (operator) {
    case DictionaryFilterOperator.EqualTo:
      return trimmed;
    case DictionaryFilterOperator.NotEqual:
      return new NotEqual<string>(trimmed);
    case DictionaryFilterOperator.Contains:
      /*
       * Statement.serialize already wraps Search instances with `%...%`,
       * so pass the bare needle here.
       */
      return new Search<string>(trimmed);
    case DictionaryFilterOperator.NotContains:
      return new NotContains<string>(trimmed);
    case DictionaryFilterOperator.StartsWith:
      return new StartsWith<string>(trimmed);
    case DictionaryFilterOperator.EndsWith:
      return new EndsWith<string>(trimmed);
    case DictionaryFilterOperator.GreaterThan:
      return new GreaterThan<number>(Number(trimmed));
    case DictionaryFilterOperator.GreaterThanOrEqual:
      return new GreaterThanOrEqual<number>(Number(trimmed));
    case DictionaryFilterOperator.LessThan:
      return new LessThan<number>(Number(trimmed));
    case DictionaryFilterOperator.LessThanOrEqual:
      return new LessThanOrEqual<number>(Number(trimmed));
    case DictionaryFilterOperator.IsEmpty:
      return new IsNull();
    case DictionaryFilterOperator.IsNotEmpty:
      return new NotNull();
    default:
      return trimmed;
  }
};
