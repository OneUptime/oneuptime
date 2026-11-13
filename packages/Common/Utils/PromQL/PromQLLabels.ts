import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLLabelMatcher,
  PromQLMatchType,
} from "./PromQLAst";
import { compilePromQLRegex } from "./PromQLRegex";

/*
 * A series' labels: its metric name under `__name__`, and every other label.
 * A label that is absent and a label whose value is empty mean the same
 * thing, as in Prometheus, so an empty value is never stored.
 */
export type PromQLLabels = Record<string, string>;

const SEPARATOR: string = "\xff";

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

const regexCache: Map<string, RegExp> = new Map<string, RegExp>();

const cachedRegex: (pattern: string) => RegExp = (pattern: string): RegExp => {
  let regex: RegExp | undefined = regexCache.get(pattern);

  if (!regex) {
    regex = compilePromQLRegex(pattern).regex;

    // A long-running server meets many patterns; keep the newest.
    if (regexCache.size > 500) {
      regexCache.clear();
    }

    regexCache.set(pattern, regex);
  }

  return regex;
};

export const matchesPromQLMatcher: (
  labels: PromQLLabels,
  matcher: PromQLLabelMatcher,
) => boolean = (labels: PromQLLabels, matcher: PromQLLabelMatcher): boolean => {
  const value: string = labels[matcher.name] || "";

  switch (matcher.type) {
    case PromQLMatchType.Equal:
      return value === matcher.value;
    case PromQLMatchType.NotEqual:
      return value !== matcher.value;
    case PromQLMatchType.RegexMatch:
      return cachedRegex(matcher.value).test(value);
    case PromQLMatchType.RegexNoMatch:
      return !cachedRegex(matcher.value).test(value);
  }
};

// Whether a series' labels satisfy every matcher of a selector.
export const matchesPromQLMatchers: (
  labels: PromQLLabels,
  matchers: Array<PromQLLabelMatcher>,
) => boolean = (
  labels: PromQLLabels,
  matchers: Array<PromQLLabelMatcher>,
): boolean => {
  for (const matcher of matchers) {
    if (!matchesPromQLMatcher(labels, matcher)) {
      return false;
    }
  }

  return true;
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
