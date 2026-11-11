import FilterCondition from "../Filter/FilterCondition";
import { JSONObject } from "../JSON";
import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "./CriteriaFilter";

/*
 * THE VALUES OF A CRITERIA'S FILTERS, WRITTEN ANOTHER WAY.
 *
 * A criteria's filters are stored as JSON that nothing checked, and every
 * check compares their values with the ones OneUptime writes: a filter
 * whose condition is not one of them matches nothing (CompareCriteria),
 * one whose aggregation is not one reads no value for its window, and a
 * no-data policy that is not one is no policy. The Terraform provider
 * takes only the values OneUptime writes; the API and the MCP server took
 * anything. A Metrics monitor an AI created through the MCP server stored
 * its conditions as "GreaterThan" and "LessThanOrEqual" - so its alert
 * could never fire on a value, only on a window with no data.
 *
 * So each value is read as the one it means when it is written another
 * way - in another case, with other spaces or none ("GreaterThan",
 * "greater_than"), as a symbol (">", "<="), as a short name ("gte"), or in
 * the words the Dashboard shows ("At least") - whenever a criteria is read
 * (MonitorCriteriaInstance.fromJSON). A value that means none is left as
 * written, for a write to refuse (getUnreadableErrors, from
 * MonitorCriteriaInstance.getValidationError and the server's
 * MonitorStepsValuesUtil).
 */

// The longest text read as a value: every value is far shorter.
const MAX_VALUE_TEXT_LENGTH: number = 128;

// A text's letters and digits, lower case: "Greater Than" is "greaterthan".
const lettersAndDigitsOf: (text: string) => string = (text: string): string => {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
};

interface ValueSet<T extends string> {
  values: ReadonlyArray<T>;
  /*
   * Each value by its letters and digits, and by each other name for it.
   * Null where two values have the same letters: neither is guessed.
   */
  byLettersAndDigits: Map<string, T | null>;
  // Each value by a symbol written for it: ">" is Greater Than.
  bySymbol: Map<string, T>;
}

const makeValueSet: <T extends string>(data: {
  values: ReadonlyArray<T>;
  otherNames?: Record<string, T> | undefined;
  symbols?: Record<string, T> | undefined;
}) => ValueSet<T> = <T extends string>(data: {
  values: ReadonlyArray<T>;
  otherNames?: Record<string, T> | undefined;
  symbols?: Record<string, T> | undefined;
}): ValueSet<T> => {
  const byLettersAndDigits: Map<string, T | null> = new Map<string, T | null>();

  const add: (name: string, value: T) => void = (
    name: string,
    value: T,
  ): void => {
    const key: string = lettersAndDigitsOf(name);
    const known: T | null | undefined = byLettersAndDigits.get(key);

    byLettersAndDigits.set(
      key,
      known === undefined || known === value ? value : null,
    );
  };

  for (const value of data.values) {
    add(value, value);
  }

  for (const name of Object.keys(data.otherNames || {})) {
    add(name, data.otherNames![name]!);
  }

  return {
    values: data.values,
    byLettersAndDigits,
    bySymbol: new Map<string, T>(Object.entries(data.symbols || {})),
  };
};

const readValue: <T extends string>(
  set: ValueSet<T>,
  value: unknown,
) => T | null = <T extends string>(
  set: ValueSet<T>,
  value: unknown,
): T | null => {
  if (set.values.includes(value as T)) {
    return value as T;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_VALUE_TEXT_LENGTH) {
    return null;
  }

  // Spaces, underscores and dashes are no part of a symbol: "> =" is ">=".
  const bySymbol: T | undefined = set.bySymbol.get(
    trimmed.replace(/[\s_-]+/g, ""),
  );

  if (bySymbol) {
    return bySymbol;
  }

  const key: string = lettersAndDigitsOf(trimmed);

  return (key && set.byLettersAndDigits.get(key)) || null;
};

const FILTER_TYPES: ValueSet<FilterType> = makeValueSet<FilterType>({
  values: Object.values(FilterType),
  otherNames: {
    gt: FilterType.GreaterThan,
    above: FilterType.GreaterThan,
    "more than": FilterType.GreaterThan,
    gte: FilterType.GreaterThanOrEqualTo,
    ge: FilterType.GreaterThanOrEqualTo,
    "greater than or equal": FilterType.GreaterThanOrEqualTo,
    "greater or equal": FilterType.GreaterThanOrEqualTo,
    "at least": FilterType.GreaterThanOrEqualTo,
    lt: FilterType.LessThan,
    below: FilterType.LessThan,
    "fewer than": FilterType.LessThan,
    lte: FilterType.LessThanOrEqualTo,
    le: FilterType.LessThanOrEqualTo,
    "less than or equal": FilterType.LessThanOrEqualTo,
    "less or equal": FilterType.LessThanOrEqualTo,
    "at most": FilterType.LessThanOrEqualTo,
    eq: FilterType.EqualTo,
    equal: FilterType.EqualTo,
    equals: FilterType.EqualTo,
    exactly: FilterType.EqualTo,
    ne: FilterType.NotEqualTo,
    neq: FilterType.NotEqualTo,
    "not equal": FilterType.NotEqualTo,
    "not equals": FilterType.NotEqualTo,
    "anything but": FilterType.NotEqualTo,
    "does not contain": FilterType.NotContains,
  },
  symbols: {
    ">": FilterType.GreaterThan,
    ">=": FilterType.GreaterThanOrEqualTo,
    "≥": FilterType.GreaterThanOrEqualTo,
    "<": FilterType.LessThan,
    "<=": FilterType.LessThanOrEqualTo,
    "≤": FilterType.LessThanOrEqualTo,
    "=": FilterType.EqualTo,
    "==": FilterType.EqualTo,
    "===": FilterType.EqualTo,
    "!=": FilterType.NotEqualTo,
    "!==": FilterType.NotEqualTo,
    "<>": FilterType.NotEqualTo,
    "≠": FilterType.NotEqualTo,
  },
});

const CHECK_ONS: ValueSet<CheckOn> = makeValueSet<CheckOn>({
  values: Object.values(CheckOn),
});

const FILTER_CONDITIONS: ValueSet<FilterCondition> =
  makeValueSet<FilterCondition>({
    values: Object.values(FilterCondition),
    otherNames: {
      and: FilterCondition.All,
      or: FilterCondition.Any,
    },
  });

const EVALUATE_OVER_TIME_TYPES: ValueSet<EvaluateOverTimeType> =
  makeValueSet<EvaluateOverTimeType>({
    values: Object.values(EvaluateOverTimeType),
    otherNames: {
      avg: EvaluateOverTimeType.Average,
      mean: EvaluateOverTimeType.Average,
      max: EvaluateOverTimeType.MaximumValue,
      maximum: EvaluateOverTimeType.MaximumValue,
      min: EvaluateOverTimeType.MunimumValue,
      minimum: EvaluateOverTimeType.MunimumValue,
      any: EvaluateOverTimeType.AnyValue,
      all: EvaluateOverTimeType.AllValues,
    },
  });

const NO_DATA_POLICIES: ValueSet<NoDataPolicy> = makeValueSet<NoDataPolicy>({
  values: Object.values(NoDataPolicy),
});

// The longest part of a written value an error quotes back.
const MAX_QUOTED_LENGTH: number = 64;

const asObject: (value: unknown) => JSONObject | undefined = (
  value: unknown,
): JSONObject | undefined => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : undefined;
};

const isAbsent: (value: unknown) => boolean = (value: unknown): boolean => {
  return value === undefined || value === null || value === "";
};

// A written value, as an error quotes it back.
const describeWrittenValue: (value: unknown) => string = (
  value: unknown,
): string => {
  if (typeof value === "string") {
    return JSON.stringify(
      value.length > MAX_QUOTED_LENGTH
        ? `${value.slice(0, MAX_QUOTED_LENGTH)}…`
        : value,
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }

  return Array.isArray(value) ? "a list" : `a value of type ${typeof value}`;
};

// Every value a set takes, quoted and listed for a sentence.
const describeValues: <T extends string>(set: ValueSet<T>) => string = <
  T extends string,
>(
  set: ValueSet<T>,
): string => {
  const quoted: Array<string> = set.values.map((value: T): string => {
    return `"${value}"`;
  });

  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(", ")} or ${quoted[quoted.length - 1]}`
    : quoted.join("");
};

/*
 * Why a written value means none of the set's values, naming where it is
 * written ("filters[0].filterType"), or null when it means one or is not
 * written at all.
 */
const getUnreadableValueError: <T extends string>(data: {
  set: ValueSet<T>;
  value: unknown;
  path: string;
  criteriaName: string;
}) => string | null = <T extends string>(data: {
  set: ValueSet<T>;
  value: unknown;
  path: string;
  criteriaName: string;
}): string | null => {
  if (isAbsent(data.value) || readValue(data.set, data.value)) {
    return null;
  }

  return `Criteria ${JSON.stringify(data.criteriaName)}: ${data.path} ${describeWrittenValue(
    data.value,
  )} is not a value OneUptime reads there. Use one of ${describeValues(
    data.set,
  )}.`;
};

// A copy of an options object with one field read, when it reads as another.
const withValueRead: <T extends string>(data: {
  options: unknown;
  key: string;
  set: ValueSet<T>;
}) => unknown = <T extends string>(data: {
  options: unknown;
  key: string;
  set: ValueSet<T>;
}): unknown => {
  const options: JSONObject | undefined = asObject(data.options);

  if (!options) {
    return data.options;
  }

  const written: unknown = options[data.key];
  const read: T | null = readValue(data.set, written);

  return read && read !== written ? { ...options, [data.key]: read } : options;
};

export default class CriteriaFilterValues {
  public static readFilterType(value: unknown): FilterType | null {
    return readValue(FILTER_TYPES, value);
  }

  public static readCheckOn(value: unknown): CheckOn | null {
    return readValue(CHECK_ONS, value);
  }

  public static readFilterCondition(value: unknown): FilterCondition | null {
    return readValue(FILTER_CONDITIONS, value);
  }

  public static readEvaluateOverTimeType(
    value: unknown,
  ): EvaluateOverTimeType | null {
    return readValue(EVALUATE_OVER_TIME_TYPES, value);
  }

  public static readNoDataPolicy(value: unknown): NoDataPolicy | null {
    return readValue(NO_DATA_POLICIES, value);
  }

  /*
   * A filter as stored, with each value written another way read as the
   * one it means: what it checks, its condition, its metric options'
   * aggregation and no-data policy, and those of its evaluate-over-time
   * options. A value that means none, and one not written, are left as
   * they are.
   */
  public static readFilter(filter: JSONObject): JSONObject {
    const written: JSONObject | undefined = asObject(filter);

    if (!written) {
      return filter;
    }

    const read: JSONObject = { ...written };

    const checkOn: CheckOn | null = readValue(CHECK_ONS, written["checkOn"]);

    if (checkOn) {
      read["checkOn"] = checkOn;
    }

    const filterType: FilterType | null = readValue(
      FILTER_TYPES,
      written["filterType"],
    );

    if (filterType) {
      read["filterType"] = filterType;
    }

    if (asObject(written["metricMonitorOptions"])) {
      read["metricMonitorOptions"] = withValueRead({
        options: withValueRead({
          options: written["metricMonitorOptions"],
          key: "metricAggregationType",
          set: EVALUATE_OVER_TIME_TYPES,
        }),
        key: "onNoDataPolicy",
        set: NO_DATA_POLICIES,
      }) as JSONObject;
    }

    if (asObject(written["evaluateOverTimeOptions"])) {
      read["evaluateOverTimeOptions"] = withValueRead({
        options: withValueRead({
          options: written["evaluateOverTimeOptions"],
          key: "evaluateOverTimeType",
          set: EVALUATE_OVER_TIME_TYPES,
        }),
        key: "onNoDataPolicy",
        set: NO_DATA_POLICIES,
      }) as JSONObject;
    }

    return read;
  }

  /*
   * Why a criteria's filter condition, or one of its filters' values,
   * means none of the values OneUptime reads - one sentence each, naming
   * the criteria and where the value is written - or an empty list. A
   * value not written at all is not one of them: whether it is required is
   * for the form to say. The words name the fields, since the server's
   * readers are API callers.
   */
  public static getUnreadableErrors(data: {
    criteriaName: string;
    filterCondition: unknown;
    filters: unknown;
  }): Array<string> {
    const errors: Array<string | null> = [
      getUnreadableValueError({
        set: FILTER_CONDITIONS,
        value: data.filterCondition,
        path: "filterCondition",
        criteriaName: data.criteriaName,
      }),
    ];

    const filters: Array<unknown> = Array.isArray(data.filters)
      ? data.filters
      : [];

    filters.forEach((filterValue: unknown, index: number): void => {
      const filter: JSONObject | undefined = asObject(filterValue);

      if (!filter) {
        return;
      }

      const at: string = `filters[${index}]`;
      const metricMonitorOptions: JSONObject | undefined = asObject(
        filter["metricMonitorOptions"],
      );
      const evaluateOverTimeOptions: JSONObject | undefined = asObject(
        filter["evaluateOverTimeOptions"],
      );

      errors.push(
        getUnreadableValueError({
          set: CHECK_ONS,
          value: filter["checkOn"],
          path: `${at}.checkOn`,
          criteriaName: data.criteriaName,
        }),
        getUnreadableValueError({
          set: FILTER_TYPES,
          value: filter["filterType"],
          path: `${at}.filterType`,
          criteriaName: data.criteriaName,
        }),
        getUnreadableValueError({
          set: EVALUATE_OVER_TIME_TYPES,
          value: metricMonitorOptions?.["metricAggregationType"],
          path: `${at}.metricMonitorOptions.metricAggregationType`,
          criteriaName: data.criteriaName,
        }),
        getUnreadableValueError({
          set: NO_DATA_POLICIES,
          value: metricMonitorOptions?.["onNoDataPolicy"],
          path: `${at}.metricMonitorOptions.onNoDataPolicy`,
          criteriaName: data.criteriaName,
        }),
        getUnreadableValueError({
          set: EVALUATE_OVER_TIME_TYPES,
          value: evaluateOverTimeOptions?.["evaluateOverTimeType"],
          path: `${at}.evaluateOverTimeOptions.evaluateOverTimeType`,
          criteriaName: data.criteriaName,
        }),
        getUnreadableValueError({
          set: NO_DATA_POLICIES,
          value: evaluateOverTimeOptions?.["onNoDataPolicy"],
          path: `${at}.evaluateOverTimeOptions.onNoDataPolicy`,
          criteriaName: data.criteriaName,
        }),
      );
    });

    return errors.filter((error: string | null): error is string => {
      return error !== null;
    });
  }
}
