import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLCall,
  PromQLExpression,
  PromQLLabelMatcher,
  PromQLMatchType,
  PromQLMatrixSelector,
  PromQLNodeKind,
  PromQLValueType,
} from "./PromQLAst";
import {
  PromQLEvalValue,
  PromQLRangeSeries,
  PromQLSample,
} from "./PromQLEngineTypes";
import PromQLError, { PromQLErrorType } from "./PromQLError";
import {
  PromQLLabels,
  dropMetricName,
  promQLLabelValue,
  promQLLabelsKey,
} from "./PromQLLabels";
import {
  HistogramBucket,
  KahanSum,
  bucketQuantile,
  kahanAdd,
  kahanResult,
  linearRegression,
  promQLQuantile,
} from "./PromQLMath";
import { sortPromQLByLabels } from "./PromQLLabelOrder";
import { matchesEmptyValue } from "./PromQLParser";
import {
  CompiledPromQLRegex,
  compilePromQLRegex,
  describePromQLPatternProblem,
  PromQLRegexMatch,
  readNamedCapture,
} from "./PromQLRegex";
import { PatternWorkLimitError } from "../LinearRegExp/PatternProblem";
import lookupTable, { copyOwnValues, writeOwnValue } from "../LookupTable";

/*
 * What each PromQL function does (promql/functions.go), given its arguments
 * evaluated at one step. The engine evaluates the arguments; these turn
 * them into the function's answer.
 */

export interface PromQLFunctionContext {
  // The evaluation time of this step.
  timestampMs: number;
  // Evaluates one of the call's arguments at this step.
  evaluate: (expression: PromQLExpression) => PromQLEvalValue;
}

type RangeVectorValue = Extract<
  PromQLEvalValue,
  { type: PromQLValueType.RangeVector }
>;

const vectorValue: (samples: Array<PromQLSample>) => PromQLEvalValue = (
  samples: Array<PromQLSample>,
): PromQLEvalValue => {
  return { type: PromQLValueType.InstantVector, samples };
};

const scalarValue: (value: number) => PromQLEvalValue = (
  value: number,
): PromQLEvalValue => {
  return { type: PromQLValueType.Scalar, value };
};

const readSamples: (value: PromQLEvalValue) => Array<PromQLSample> = (
  value: PromQLEvalValue,
): Array<PromQLSample> => {
  if (value.type !== PromQLValueType.InstantVector) {
    throw new PromQLError(
      "An instant vector was expected here.",
      PromQLErrorType.Execution,
    );
  }

  return value.samples;
};

const readRange: (value: PromQLEvalValue) => RangeVectorValue = (
  value: PromQLEvalValue,
): RangeVectorValue => {
  if (value.type !== PromQLValueType.RangeVector) {
    throw new PromQLError(
      "A range vector was expected here.",
      PromQLErrorType.Execution,
    );
  }

  return value;
};

const readScalar: (value: PromQLEvalValue) => number = (
  value: PromQLEvalValue,
): number => {
  if (value.type !== PromQLValueType.Scalar) {
    throw new PromQLError(
      "A number was expected here.",
      PromQLErrorType.Execution,
    );
  }

  return value.value;
};

const readString: (value: PromQLEvalValue) => string = (
  value: PromQLEvalValue,
): string => {
  if (value.type !== PromQLValueType.String) {
    throw new PromQLError(
      "A string was expected here.",
      PromQLErrorType.Execution,
    );
  }

  return value.value;
};

// Applies `transform` to each value, dropping the metric name.
const mapValues: (
  samples: Array<PromQLSample>,
  timestampMs: number,
  transform: (value: number) => number,
) => Array<PromQLSample> = (
  samples: Array<PromQLSample>,
  timestampMs: number,
  transform: (value: number) => number,
): Array<PromQLSample> => {
  return samples.map((sample: PromQLSample): PromQLSample => {
    return {
      labels: dropMetricName(sample.labels),
      value: transform(sample.value),
      timestampMs,
    };
  });
};

type MathFunction = (value: number) => number;

/*
 * This table, OVER_TIME and DATE_FUNCTIONS are read by the name a query
 * calls, so they are Maps: each answers only for the functions it lists,
 * never with what every object inherits.
 */
const SIMPLE_FUNCTIONS: ReadonlyMap<string, MathFunction> = lookupTable({
  abs: Math.abs,
  acos: Math.acos,
  acosh: Math.acosh,
  asin: Math.asin,
  asinh: Math.asinh,
  atan: Math.atan,
  atanh: Math.atanh,
  ceil: Math.ceil,
  cos: Math.cos,
  cosh: Math.cosh,
  deg: (value: number): number => {
    return (value * 180) / Math.PI;
  },
  exp: Math.exp,
  floor: Math.floor,
  ln: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  rad: (value: number): number => {
    return (value * Math.PI) / 180;
  },
  sgn: (value: number): number => {
    if (Number.isNaN(value)) {
      return value;
    }

    return value > 0 ? 1 : value < 0 ? -1 : value;
  },
  sin: Math.sin,
  sinh: Math.sinh,
  sqrt: Math.sqrt,
  tan: Math.tan,
  tanh: Math.tanh,
});

/*
 * rate(), increase() and delta(): the change across the range, extrapolated
 * to the range's edges the way Prometheus extrapolates it, with counter
 * resets added back for the counter functions.
 */
const extrapolatedRate: (
  series: PromQLRangeSeries,
  range: RangeVectorValue,
  isCounter: boolean,
  isRate: boolean,
) => number | undefined = (
  series: PromQLRangeSeries,
  range: RangeVectorValue,
  isCounter: boolean,
  isRate: boolean,
): number | undefined => {
  const count: number = series.values.length;

  if (count < 2) {
    return undefined;
  }

  const firstTimestamp: number = series.timestampsMs[0]!;
  const lastTimestamp: number = series.timestampsMs[count - 1]!;
  const firstValue: number = series.values[0]!;
  let result: number = series.values[count - 1]! - firstValue;

  if (isCounter) {
    let previous: number = firstValue;

    for (let index: number = 1; index < count; index++) {
      const current: number = series.values[index]!;

      if (current < previous) {
        result += previous;
      }

      previous = current;
    }
  }

  let durationToStart: number = (firstTimestamp - range.rangeStartMs) / 1000;
  let durationToEnd: number = (range.rangeEndMs - lastTimestamp) / 1000;
  const sampledInterval: number = (lastTimestamp - firstTimestamp) / 1000;
  const averageDurationBetweenSamples: number = sampledInterval / (count - 1);
  const extrapolationThreshold: number = averageDurationBetweenSamples * 1.1;

  if (durationToStart >= extrapolationThreshold) {
    durationToStart = averageDurationBetweenSamples / 2;
  }

  // A counter is never negative: do not extrapolate past its zero.
  if (isCounter && result > 0 && firstValue >= 0) {
    const durationToZero: number = sampledInterval * (firstValue / result);

    if (durationToZero < durationToStart) {
      durationToStart = durationToZero;
    }
  }

  if (durationToEnd >= extrapolationThreshold) {
    durationToEnd = averageDurationBetweenSamples / 2;
  }

  let factor: number =
    (sampledInterval + durationToStart + durationToEnd) / sampledInterval;

  if (isRate) {
    factor /= range.rangeMs / 1000;
  }

  return result * factor;
};

// irate() and idelta(): from the last two samples only.
const instantValue: (
  series: PromQLRangeSeries,
  isRate: boolean,
) => number | undefined = (
  series: PromQLRangeSeries,
  isRate: boolean,
): number | undefined => {
  const count: number = series.values.length;

  if (count < 2) {
    return undefined;
  }

  const last: number = series.values[count - 1]!;
  const previous: number = series.values[count - 2]!;
  const interval: number =
    series.timestampsMs[count - 1]! - series.timestampsMs[count - 2]!;

  if (interval === 0) {
    return undefined;
  }

  // A counter reset: the counter restarted from zero.
  const change: number = isRate && last < previous ? last : last - previous;

  return isRate ? change / (interval / 1000) : change;
};

const valuesOf: (series: PromQLRangeSeries) => Array<number> = (
  series: PromQLRangeSeries,
): Array<number> => {
  return Array.from(series.values);
};

const populationVariance: (values: ArrayLike<number>) => number = (
  values: ArrayLike<number>,
): number => {
  let count: number = 0;
  let mean: number = 0;
  let squares: number = 0;

  for (let index: number = 0; index < values.length; index++) {
    const value: number = values[index]!;
    count++;
    const delta: number = value - mean;
    mean += delta / count;
    squares += delta * (value - mean);
  }

  return squares / count;
};

const average: (values: ArrayLike<number>) => number = (
  values: ArrayLike<number>,
): number => {
  const sum: KahanSum = { sum: 0, compensation: 0 };

  for (let index: number = 0; index < values.length; index++) {
    kahanAdd(sum, values[index]!);
  }

  return kahanResult(sum) / values.length;
};

type OverTimeFunction = (
  series: PromQLRangeSeries,
  range: RangeVectorValue,
) => number | undefined;

/*
 * The functions that read a range vector and answer with one value per
 * series. Undefined means "no value for this series at this step".
 */
const OVER_TIME: ReadonlyMap<string, OverTimeFunction> = lookupTable({
  avg_over_time: (series: PromQLRangeSeries): number => {
    return average(series.values);
  },
  count_over_time: (series: PromQLRangeSeries): number => {
    return series.values.length;
  },
  last_over_time: (series: PromQLRangeSeries): number => {
    return series.values[series.values.length - 1]!;
  },
  mad_over_time: (series: PromQLRangeSeries): number => {
    const values: Array<number> = valuesOf(series);
    const median: number = promQLQuantile(0.5, values);
    return promQLQuantile(
      0.5,
      values.map((value: number): number => {
        return Math.abs(value - median);
      }),
    );
  },
  max_over_time: (series: PromQLRangeSeries): number => {
    let max: number = series.values[0]!;

    for (let index: number = 1; index < series.values.length; index++) {
      const value: number = series.values[index]!;

      if (value > max || Number.isNaN(max)) {
        max = value;
      }
    }

    return max;
  },
  min_over_time: (series: PromQLRangeSeries): number => {
    let min: number = series.values[0]!;

    for (let index: number = 1; index < series.values.length; index++) {
      const value: number = series.values[index]!;

      if (value < min || Number.isNaN(min)) {
        min = value;
      }
    }

    return min;
  },
  present_over_time: (): number => {
    return 1;
  },
  stddev_over_time: (series: PromQLRangeSeries): number => {
    return Math.sqrt(populationVariance(series.values));
  },
  stdvar_over_time: (series: PromQLRangeSeries): number => {
    return populationVariance(series.values);
  },
  sum_over_time: (series: PromQLRangeSeries): number => {
    const sum: KahanSum = { sum: 0, compensation: 0 };

    for (let index: number = 0; index < series.values.length; index++) {
      kahanAdd(sum, series.values[index]!);
    }

    return kahanResult(sum);
  },
  changes: (series: PromQLRangeSeries): number => {
    let changes: number = 0;

    for (let index: number = 1; index < series.values.length; index++) {
      const current: number = series.values[index]!;
      const previous: number = series.values[index - 1]!;

      if (
        current !== previous &&
        !(Number.isNaN(current) && Number.isNaN(previous))
      ) {
        changes++;
      }
    }

    return changes;
  },
  resets: (series: PromQLRangeSeries): number => {
    let resets: number = 0;

    for (let index: number = 1; index < series.values.length; index++) {
      if (series.values[index]! < series.values[index - 1]!) {
        resets++;
      }
    }

    return resets;
  },
  deriv: (series: PromQLRangeSeries): number | undefined => {
    if (series.values.length < 2) {
      return undefined;
    }

    return linearRegression(
      series.timestampsMs,
      series.values,
      series.timestampsMs[0]!,
    ).slope;
  },
  delta: (
    series: PromQLRangeSeries,
    range: RangeVectorValue,
  ): number | undefined => {
    return extrapolatedRate(series, range, false, false);
  },
  increase: (
    series: PromQLRangeSeries,
    range: RangeVectorValue,
  ): number | undefined => {
    return extrapolatedRate(series, range, true, false);
  },
  rate: (
    series: PromQLRangeSeries,
    range: RangeVectorValue,
  ): number | undefined => {
    return extrapolatedRate(series, range, true, true);
  },
  idelta: (series: PromQLRangeSeries): number | undefined => {
    return instantValue(series, false);
  },
  irate: (series: PromQLRangeSeries): number | undefined => {
    return instantValue(series, true);
  },
});

// The functions whose answer keeps the input's metric name.
const KEEPS_METRIC_NAME: ReadonlySet<string> = new Set<string>([
  "last_over_time",
]);

type DateFunction = (date: Date) => number;

const DATE_FUNCTIONS: ReadonlyMap<string, DateFunction> = lookupTable({
  day_of_month: (date: Date): number => {
    return date.getUTCDate();
  },
  day_of_week: (date: Date): number => {
    return date.getUTCDay();
  },
  day_of_year: (date: Date): number => {
    const startOfYear: number = Date.UTC(date.getUTCFullYear(), 0, 1);
    return Math.floor((date.getTime() - startOfYear) / 86400000) + 1;
  },
  days_in_month: (date: Date): number => {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
  },
  hour: (date: Date): number => {
    return date.getUTCHours();
  },
  minute: (date: Date): number => {
    return date.getUTCMinutes();
  },
  month: (date: Date): number => {
    return date.getUTCMonth() + 1;
  },
  year: (date: Date): number => {
    return date.getUTCFullYear();
  },
});

/*
 * Labels Prometheus never writes into absent()'s answer (schema.IsMetadataLabel):
 * the metric name, and the type and unit of its type-and-unit labels.
 */
const ABSENT_METADATA_LABELS: ReadonlySet<string> = new Set<string>([
  PROMQL_METRIC_NAME_LABEL,
  "__type__",
  "__unit__",
]);

/*
 * A selector's matchers in the order Prometheus' storage leaves them in.
 * Reading a selector, the TSDB sorts its matchers in place, the syntax
 * tree's own (tsdb.PostingsForMatchers): those that pick series out first,
 * those that take series away after, each kind in the order it was written.
 * A matcher takes away when it is != or !~ and an empty value passes it, or
 * when no matcher on its label needs the label set. absent() reads the
 * matchers after that, so `x{job!="b", job="a"}` is read as
 * `x{job="a", job!="b"}`.
 *
 * (A Prometheus that stores no data in the query's time range reads no
 * index, so nothing sorts the matchers, and it answers in the written order:
 * there, x{job!="b", job="a"} answers {job="a"}. A server that scrapes
 * anything stores its latest data, so the sorted order is the one absent()
 * alerts see.)
 */
const matchersInStorageOrder: (
  matchers: Array<PromQLLabelMatcher>,
) => Array<PromQLLabelMatcher> = (
  matchers: Array<PromQLLabelMatcher>,
): Array<PromQLLabelMatcher> => {
  const labelMustBeSet: Set<string> = new Set<string>();

  for (const matcher of matchers) {
    if (!matchesEmptyValue(matcher)) {
      labelMustBeSet.add(matcher.name);
    }
  }

  const takesAway: (matcher: PromQLLabelMatcher) => boolean = (
    matcher: PromQLLabelMatcher,
  ): boolean => {
    if (!labelMustBeSet.has(matcher.name)) {
      return true;
    }

    return (
      (matcher.type === PromQLMatchType.NotEqual ||
        matcher.type === PromQLMatchType.RegexNoMatch) &&
      matchesEmptyValue(matcher)
    );
  };

  return [
    ...matchers.filter((matcher: PromQLLabelMatcher): boolean => {
      return !takesAway(matcher);
    }),
    ...matchers.filter(takesAway),
  ];
};

/*
 * The labels absent() and absent_over_time() give their 1, as Prometheus
 * derives them (createLabelsForAbsentFunction, promql/functions.go): the
 * selector's matchers in the order its storage leaves them in
 * (matchersInStorageOrder), the first = on a label setting it, and any other
 * matcher on it, a second = among them, deleting it. A label deleted before
 * it is set is set. So x{job="a", job!="b"} answers {}, x{job=~"a",
 * job="a"} answers {job="a"}, and x{job="a", job="b"} answers {}, since no
 * one value is right. An empty value is no label. Anything but a selector,
 * once its parentheses are read through as Prometheus reads them, names no
 * labels.
 */
const absentLabels: (expression: PromQLExpression) => PromQLLabels = (
  expression: PromQLExpression,
): PromQLLabels => {
  let argument: PromQLExpression = expression;

  while (argument.kind === PromQLNodeKind.Paren) {
    argument = argument.expression;
  }

  let selectorMatchers: Array<PromQLLabelMatcher> = [];

  if (argument.kind === PromQLNodeKind.VectorSelector) {
    selectorMatchers = argument.matchers;
  } else if (argument.kind === PromQLNodeKind.MatrixSelector) {
    selectorMatchers = (argument as PromQLMatrixSelector).vectorSelector
      .matchers;
  }

  const labels: PromQLLabels = {};
  const set: Set<string> = new Set<string>();

  for (const matcher of matchersInStorageOrder(selectorMatchers)) {
    if (ABSENT_METADATA_LABELS.has(matcher.name)) {
      continue;
    }

    if (matcher.type === PromQLMatchType.Equal && !set.has(matcher.name)) {
      set.add(matcher.name);

      if (matcher.value !== "") {
        // As an own key: a selector may pin a label named __proto__.
        writeOwnValue(labels, matcher.name, matcher.value);
        continue;
      }
    }

    delete labels[matcher.name];
  }

  return labels;
};

/*
 * A character of a group's name in a template, as Go's Regexp.Expand reads
 * one (extract, regexp.go): a Unicode letter (unicode.IsLetter, \p{L}), a
 * decimal digit (unicode.IsDigit, \p{Nd}: not ² or Ⅷ) or "_". Asked of one
 * code point at a time.
 */
const TEMPLATE_NAME_CHARACTER_REGEX: RegExp = /^[\p{L}\p{Nd}_]$/u;

// From this on, Go reads a run of digits as a name, not a group's number.
const MAX_TEMPLATE_GROUP_NUMBER: number = 1e8;

interface TemplateReference {
  // The group's name, as written: "1", "01", "host".
  name: string;
  // The group's number; -1 when the name is not one.
  group: number;
  // Where the reference ends in the template.
  end: number;
}

/*
 * The name or {name} right after a "$", at `start`, as Go's extract reads
 * it; null when there is none - no name character at all, or a "{" whose
 * name is not closed by a "}" right after it - and the "$" is then text. A
 * name of ASCII digits is a group's number, unless it starts with a zero
 * (so $01 names a group "01", while $0 is the whole match) or reaches 1e8
 * before its last digit.
 */
const readTemplateReference: (
  template: string,
  start: number,
) => TemplateReference | null = (
  template: string,
  start: number,
): TemplateReference | null => {
  const braced: boolean = template[start] === "{";
  const nameStart: number = braced ? start + 1 : start;
  let index: number = nameStart;

  while (index < template.length) {
    const character: string = String.fromCodePoint(
      template.codePointAt(index)!,
    );

    if (!TEMPLATE_NAME_CHARACTER_REGEX.test(character)) {
      break;
    }

    index += character.length;
  }

  if (index === nameStart) {
    return null;
  }

  const name: string = template.slice(nameStart, index);

  if (braced) {
    if (template[index] !== "}") {
      return null;
    }

    index++;
  }

  let group: number = 0;

  for (let digit: number = 0; digit < name.length; digit++) {
    const codeUnit: number = name.charCodeAt(digit);

    if (
      codeUnit < 0x30 ||
      codeUnit > 0x39 ||
      group >= MAX_TEMPLATE_GROUP_NUMBER
    ) {
      group = -1;
      break;
    }

    group = group * 10 + codeUnit - 0x30;
  }

  if (name[0] === "0" && name.length > 1) {
    group = -1;
  }

  return { name, group, end: index };
};

/*
 * Go's Regexp.Expand, which Prometheus' label_replace() writes its
 * replacement with (regexp.ExpandString): $1 and ${1} are what group 1
 * captured, $0 the whole match, $name and ${name} the first group of that
 * name that took part, and $$ a dollar sign. A group that took no part, or
 * that the pattern does not have, is "". A name runs as far as letters,
 * digits and "_" go, so $1x names a group "1x" - write ${1}x - and a "$"
 * that starts no name, as in "$-" or "${1", is itself.
 */
const expandTemplate: (
  template: string,
  match: PromQLRegexMatch,
  groupNames: ReadonlyArray<string | null>,
) => string = (
  template: string,
  match: PromQLRegexMatch,
  groupNames: ReadonlyArray<string | null>,
): string => {
  let result: string = "";
  let index: number = 0;

  for (;;) {
    const dollar: number = template.indexOf("$", index);

    if (dollar === -1) {
      return result + template.slice(index);
    }

    result += template.slice(index, dollar);
    index = dollar + 1;

    if (template[index] === "$") {
      result += "$";
      index++;
      continue;
    }

    const reference: TemplateReference | null = readTemplateReference(
      template,
      index,
    );

    if (reference === null) {
      result += "$";
      continue;
    }

    index = reference.end;

    if (reference.group === 0) {
      result += match.value;
    } else if (reference.group > 0) {
      result += match.captures[reference.group - 1] ?? "";
    } else {
      result +=
        readNamedCapture({
          captures: match.captures,
          groupNames: groupNames,
          name: reference.name,
        }) ?? "";
    }
  }
};

const sortSamples: (
  samples: Array<PromQLSample>,
  descending: boolean,
) => Array<PromQLSample> = (
  samples: Array<PromQLSample>,
  descending: boolean,
): Array<PromQLSample> => {
  return [...samples].sort((a: PromQLSample, b: PromQLSample): number => {
    // NaN goes last either way, as in Prometheus.
    if (Number.isNaN(a.value)) {
      return Number.isNaN(b.value) ? 0 : 1;
    }

    if (Number.isNaN(b.value)) {
      return -1;
    }

    return descending ? b.value - a.value : a.value - b.value;
  });
};

export const evaluatePromQLFunction: (
  call: PromQLCall,
  context: PromQLFunctionContext,
) => PromQLEvalValue = (
  call: PromQLCall,
  context: PromQLFunctionContext,
): PromQLEvalValue => {
  const name: string = call.functionName;
  const now: number = context.timestampMs;
  const arg: (index: number) => PromQLEvalValue = (
    index: number,
  ): PromQLEvalValue => {
    return context.evaluate(call.args[index]!);
  };

  const simple: MathFunction | undefined = SIMPLE_FUNCTIONS.get(name);

  if (simple) {
    return vectorValue(mapValues(readSamples(arg(0)), now, simple));
  }

  const overTime: OverTimeFunction | undefined = OVER_TIME.get(name);

  if (overTime) {
    const range: RangeVectorValue = readRange(arg(0));
    const samples: Array<PromQLSample> = [];

    for (const series of range.series) {
      if (series.values.length === 0) {
        continue;
      }

      const value: number | undefined = overTime(series, range);

      if (value !== undefined) {
        samples.push({
          labels: KEEPS_METRIC_NAME.has(name)
            ? series.labels
            : dropMetricName(series.labels),
          value,
          timestampMs: now,
        });
      }
    }

    return vectorValue(samples);
  }

  const dateFunction: DateFunction | undefined = DATE_FUNCTIONS.get(name);

  if (dateFunction) {
    const samples: Array<PromQLSample> =
      call.args.length === 0
        ? [{ labels: {}, value: now / 1000, timestampMs: now }]
        : readSamples(arg(0));

    return vectorValue(
      mapValues(samples, now, (value: number): number => {
        if (!Number.isFinite(value)) {
          return NaN;
        }

        return dateFunction(new Date(value * 1000));
      }),
    );
  }

  switch (name) {
    case "time":
      return scalarValue(now / 1000);
    case "pi":
      return scalarValue(Math.PI);
    case "vector":
      return vectorValue([
        { labels: {}, value: readScalar(arg(0)), timestampMs: now },
      ]);
    case "scalar": {
      const samples: Array<PromQLSample> = readSamples(arg(0));
      return scalarValue(samples.length === 1 ? samples[0]!.value : NaN);
    }
    case "timestamp":
      return vectorValue(
        readSamples(arg(0)).map((sample: PromQLSample): PromQLSample => {
          return {
            labels: dropMetricName(sample.labels),
            value: sample.timestampMs / 1000,
            timestampMs: now,
          };
        }),
      );
    case "absent": {
      const samples: Array<PromQLSample> = readSamples(arg(0));

      if (samples.length > 0) {
        return vectorValue([]);
      }

      return vectorValue([
        { labels: absentLabels(call.args[0]!), value: 1, timestampMs: now },
      ]);
    }
    case "absent_over_time": {
      const range: RangeVectorValue = readRange(arg(0));

      const hasSamples: boolean = range.series.some(
        (series: PromQLRangeSeries): boolean => {
          return series.values.length > 0;
        },
      );

      if (hasSamples) {
        return vectorValue([]);
      }

      return vectorValue([
        { labels: absentLabels(call.args[0]!), value: 1, timestampMs: now },
      ]);
    }
    case "clamp": {
      const samples: Array<PromQLSample> = readSamples(arg(0));
      const min: number = readScalar(arg(1));
      const max: number = readScalar(arg(2));

      if (max < min) {
        return vectorValue([]);
      }

      return vectorValue(
        mapValues(samples, now, (value: number): number => {
          return Math.max(min, Math.min(max, value));
        }),
      );
    }
    case "clamp_max": {
      const max: number = readScalar(arg(1));
      return vectorValue(
        mapValues(readSamples(arg(0)), now, (value: number): number => {
          return Math.min(max, value);
        }),
      );
    }
    case "clamp_min": {
      const min: number = readScalar(arg(1));
      return vectorValue(
        mapValues(readSamples(arg(0)), now, (value: number): number => {
          return Math.max(min, value);
        }),
      );
    }
    case "round": {
      const toNearest: number = call.args.length > 1 ? readScalar(arg(1)) : 1;
      // Dividing by the inverse keeps 0.1-steps exact, as in Prometheus.
      const inverse: number = 1 / toNearest;
      return vectorValue(
        mapValues(readSamples(arg(0)), now, (value: number): number => {
          return Math.floor(value * inverse + 0.5) / inverse;
        }),
      );
    }
    case "quantile_over_time": {
      const phi: number = readScalar(arg(0));
      const range: RangeVectorValue = readRange(arg(1));
      const samples: Array<PromQLSample> = [];

      for (const series of range.series) {
        if (series.values.length === 0) {
          continue;
        }

        samples.push({
          labels: dropMetricName(series.labels),
          value: promQLQuantile(phi, valuesOf(series)),
          timestampMs: now,
        });
      }

      return vectorValue(samples);
    }
    case "predict_linear": {
      const range: RangeVectorValue = readRange(arg(0));
      const seconds: number = readScalar(arg(1));
      const samples: Array<PromQLSample> = [];

      for (const series of range.series) {
        if (series.values.length < 2) {
          continue;
        }

        const line: { slope: number; intercept: number } = linearRegression(
          series.timestampsMs,
          series.values,
          now,
        );

        samples.push({
          labels: dropMetricName(series.labels),
          value: line.slope * seconds + line.intercept,
          timestampMs: now,
        });
      }

      return vectorValue(samples);
    }
    case "holt_winters":
    case "double_exponential_smoothing": {
      const range: RangeVectorValue = readRange(arg(0));
      const smoothing: number = readScalar(arg(1));
      const trend: number = readScalar(arg(2));

      if (!(smoothing > 0 && smoothing < 1)) {
        throw new PromQLError(
          `The smoothing factor of ${name}() must be between 0 and 1, but it is ${smoothing}.`,
          PromQLErrorType.Execution,
          call.position,
        );
      }

      if (!(trend > 0 && trend < 1)) {
        throw new PromQLError(
          `The trend factor of ${name}() must be between 0 and 1, but it is ${trend}.`,
          PromQLErrorType.Execution,
          call.position,
        );
      }

      const samples: Array<PromQLSample> = [];

      for (const series of range.series) {
        const count: number = series.values.length;

        if (count < 2) {
          continue;
        }

        let previousSmoothed: number = 0;
        let smoothed: number = series.values[0]!;
        let slope: number = series.values[1]! - series.values[0]!;

        for (let index: number = 1; index < count; index++) {
          const scaled: number = smoothing * series.values[index]!;

          if (index > 1) {
            slope = trend * (smoothed - previousSmoothed) + (1 - trend) * slope;
          }

          const carried: number = (1 - smoothing) * (smoothed + slope);
          previousSmoothed = smoothed;
          smoothed = scaled + carried;
        }

        samples.push({
          labels: dropMetricName(series.labels),
          value: smoothed,
          timestampMs: now,
        });
      }

      return vectorValue(samples);
    }
    case "histogram_quantile": {
      const phi: number = readScalar(arg(0));
      const groups: Map<
        string,
        { labels: PromQLLabels; buckets: Array<HistogramBucket> }
      > = new Map();

      for (const sample of readSamples(arg(1))) {
        const le: string | undefined = sample.labels["le"];

        if (le === undefined) {
          continue;
        }

        const upperBound: number =
          le === "+Inf" || le === "Inf" || le === "inf" ? Infinity : Number(le);

        if (Number.isNaN(upperBound)) {
          continue;
        }

        const groupLabels: PromQLLabels = copyOwnValues(sample.labels);
        delete groupLabels["le"];
        delete groupLabels[PROMQL_METRIC_NAME_LABEL];
        const key: string = promQLLabelsKey(groupLabels);
        let group:
          | { labels: PromQLLabels; buckets: Array<HistogramBucket> }
          | undefined = groups.get(key);

        if (!group) {
          group = { labels: groupLabels, buckets: [] };
          groups.set(key, group);
        }

        group.buckets.push({ upperBound, count: sample.value });
      }

      const samples: Array<PromQLSample> = [];

      for (const group of groups.values()) {
        samples.push({
          labels: group.labels,
          value: bucketQuantile(phi, group.buckets),
          timestampMs: now,
        });
      }

      return vectorValue(samples);
    }
    case "label_replace": {
      const samples: Array<PromQLSample> = readSamples(arg(0));
      const destination: string = readString(arg(1));
      const replacement: string = readString(arg(2));
      const source: string = readString(arg(3));
      const pattern: string = readString(arg(4));
      let compiled: CompiledPromQLRegex;

      try {
        // Compiled once for every series below, with what its groups capture.
        compiled = compilePromQLRegex(pattern, {
          captures: true,
          unicodeClassAliases: true,
        });
      } catch (error: unknown) {
        // Why the pattern cannot be matched, or null.
        const problem: string | null = describePromQLPatternProblem(error);

        throw new PromQLError(
          problem === null
            ? `"${pattern}" in label_replace() is not a regular expression.`
            : `The pattern "${pattern}" in label_replace() ${problem}`,
          PromQLErrorType.Execution,
          call.position,
        );
      }

      if (destination.length === 0) {
        throw new PromQLError(
          "label_replace() needs a destination label name.",
          PromQLErrorType.Execution,
          call.position,
        );
      }

      return vectorValue(
        samples.map((sample: PromQLSample): PromQLSample => {
          let match: PromQLRegexMatch | null;

          try {
            match = compiled.exec(promQLLabelValue(sample.labels, source));
          } catch (error: unknown) {
            if (error instanceof PatternWorkLimitError) {
              throw new PromQLError(
                `The pattern "${pattern}" in label_replace() needed more work to match a value of the label "${source}" than the value's length allows. Write a simpler pattern.`,
                PromQLErrorType.Execution,
                call.position,
              );
            }

            throw error;
          }

          if (!match) {
            return sample;
          }

          // Own keys, a destination named __proto__ included (PromQLLabels).
          const labels: PromQLLabels = copyOwnValues(sample.labels);
          const value: string = expandTemplate(
            replacement,
            match,
            compiled.groupNames,
          );

          if (value.length === 0) {
            delete labels[destination];
          } else {
            writeOwnValue(labels, destination, value);
          }

          return { ...sample, labels };
        }),
      );
    }
    case "label_join": {
      const samples: Array<PromQLSample> = readSamples(arg(0));
      const destination: string = readString(arg(1));
      const separator: string = readString(arg(2));
      const sources: Array<string> = call.args
        .slice(3)
        .map((_expression: PromQLExpression, index: number): string => {
          return readString(arg(index + 3));
        });

      if (destination.length === 0) {
        throw new PromQLError(
          "label_join() needs a destination label name.",
          PromQLErrorType.Execution,
          call.position,
        );
      }

      return vectorValue(
        samples.map((sample: PromQLSample): PromQLSample => {
          const value: string = sources
            .map((source: string): string => {
              return promQLLabelValue(sample.labels, source);
            })
            .join(separator);
          // Own keys, a destination named __proto__ included (PromQLLabels).
          const labels: PromQLLabels = copyOwnValues(sample.labels);

          if (value.length === 0) {
            delete labels[destination];
          } else {
            writeOwnValue(labels, destination, value);
          }

          return { ...sample, labels };
        }),
      );
    }
    case "sort":
      return vectorValue(sortSamples(readSamples(arg(0)), false));
    case "sort_desc":
      return vectorValue(sortSamples(readSamples(arg(0)), true));
    case "sort_by_label":
    case "sort_by_label_desc": {
      const samples: Array<PromQLSample> = readSamples(arg(0));
      const labels: Array<string> = call.args
        .slice(1)
        .map((_expression: PromQLExpression, index: number): string => {
          return readString(arg(index + 1));
        });
      return vectorValue(
        sortPromQLByLabels(samples, labels, name === "sort_by_label_desc"),
      );
    }
    default:
      throw new PromQLError(
        `Unknown function "${name}".`,
        PromQLErrorType.BadData,
        call.position,
      );
  }
};

// Whether a call's answer keeps the order the function gives it.
export const PROMQL_ORDERING_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "sort",
  "sort_desc",
  "sort_by_label",
  "sort_by_label_desc",
]);
