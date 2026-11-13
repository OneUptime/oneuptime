import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLLabelMatcher,
  PromQLMatchType,
} from "./PromQLAst";
import PromQLError, { PromQLErrorType } from "./PromQLError";
import { compilePromQLRegex } from "./PromQLRegex";
import LinearRegExp from "../LinearRegExp/LinearRegExp";
import { PatternWorkLimitError } from "../LinearRegExp/PatternProblem";

/*
 * A series' labels: its metric name under `__name__`, and every other label.
 * A label that is absent and a label whose value is empty mean the same
 * thing, as in Prometheus, so an empty value is never stored.
 */
export type PromQLLabels = Record<string, string>;

const SEPARATOR: string = "\xff";

/*
 * A label's value, "" for a label the series does not have: never what
 * every object inherits, since a label may be named constructor or toString.
 */
export const promQLLabelValue: (
  labels: PromQLLabels,
  name: string,
) => string = (labels: PromQLLabels, name: string): string => {
  return Object.prototype.hasOwnProperty.call(labels, name)
    ? labels[name] || ""
    : "";
};

// One string per label set, the same for the same labels in any order.
export const promQLLabelsKey: (labels: PromQLLabels) => string = (
  labels: PromQLLabels,
): string => {
  const names: Array<string> = Object.keys(labels).sort();
  let key: string = "";

  for (const name of names) {
    key += `${name}${SEPARATOR}${labels[name]}${SEPARATOR}`;
  }

  return key;
};

export const dropMetricName: (labels: PromQLLabels) => PromQLLabels = (
  labels: PromQLLabels,
): PromQLLabels => {
  if (labels[PROMQL_METRIC_NAME_LABEL] === undefined) {
    return labels;
  }

  const copy: PromQLLabels = { ...labels };
  delete copy[PROMQL_METRIC_NAME_LABEL];
  return copy;
};

/*
 * The key two series match on: only the listed labels for `on (...)`, every
 * label but the listed ones and the metric name otherwise.
 */
export const promQLMatchSignature: (
  labels: PromQLLabels,
  on: boolean,
  names: Array<string>,
) => string = (
  labels: PromQLLabels,
  on: boolean,
  names: Array<string>,
): string => {
  if (on) {
    let key: string = "";

    for (const name of [...names].sort()) {
      key += `${name}${SEPARATOR}${labels[name] || ""}${SEPARATOR}`;
    }

    return key;
  }

  const ignored: Set<string> = new Set<string>(names);
  ignored.add(PROMQL_METRIC_NAME_LABEL);
  const kept: PromQLLabels = {};

  for (const name of Object.keys(labels)) {
    if (!ignored.has(name)) {
      kept[name] = labels[name]!;
    }
  }

  return promQLLabelsKey(kept);
};

// Whether a series' labels satisfy a selector's matchers.
export type PromQLLabelsTest = (labels: PromQLLabels) => boolean;

/*
 * Whether a matcher's pattern matches a value. A question the linear-time
 * matcher stops at its work limit has no answer, and a query does not
 * answer without it: it is refused, with a sentence that names the pattern.
 */
const testMatcherPattern: (
  regex: LinearRegExp,
  matcher: PromQLLabelMatcher,
  value: string,
) => boolean = (
  regex: LinearRegExp,
  matcher: PromQLLabelMatcher,
  value: string,
): boolean => {
  try {
    return regex.test(value);
  } catch (error: unknown) {
    if (error instanceof PatternWorkLimitError) {
      throw new PromQLError(
        `The pattern "${matcher.value}" for the label "${matcher.name}" needed more work to match one of the label's values than the value's length allows. Write a simpler pattern.`,
        PromQLErrorType.Execution,
      );
    }

    throw error;
  }
};

// One matcher, its pattern compiled once (PromQLRegex).
const compilePromQLMatcher: (
  matcher: PromQLLabelMatcher,
) => PromQLLabelsTest = (matcher: PromQLLabelMatcher): PromQLLabelsTest => {
  switch (matcher.type) {
    case PromQLMatchType.Equal:
      return (labels: PromQLLabels): boolean => {
        return promQLLabelValue(labels, matcher.name) === matcher.value;
      };
    case PromQLMatchType.NotEqual:
      return (labels: PromQLLabels): boolean => {
        return promQLLabelValue(labels, matcher.name) !== matcher.value;
      };
    case PromQLMatchType.RegexMatch:
    case PromQLMatchType.RegexNoMatch: {
      const regex: LinearRegExp = compilePromQLRegex(matcher.value).regex;
      const wanted: boolean = matcher.type === PromQLMatchType.RegexMatch;

      return (labels: PromQLLabels): boolean => {
        return (
          testMatcherPattern(
            regex,
            matcher,
            promQLLabelValue(labels, matcher.name),
          ) === wanted
        );
      };
    }
  }
};

/*
 * A selector's matchers, compiled once for the series one query reads: a
 * pattern is compiled here, not once per series. The parser has checked
 * every pattern (PromQLParser), so each compiles.
 */
export const compilePromQLMatchers: (
  matchers: Array<PromQLLabelMatcher>,
) => PromQLLabelsTest = (
  matchers: Array<PromQLLabelMatcher>,
): PromQLLabelsTest => {
  const tests: Array<PromQLLabelsTest> = matchers.map(compilePromQLMatcher);

  return (labels: PromQLLabels): boolean => {
    for (const test of tests) {
      if (!test(labels)) {
        return false;
      }
    }

    return true;
  };
};

/*
 * Whether one series' labels satisfy every matcher of a selector. A read of
 * many series compiles the matchers once instead (compilePromQLMatchers).
 */
export const matchesPromQLMatchers: (
  labels: PromQLLabels,
  matchers: Array<PromQLLabelMatcher>,
) => boolean = (
  labels: PromQLLabels,
  matchers: Array<PromQLLabelMatcher>,
): boolean => {
  return compilePromQLMatchers(matchers)(labels);
};

/*
 * A label set the way Prometheus prints one: `up{instance="a", job="api"}`,
 * or `{job="api"}` without a metric name.
 */
export const formatPromQLLabels: (labels: PromQLLabels) => string = (
  labels: PromQLLabels,
): string => {
  const name: string = labels[PROMQL_METRIC_NAME_LABEL] || "";
  const pairs: Array<string> = Object.keys(labels)
    .filter((label: string): boolean => {
      return label !== PROMQL_METRIC_NAME_LABEL;
    })
    .sort()
    .map((label: string): string => {
      return `${label}=${JSON.stringify(labels[label])}`;
    });

  if (pairs.length === 0) {
    return name.length > 0 ? name : "{}";
  }

  return `${name}{${pairs.join(", ")}}`;
};

/*
 * A sample value the way the Prometheus HTTP API writes it: a string, with
 * the special values spelled "NaN", "+Inf" and "-Inf", and never in
 * exponent notation (Go's strconv.FormatFloat(v, 'f', -1, 64)).
 */
export const formatPromQLValue: (value: number) => string = (
  value: number,
): string => {
  if (Number.isNaN(value)) {
    return "NaN";
  }

  if (value === Infinity) {
    return "+Inf";
  }

  if (value === -Infinity) {
    return "-Inf";
  }

  const text: string = String(value);

  if (!text.includes("e")) {
    return text;
  }

  return expandExponent(text);
};

// "1.5e-7" is "0.00000015"; "1e+21" is "1000000000000000000000".
const expandExponent: (text: string) => string = (text: string): string => {
  const negative: boolean = text.startsWith("-");
  const unsigned: string = negative ? text.slice(1) : text;
  const [mantissa, exponentText] = unsigned.split("e") as [string, string];
  const exponent: number = Number(exponentText);
  const [integerPart, fractionPart] = mantissa.split(".") as [
    string,
    string | undefined,
  ];
  const digits: string = `${integerPart}${fractionPart || ""}`;
  const pointPosition: number = integerPart.length + exponent;
  let result: string;

  if (pointPosition <= 0) {
    result = `0.${"0".repeat(-pointPosition)}${digits}`;
  } else if (pointPosition >= digits.length) {
    result = `${digits}${"0".repeat(pointPosition - digits.length)}`;
  } else {
    result = `${digits.slice(0, pointPosition)}.${digits.slice(pointPosition)}`;
  }

  return negative ? `-${result}` : result;
};
