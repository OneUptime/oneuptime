import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLAggregate,
  PromQLAggregateOperator,
  PromQLAtModifier,
  PromQLBinary,
  PromQLBinaryOperator,
  PromQLExpression,
  PromQLLabelMatcher,
  PromQLNodeKind,
  PromQLSubquery,
  PromQLValueType,
  PromQLVectorMatchCardinality,
  PromQLVectorMatching,
  PromQLVectorSelector,
  isComparisonOperator,
} from "./PromQLAst";
import {
  PromQLEngineOptions,
  PromQLEvalValue,
  PromQLMatrixResultSeries,
  PromQLQueryResult,
  PromQLRangeSeries,
  PromQLResultType,
  PromQLSample,
  PromQLSeries,
  PromQLSeriesSource,
  PromQLVectorResultSample,
} from "./PromQLEngineTypes";
import PromQLError, { PromQLErrorType } from "./PromQLError";
import {
  PROMQL_ORDERING_FUNCTIONS,
  evaluatePromQLFunction,
} from "./PromQLFunctionEvaluators";
import {
  PromQLLabels,
  dropMetricName,
  formatPromQLLabels,
  formatPromQLValue,
  promQLLabelsKey,
  promQLMatchSignature,
} from "./PromQLLabels";
import {
  KahanSum,
  kahanAdd,
  kahanResult,
  promQLPow,
  promQLQuantile,
  upperBound,
} from "./PromQLMath";
import { getPromQLValueType, parsePromQL } from "./PromQLParser";

/*
 * Evaluates PromQL the way Prometheus 3 does (promql/engine.go).
 *
 * A query runs in two halves. First the engine walks the tree and works out,
 * for every selector, which samples any step can read (the lookback window,
 * ranges, offsets, `@` and subqueries all move it), and asks the source for
 * each selector's series once. Then it evaluates the tree at each step, from
 * the series it holds: an instant query at one time, a range query at every
 * step from start to end.
 *
 * The source is the only thing that knows where series live, so the same
 * engine reads OneUptime's metrics in ClickHouse and series a test holds in
 * memory.
 */

export const PROMQL_DEFAULT_LOOKBACK_DELTA_MS: number = 5 * 60 * 1000;
export const PROMQL_DEFAULT_SUBQUERY_STEP_MS: number = 60 * 1000;
export const PROMQL_DEFAULT_MAX_SAMPLES: number = 5000000;
export const PROMQL_MAX_POINTS_PER_SERIES: number = 11000;
export const PROMQL_DEFAULT_TIMEOUT_MS: number = 30000;

interface ResolvedEngineOptions {
  lookbackDeltaMs: number;
  defaultSubqueryStepMs: number;
  maxSamples: number;
  maxPointsPerSeries: number;
  timeoutMs: number;
  now: () => number;
}

interface LoadedSeries {
  labels: PromQLLabels;
  timestampsMs: Float64Array;
  values: Float64Array;
}

interface SelectorWindow {
  selector: PromQLVectorSelector;
  // Samples after this time can be read...
  startTimeMs: number;
  // ...up to and with this one.
  endTimeMs: number;
}

const toFloat64Array: (values: ArrayLike<number>) => Float64Array = (
  values: ArrayLike<number>,
): Float64Array => {
  return values instanceof Float64Array ? values : Float64Array.from(values);
};

const selectorKey: (selector: PromQLVectorSelector) => string = (
  selector: PromQLVectorSelector,
): string => {
  return JSON.stringify(
    [...selector.matchers]
      .map((matcher: PromQLLabelMatcher): string => {
        return `${matcher.name}${matcher.type}${JSON.stringify(matcher.value)}`;
      })
      .sort(),
  );
};

// Arithmetic answers a value; a comparison answers whether to keep it.
const elementBinop: (
  operator: PromQLBinaryOperator,
  lhs: number,
  rhs: number,
) => { value: number; keep: boolean } = (
  operator: PromQLBinaryOperator,
  lhs: number,
  rhs: number,
): { value: number; keep: boolean } => {
  switch (operator) {
    case PromQLBinaryOperator.Add:
      return { value: lhs + rhs, keep: true };
    case PromQLBinaryOperator.Sub:
      return { value: lhs - rhs, keep: true };
    case PromQLBinaryOperator.Mul:
      return { value: lhs * rhs, keep: true };
    case PromQLBinaryOperator.Div:
      return { value: lhs / rhs, keep: true };
    case PromQLBinaryOperator.Mod:
      return { value: lhs % rhs, keep: true };
    case PromQLBinaryOperator.Pow:
      return { value: promQLPow(lhs, rhs), keep: true };
    case PromQLBinaryOperator.Atan2:
      return { value: Math.atan2(lhs, rhs), keep: true };
    case PromQLBinaryOperator.Eql:
      return { value: lhs, keep: lhs === rhs };
    case PromQLBinaryOperator.Neq:
      return { value: lhs, keep: lhs !== rhs };
    case PromQLBinaryOperator.Gtr:
      return { value: lhs, keep: lhs > rhs };
    case PromQLBinaryOperator.Lss:
      return { value: lhs, keep: lhs < rhs };
    case PromQLBinaryOperator.Gte:
      return { value: lhs, keep: lhs >= rhs };
    case PromQLBinaryOperator.Lte:
      return { value: lhs, keep: lhs <= rhs };
    default:
      throw new PromQLError(
        `"${operator}" cannot be applied to two numbers.`,
        PromQLErrorType.Execution,
      );
  }
};

// Arithmetic drops the metric name; comparisons and set operations keep it.
const dropsMetricName: (operator: PromQLBinaryOperator) => boolean = (
  operator: PromQLBinaryOperator,
): boolean => {
  return (
    operator === PromQLBinaryOperator.Add ||
    operator === PromQLBinaryOperator.Sub ||
    operator === PromQLBinaryOperator.Mul ||
    operator === PromQLBinaryOperator.Div ||
    operator === PromQLBinaryOperator.Mod ||
    operator === PromQLBinaryOperator.Pow ||
    operator === PromQLBinaryOperator.Atan2
  );
};

const assertUniqueLabelSets: (samples: Array<PromQLSample>) => void = (
  samples: Array<PromQLSample>,
): void => {
  const seen: Set<string> = new Set<string>();

  for (const sample of samples) {
    const key: string = promQLLabelsKey(sample.labels);

    if (seen.has(key)) {
      throw new PromQLError(
        `Two series in the result have the same labels, ${formatPromQLLabels(sample.labels)}. Aggregate them (sum by (...)), or keep a label that tells them apart.`,
        PromQLErrorType.Execution,
      );
    }

    seen.add(key);
  }
};

const unwrapParens: (expression: PromQLExpression) => PromQLExpression = (
  expression: PromQLExpression,
): PromQLExpression => {
  let current: PromQLExpression = expression;

  while (current.kind === PromQLNodeKind.Paren) {
    current = current.expression;
  }

  return current;
};

class PromQLEvaluation {
  private readonly lookbackDeltaMs: number;
  private readonly defaultSubqueryStepMs: number;
  private readonly maxSamples: number;
  private readonly deadline: number;
  private readonly now: () => number;
  private readonly subqueryCache: Map<
    PromQLSubquery,
    Map<number, Array<PromQLSample>>
  > = new Map();
  private cachedSamples: number = 0;
  private stepsSinceClockCheck: number = 0;

  public constructor(
    private readonly options: ResolvedEngineOptions,
    private readonly queryStartMs: number,
    private readonly queryEndMs: number,
    private readonly selectorData: Map<
      PromQLVectorSelector,
      Array<LoadedSeries>
    >,
  ) {
    this.lookbackDeltaMs = options.lookbackDeltaMs;
    this.defaultSubqueryStepMs = options.defaultSubqueryStepMs;
    this.maxSamples = options.maxSamples;
    this.now = options.now;
    this.deadline = options.now() + options.timeoutMs;
  }

  public checkDeadline(): void {
    this.stepsSinceClockCheck++;

    if (this.stepsSinceClockCheck < 64) {
      return;
    }

    this.stepsSinceClockCheck = 0;

    if (this.now() > this.deadline) {
      throw new PromQLError(
        `The query took longer than ${Math.round(this.options.timeoutMs / 1000)} seconds. Shorten the time range, add label matchers, or aggregate fewer series.`,
        PromQLErrorType.Timeout,
      );
    }
  }

  private resolveAt(at: PromQLAtModifier | undefined, timeMs: number): number {
    if (!at) {
      return timeMs;
    }

    if (at.kind === "start") {
      return this.queryStartMs;
    }

    if (at.kind === "end") {
      return this.queryEndMs;
    }

    return at.timestampMs;
  }

  public evaluate(node: PromQLExpression, timeMs: number): PromQLEvalValue {
    switch (node.kind) {
      case PromQLNodeKind.NumberLiteral:
        return { type: PromQLValueType.Scalar, value: node.value };
      case PromQLNodeKind.StringLiteral:
        return { type: PromQLValueType.String, value: node.value };
      case PromQLNodeKind.Paren:
        return this.evaluate(node.expression, timeMs);
      case PromQLNodeKind.VectorSelector:
        return {
          type: PromQLValueType.InstantVector,
          samples: this.selectInstant(node, timeMs),
        };
      case PromQLNodeKind.MatrixSelector: {
        const selector: PromQLVectorSelector = node.vectorSelector;
        const referenceMs: number =
          this.resolveAt(selector.at, timeMs) - selector.offsetMs;
        const rangeStartMs: number = referenceMs - node.rangeMs;
        const series: Array<PromQLRangeSeries> = [];

        for (const loaded of this.selectorData.get(selector) || []) {
          const low: number = upperBound(loaded.timestampsMs, rangeStartMs);
          const high: number = upperBound(loaded.timestampsMs, referenceMs);

          if (high > low) {
            series.push({
              labels: loaded.labels,
              timestampsMs: loaded.timestampsMs.subarray(low, high),
              values: loaded.values.subarray(low, high),
            });
          }
        }

        return {
          type: PromQLValueType.RangeVector,
          series,
          rangeStartMs,
          rangeEndMs: referenceMs,
          rangeMs: node.rangeMs,
        };
      }
      case PromQLNodeKind.Subquery:
        return this.evaluateSubquery(node, timeMs);
      case PromQLNodeKind.Call: {
        const result: PromQLEvalValue = evaluatePromQLFunction(node, {
          timestampMs: timeMs,
          evaluate: (expression: PromQLExpression): PromQLEvalValue => {
            return this.evaluate(expression, timeMs);
          },
        });

        if (result.type === PromQLValueType.InstantVector) {
          assertUniqueLabelSets(result.samples);
        }

        return result;
      }
      case PromQLNodeKind.Aggregate:
        return {
          type: PromQLValueType.InstantVector,
          samples: this.evaluateAggregate(node, timeMs),
        };
      case PromQLNodeKind.Binary:
        return this.evaluateBinary(node, timeMs);
      case PromQLNodeKind.Unary: {
        const operand: PromQLEvalValue = this.evaluate(node.expression, timeMs);

        if (node.operator === PromQLBinaryOperator.Add) {
          return operand;
        }

        if (operand.type === PromQLValueType.Scalar) {
          return { type: PromQLValueType.Scalar, value: -operand.value };
        }

        if (operand.type !== PromQLValueType.InstantVector) {
          throw new PromQLError(
            "A unary minus works on a number or an instant vector.",
            PromQLErrorType.Execution,
            node.position,
          );
        }

        const negated: Array<PromQLSample> = operand.samples.map(
          (sample: PromQLSample): PromQLSample => {
            return {
              labels: dropMetricName(sample.labels),
              value: -sample.value,
              timestampMs: timeMs,
            };
          },
        );

        assertUniqueLabelSets(negated);

        return { type: PromQLValueType.InstantVector, samples: negated };
      }
    }
  }

  private selectInstant(
    selector: PromQLVectorSelector,
    timeMs: number,
  ): Array<PromQLSample> {
    const referenceMs: number =
      this.resolveAt(selector.at, timeMs) - selector.offsetMs;
    const samples: Array<PromQLSample> = [];

    for (const loaded of this.selectorData.get(selector) || []) {
      const index: number = upperBound(loaded.timestampsMs, referenceMs) - 1;

      if (index < 0) {
        continue;
      }

      const timestampMs: number = loaded.timestampsMs[index]!;

      // The lookback window is open at its start, as in Prometheus 3.
      if (timestampMs <= referenceMs - this.lookbackDeltaMs) {
        continue;
      }

      samples.push({
        labels: loaded.labels,
        value: loaded.values[index]!,
        timestampMs,
      });
    }

    return samples;
  }

  private evaluateSubquery(
    node: PromQLSubquery,
    timeMs: number,
  ): PromQLEvalValue {
    const referenceMs: number = this.resolveAt(node.at, timeMs) - node.offsetMs;
    const stepMs: number = node.stepMs ?? this.defaultSubqueryStepMs;
    const rangeStartMs: number = referenceMs - node.rangeMs;

    // The first step after the range's start that is a multiple of the step.
    let firstMs: number = Math.floor(rangeStartMs / stepMs) * stepMs;

    if (firstMs <= rangeStartMs) {
      firstMs += stepMs;
    }

    let cache: Map<number, Array<PromQLSample>> | undefined =
      this.subqueryCache.get(node);

    if (!cache) {
      cache = new Map();
      this.subqueryCache.set(node, cache);
    }

    const bySeries: Map<
      string,
      {
        labels: PromQLLabels;
        timestampsMs: Array<number>;
        values: Array<number>;
      }
    > = new Map();

    for (
      let stepTimeMs: number = firstMs;
      stepTimeMs <= referenceMs;
      stepTimeMs += stepMs
    ) {
      this.checkDeadline();
      let samples: Array<PromQLSample> | undefined = cache.get(stepTimeMs);

      if (!samples) {
        const value: PromQLEvalValue = this.evaluate(
          node.expression,
          stepTimeMs,
        );

        if (value.type !== PromQLValueType.InstantVector) {
          throw new PromQLError(
            "A subquery needs an instant vector inside it.",
            PromQLErrorType.Execution,
            node.position,
          );
        }

        samples = value.samples;
        cache.set(stepTimeMs, samples);
        this.cachedSamples += samples.length;

        if (this.cachedSamples > this.maxSamples) {
          throw tooManySamplesError(this.maxSamples);
        }
      }

      for (const sample of samples) {
        const key: string = promQLLabelsKey(sample.labels);
        let series:
          | {
              labels: PromQLLabels;
              timestampsMs: Array<number>;
              values: Array<number>;
            }
          | undefined = bySeries.get(key);

        if (!series) {
          series = { labels: sample.labels, timestampsMs: [], values: [] };
          bySeries.set(key, series);
        }

        series.timestampsMs.push(stepTimeMs);
        series.values.push(sample.value);
      }
    }

    return {
      type: PromQLValueType.RangeVector,
      series: Array.from(bySeries.values()),
      rangeStartMs,
      rangeEndMs: referenceMs,
      rangeMs: node.rangeMs,
    };
  }

  private evaluateAggregate(
    node: PromQLAggregate,
    timeMs: number,
  ): Array<PromQLSample> {
    const input: PromQLEvalValue = this.evaluate(node.expression, timeMs);

    if (input.type !== PromQLValueType.InstantVector) {
      throw new PromQLError(
        `${node.operator}(...) needs an instant vector.`,
        PromQLErrorType.Execution,
        node.position,
      );
    }

    let parameter: PromQLEvalValue | undefined = undefined;

    if (node.parameter) {
      parameter = this.evaluate(node.parameter, timeMs);
    }

    return aggregate(node, input.samples, parameter, timeMs);
  }

  private evaluateBinary(node: PromQLBinary, timeMs: number): PromQLEvalValue {
    const lhs: PromQLEvalValue = this.evaluate(node.lhs, timeMs);
    const rhs: PromQLEvalValue = this.evaluate(node.rhs, timeMs);
    const operator: PromQLBinaryOperator = node.operator;

    if (
      lhs.type === PromQLValueType.Scalar &&
      rhs.type === PromQLValueType.Scalar
    ) {
      const result: { value: number; keep: boolean } = elementBinop(
        operator,
        lhs.value,
        rhs.value,
      );

      if (isComparisonOperator(operator)) {
        return { type: PromQLValueType.Scalar, value: result.keep ? 1 : 0 };
      }

      return { type: PromQLValueType.Scalar, value: result.value };
    }

    if (
      lhs.type === PromQLValueType.InstantVector &&
      rhs.type === PromQLValueType.Scalar
    ) {
      return vectorOf(
        vectorScalarBinop(
          operator,
          lhs.samples,
          rhs.value,
          false,
          node.returnBool,
          timeMs,
        ),
      );
    }

    if (
      lhs.type === PromQLValueType.Scalar &&
      rhs.type === PromQLValueType.InstantVector
    ) {
      return vectorOf(
        vectorScalarBinop(
          operator,
          rhs.samples,
          lhs.value,
          true,
          node.returnBool,
          timeMs,
        ),
      );
    }

    if (
      lhs.type !== PromQLValueType.InstantVector ||
      rhs.type !== PromQLValueType.InstantVector
    ) {
      throw new PromQLError(
        `"${operator}" works on numbers and instant vectors.`,
        PromQLErrorType.Execution,
        node.position,
      );
    }

    const matching: PromQLVectorMatching = node.matching || {
      cardinality: PromQLVectorMatchCardinality.OneToOne,
      on: false,
      matchingLabels: [],
      include: [],
    };

    switch (operator) {
      case PromQLBinaryOperator.And:
        return vectorOf(setAnd(lhs.samples, rhs.samples, matching));
      case PromQLBinaryOperator.Or:
        return vectorOf(setOr(lhs.samples, rhs.samples, matching));
      case PromQLBinaryOperator.Unless:
        return vectorOf(setUnless(lhs.samples, rhs.samples, matching));
      default: {
        const samples: Array<PromQLSample> = vectorBinop(
          operator,
          lhs.samples,
          rhs.samples,
          matching,
          node.returnBool,
          timeMs,
        );
        assertUniqueLabelSets(samples);
        return vectorOf(samples);
      }
    }
  }
}

const vectorOf: (samples: Array<PromQLSample>) => PromQLEvalValue = (
  samples: Array<PromQLSample>,
): PromQLEvalValue => {
  return { type: PromQLValueType.InstantVector, samples };
};

const tooManySamplesError: (maxSamples: number) => PromQLError = (
  maxSamples: number,
): PromQLError => {
  return new PromQLError(
    `The query needs more than ${maxSamples.toLocaleString("en-US")} samples. Shorten the time range, add label matchers, or use a larger step.`,
    PromQLErrorType.Execution,
  );
};

const vectorScalarBinop: (
  operator: PromQLBinaryOperator,
  samples: Array<PromQLSample>,
  scalar: number,
  scalarOnLeft: boolean,
  returnBool: boolean,
  timeMs: number,
) => Array<PromQLSample> = (
  operator: PromQLBinaryOperator,
  samples: Array<PromQLSample>,
  scalar: number,
  scalarOnLeft: boolean,
  returnBool: boolean,
  timeMs: number,
): Array<PromQLSample> => {
  const output: Array<PromQLSample> = [];

  for (const sample of samples) {
    const left: number = scalarOnLeft ? scalar : sample.value;
    const right: number = scalarOnLeft ? sample.value : scalar;
    const result: { value: number; keep: boolean } = elementBinop(
      operator,
      left,
      right,
    );
    // A comparison keeps the vector's value, whichever side it is on.
    let value: number = isComparisonOperator(operator)
      ? sample.value
      : result.value;
    let keep: boolean = result.keep;

    if (returnBool) {
      value = keep ? 1 : 0;
      keep = true;
    }

    if (!keep) {
      continue;
    }

    output.push({
      labels:
        dropsMetricName(operator) || returnBool
          ? dropMetricName(sample.labels)
          : sample.labels,
      value,
      timestampMs: timeMs,
    });
  }

  return output;
};

/*
 * The labels of one result of a vector-to-vector operation (resultMetric):
 * the "many" side's labels, narrowed to the matching labels for one-to-one
 * `on (...)`, with the group_left/group_right labels copied from the "one"
 * side.
 */
const resultLabels: (
  manySide: PromQLLabels,
  oneSide: PromQLLabels,
  operator: PromQLBinaryOperator,
  matching: PromQLVectorMatching,
  returnBool: boolean,
) => PromQLLabels = (
  manySide: PromQLLabels,
  oneSide: PromQLLabels,
  operator: PromQLBinaryOperator,
  matching: PromQLVectorMatching,
  returnBool: boolean,
): PromQLLabels => {
  let labels: PromQLLabels = { ...manySide };

  if (dropsMetricName(operator) || returnBool) {
    delete labels[PROMQL_METRIC_NAME_LABEL];
  }

  if (matching.cardinality === PromQLVectorMatchCardinality.OneToOne) {
    if (matching.on) {
      const kept: PromQLLabels = {};

      for (const name of matching.matchingLabels) {
        if (labels[name] !== undefined) {
          kept[name] = labels[name]!;
        }
      }

      labels = kept;
    } else {
      for (const name of matching.matchingLabels) {
        delete labels[name];
      }
    }
  }

  for (const name of matching.include) {
    const value: string | undefined = oneSide[name];

    if (value) {
      labels[name] = value;
    } else {
      delete labels[name];
    }
  }

  return labels;
};

const vectorBinop: (
  operator: PromQLBinaryOperator,
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
  returnBool: boolean,
  timeMs: number,
) => Array<PromQLSample> = (
  operator: PromQLBinaryOperator,
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
  returnBool: boolean,
  timeMs: number,
): Array<PromQLSample> => {
  if (lhs.length === 0 || rhs.length === 0) {
    return [];
  }

  const swapped: boolean =
    matching.cardinality === PromQLVectorMatchCardinality.OneToMany;
  // The "many" side is walked; the "one" side is looked up.
  const manySide: Array<PromQLSample> = swapped ? rhs : lhs;
  const oneSide: Array<PromQLSample> = swapped ? lhs : rhs;
  const signature: (labels: PromQLLabels) => string = (
    labels: PromQLLabels,
  ): string => {
    return promQLMatchSignature(labels, matching.on, matching.matchingLabels);
  };

  const oneBySignature: Map<string, PromQLSample> = new Map();

  for (const sample of oneSide) {
    const key: string = signature(sample.labels);
    const duplicate: PromQLSample | undefined = oneBySignature.get(key);

    if (duplicate) {
      throw new PromQLError(
        `More than one series on the ${swapped ? "left" : "right"} side matches ${formatPromQLLabels(sample.labels)} and ${formatPromQLLabels(duplicate.labels)}. Match on labels that are unique there, with on (...) or ignoring (...).`,
        PromQLErrorType.Execution,
      );
    }

    oneBySignature.set(key, sample);
  }

  const matched: Map<string, Set<string>> = new Map();
  const output: Array<PromQLSample> = [];

  for (const sample of manySide) {
    const key: string = signature(sample.labels);
    const partner: PromQLSample | undefined = oneBySignature.get(key);

    if (!partner) {
      continue;
    }

    // The operator always reads the query's left side first.
    const left: number = swapped ? partner.value : sample.value;
    const right: number = swapped ? sample.value : partner.value;
    const result: { value: number; keep: boolean } = elementBinop(
      operator,
      left,
      right,
    );
    let value: number = result.value;

    if (returnBool) {
      value = result.keep ? 1 : 0;
    } else if (!result.keep) {
      continue;
    }

    const labels: PromQLLabels = resultLabels(
      sample.labels,
      partner.labels,
      operator,
      matching,
      returnBool,
    );

    if (matching.cardinality === PromQLVectorMatchCardinality.OneToOne) {
      if (matched.has(key)) {
        throw new PromQLError(
          "More than one series on the left side matches one series on the right. Say which side has many with group_left or group_right.",
          PromQLErrorType.Execution,
        );
      }

      matched.set(key, new Set<string>());
    } else {
      let inserted: Set<string> | undefined = matched.get(key);

      if (!inserted) {
        inserted = new Set<string>();
        matched.set(key, inserted);
      }

      const labelsKey: string = promQLLabelsKey(labels);

      if (inserted.has(labelsKey)) {
        throw new PromQLError(
          `Two results of the match have the same labels, ${formatPromQLLabels(labels)}. List more labels in group_left (...) or group_right (...) so each result is unique.`,
          PromQLErrorType.Execution,
        );
      }

      inserted.add(labelsKey);
    }

    output.push({ labels, value, timestampMs: timeMs });
  }

  return output;
};

const signaturesOf: (
  samples: Array<PromQLSample>,
  matching: PromQLVectorMatching,
) => Array<string> = (
  samples: Array<PromQLSample>,
  matching: PromQLVectorMatching,
): Array<string> => {
  return samples.map((sample: PromQLSample): string => {
    return promQLMatchSignature(
      sample.labels,
      matching.on,
      matching.matchingLabels,
    );
  });
};

const setAnd: (
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
) => Array<PromQLSample> = (
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
): Array<PromQLSample> => {
  if (lhs.length === 0 || rhs.length === 0) {
    return [];
  }

  const right: Set<string> = new Set<string>(signaturesOf(rhs, matching));
  const leftSignatures: Array<string> = signaturesOf(lhs, matching);

  return lhs.filter((_sample: PromQLSample, index: number): boolean => {
    return right.has(leftSignatures[index]!);
  });
};

const setOr: (
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
) => Array<PromQLSample> = (
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
): Array<PromQLSample> => {
  const left: Set<string> = new Set<string>(signaturesOf(lhs, matching));
  const rightSignatures: Array<string> = signaturesOf(rhs, matching);

  return [
    ...lhs,
    ...rhs.filter((_sample: PromQLSample, index: number): boolean => {
      return !left.has(rightSignatures[index]!);
    }),
  ];
};

const setUnless: (
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
) => Array<PromQLSample> = (
  lhs: Array<PromQLSample>,
  rhs: Array<PromQLSample>,
  matching: PromQLVectorMatching,
): Array<PromQLSample> => {
  if (rhs.length === 0) {
    return lhs;
  }

  const right: Set<string> = new Set<string>(signaturesOf(rhs, matching));
  const leftSignatures: Array<string> = signaturesOf(lhs, matching);

  return lhs.filter((_sample: PromQLSample, index: number): boolean => {
    return !right.has(leftSignatures[index]!);
  });
};

// The labels an aggregation's group keeps.
const groupingLabels: (
  labels: PromQLLabels,
  grouping: Array<string>,
  without: boolean,
) => PromQLLabels = (
  labels: PromQLLabels,
  grouping: Array<string>,
  without: boolean,
): PromQLLabels => {
  if (without) {
    const kept: PromQLLabels = { ...labels };
    delete kept[PROMQL_METRIC_NAME_LABEL];

    for (const name of grouping) {
      delete kept[name];
    }

    return kept;
  }

  const kept: PromQLLabels = {};

  for (const name of grouping) {
    if (labels[name] !== undefined) {
      kept[name] = labels[name]!;
    }
  }

  return kept;
};

const aggregate: (
  node: PromQLAggregate,
  samples: Array<PromQLSample>,
  parameter: PromQLEvalValue | undefined,
  timeMs: number,
) => Array<PromQLSample> = (
  node: PromQLAggregate,
  samples: Array<PromQLSample>,
  parameter: PromQLEvalValue | undefined,
  timeMs: number,
): Array<PromQLSample> => {
  const operator: PromQLAggregateOperator = node.operator;

  if (operator === PromQLAggregateOperator.CountValues) {
    const valueLabel: string =
      parameter?.type === PromQLValueType.String ? parameter.value : "";

    if (valueLabel.length === 0) {
      throw new PromQLError(
        'count_values() needs a label name to write each value into, such as count_values("version", build_info).',
        PromQLErrorType.Execution,
        node.position,
      );
    }

    const grouping: Array<string> = node.without
      ? node.grouping
      : [...node.grouping, valueLabel];
    const counts: Map<string, { labels: PromQLLabels; count: number }> =
      new Map();

    for (const sample of samples) {
      const withValue: PromQLLabels = {
        ...sample.labels,
        [valueLabel]: formatPromQLValue(sample.value),
      };
      const labels: PromQLLabels = groupingLabels(
        withValue,
        grouping,
        node.without,
      );
      const key: string = promQLLabelsKey(labels);
      const existing: { labels: PromQLLabels; count: number } | undefined =
        counts.get(key);

      if (existing) {
        existing.count++;
      } else {
        counts.set(key, { labels, count: 1 });
      }
    }

    return Array.from(counts.values()).map(
      (group: { labels: PromQLLabels; count: number }): PromQLSample => {
        return {
          labels: group.labels,
          value: group.count,
          timestampMs: timeMs,
        };
      },
    );
  }

  const groups: Map<
    string,
    { labels: PromQLLabels; members: Array<PromQLSample> }
  > = new Map();

  for (const sample of samples) {
    const labels: PromQLLabels = groupingLabels(
      sample.labels,
      node.grouping,
      node.without,
    );
    const key: string = promQLLabelsKey(labels);
    let group:
      | { labels: PromQLLabels; members: Array<PromQLSample> }
      | undefined = groups.get(key);

    if (!group) {
      group = { labels, members: [] };
      groups.set(key, group);
    }

    group.members.push(sample);
  }

  if (
    operator === PromQLAggregateOperator.Topk ||
    operator === PromQLAggregateOperator.Bottomk
  ) {
    const k: number =
      parameter?.type === PromQLValueType.Scalar ? parameter.value : NaN;

    if (Number.isNaN(k)) {
      throw new PromQLError(
        `The number of series ${operator}() keeps is not a number.`,
        PromQLErrorType.Execution,
        node.position,
      );
    }

    const count: number = Math.trunc(k);

    if (count < 1) {
      return [];
    }

    const output: Array<PromQLSample> = [];
    const descending: boolean = operator === PromQLAggregateOperator.Topk;

    for (const group of groups.values()) {
      const ordered: Array<PromQLSample> = [...group.members].sort(
        (a: PromQLSample, b: PromQLSample): number => {
          // NaN is never among the top or the bottom while a number is left.
          if (Number.isNaN(a.value)) {
            return Number.isNaN(b.value) ? 0 : 1;
          }

          if (Number.isNaN(b.value)) {
            return -1;
          }

          return descending ? b.value - a.value : a.value - b.value;
        },
      );

      for (const member of ordered.slice(0, count)) {
        output.push({
          labels: member.labels,
          value: member.value,
          timestampMs: timeMs,
        });
      }
    }

    return output;
  }

  const output: Array<PromQLSample> = [];

  for (const group of groups.values()) {
    const values: Array<number> = group.members.map(
      (member: PromQLSample): number => {
        return member.value;
      },
    );
    let value: number;

    switch (operator) {
      case PromQLAggregateOperator.Sum: {
        const sum: KahanSum = { sum: 0, compensation: 0 };

        for (const item of values) {
          kahanAdd(sum, item);
        }

        value = kahanResult(sum);
        break;
      }
      case PromQLAggregateOperator.Avg: {
        const sum: KahanSum = { sum: 0, compensation: 0 };

        for (const item of values) {
          kahanAdd(sum, item);
        }

        value = kahanResult(sum) / values.length;
        break;
      }
      case PromQLAggregateOperator.Min: {
        value = values[0]!;

        for (const item of values) {
          if (item < value || Number.isNaN(value)) {
            value = item;
          }
        }

        break;
      }
      case PromQLAggregateOperator.Max: {
        value = values[0]!;

        for (const item of values) {
          if (item > value || Number.isNaN(value)) {
            value = item;
          }
        }

        break;
      }
      case PromQLAggregateOperator.Count:
        value = values.length;
        break;
      case PromQLAggregateOperator.Group:
        value = 1;
        break;
      case PromQLAggregateOperator.Stddev:
      case PromQLAggregateOperator.Stdvar: {
        let count: number = 0;
        let mean: number = 0;
        let squares: number = 0;

        for (const item of values) {
          count++;
          const delta: number = item - mean;
          mean += delta / count;
          squares += delta * (item - mean);
        }

        value =
          operator === PromQLAggregateOperator.Stddev
            ? Math.sqrt(squares / count)
            : squares / count;
        break;
      }
      case PromQLAggregateOperator.Quantile: {
        const phi: number =
          parameter?.type === PromQLValueType.Scalar ? parameter.value : NaN;
        value = promQLQuantile(phi, values);
        break;
      }
      default:
        throw new PromQLError(
          `Unknown aggregation "${operator}".`,
          PromQLErrorType.BadData,
          node.position,
        );
    }

    output.push({ labels: group.labels, value, timestampMs: timeMs });
  }

  return output;
};

/*
 * Every selector in the tree with the window of samples its evaluation can
 * read, when the expression around it is evaluated at times from `startMs`
 * to `endMs` (getTimeRangesForSelector).
 */
const collectSelectorWindows: (
  node: PromQLExpression,
  startMs: number,
  endMs: number,
  queryStartMs: number,
  queryEndMs: number,
  lookbackDeltaMs: number,
  windows: Array<SelectorWindow>,
) => void = (
  node: PromQLExpression,
  startMs: number,
  endMs: number,
  queryStartMs: number,
  queryEndMs: number,
  lookbackDeltaMs: number,
  windows: Array<SelectorWindow>,
): void => {
  const fixedAt: (at: PromQLAtModifier) => number = (
    at: PromQLAtModifier,
  ): number => {
    if (at.kind === "start") {
      return queryStartMs;
    }

    if (at.kind === "end") {
      return queryEndMs;
    }

    return at.timestampMs;
  };

  const recurse: (child: PromQLExpression, from: number, to: number) => void = (
    child: PromQLExpression,
    from: number,
    to: number,
  ): void => {
    collectSelectorWindows(
      child,
      from,
      to,
      queryStartMs,
      queryEndMs,
      lookbackDeltaMs,
      windows,
    );
  };

  switch (node.kind) {
    case PromQLNodeKind.VectorSelector: {
      const from: number = node.at ? fixedAt(node.at) : startMs;
      const to: number = node.at ? fixedAt(node.at) : endMs;
      windows.push({
        selector: node,
        startTimeMs: from - node.offsetMs - lookbackDeltaMs,
        endTimeMs: to - node.offsetMs,
      });
      return;
    }
    case PromQLNodeKind.MatrixSelector: {
      const selector: PromQLVectorSelector = node.vectorSelector;
      const from: number = selector.at ? fixedAt(selector.at) : startMs;
      const to: number = selector.at ? fixedAt(selector.at) : endMs;
      windows.push({
        selector,
        startTimeMs: from - selector.offsetMs - node.rangeMs,
        endTimeMs: to - selector.offsetMs,
      });
      return;
    }
    case PromQLNodeKind.Subquery: {
      const from: number = node.at ? fixedAt(node.at) : startMs;
      const to: number = node.at ? fixedAt(node.at) : endMs;
      recurse(
        node.expression,
        from - node.offsetMs - node.rangeMs,
        to - node.offsetMs,
      );
      return;
    }
    case PromQLNodeKind.Call:
      for (const argument of node.args) {
        recurse(argument, startMs, endMs);
      }
      return;
    case PromQLNodeKind.Aggregate:
      recurse(node.expression, startMs, endMs);

      if (node.parameter) {
        recurse(node.parameter, startMs, endMs);
      }
      return;
    case PromQLNodeKind.Binary:
      recurse(node.lhs, startMs, endMs);
      recurse(node.rhs, startMs, endMs);
      return;
    case PromQLNodeKind.Unary:
    case PromQLNodeKind.Paren:
      recurse(node.expression, startMs, endMs);
      return;
    case PromQLNodeKind.NumberLiteral:
    case PromQLNodeKind.StringLiteral:
      return;
  }
};

export default class PromQLEngine {
  private readonly source: PromQLSeriesSource;
  private readonly options: ResolvedEngineOptions;

  public constructor(
    source: PromQLSeriesSource,
    options: PromQLEngineOptions = {},
  ) {
    this.source = source;
    this.options = {
      lookbackDeltaMs:
        options.lookbackDeltaMs ?? PROMQL_DEFAULT_LOOKBACK_DELTA_MS,
      defaultSubqueryStepMs:
        options.defaultSubqueryStepMs ?? PROMQL_DEFAULT_SUBQUERY_STEP_MS,
      maxSamples: options.maxSamples ?? PROMQL_DEFAULT_MAX_SAMPLES,
      maxPointsPerSeries:
        options.maxPointsPerSeries ?? PROMQL_MAX_POINTS_PER_SERIES,
      timeoutMs: options.timeoutMs ?? PROMQL_DEFAULT_TIMEOUT_MS,
      now:
        options.now ||
        ((): number => {
          return Date.now();
        }),
    };
  }

  // Evaluates a query at one time.
  public async instantQuery(
    query: string | PromQLExpression,
    timeMs: number,
  ): Promise<PromQLQueryResult> {
    const expression: PromQLExpression =
      typeof query === "string" ? parsePromQL(query) : query;
    const evaluation: PromQLEvaluation = await this.prepare(
      expression,
      timeMs,
      timeMs,
    );
    const value: PromQLEvalValue = evaluation.evaluate(expression, timeMs);

    switch (value.type) {
      case PromQLValueType.Scalar:
        return {
          resultType: PromQLResultType.Scalar,
          timestampMs: timeMs,
          value: value.value,
        };
      case PromQLValueType.String:
        return {
          resultType: PromQLResultType.String,
          timestampMs: timeMs,
          value: value.value,
        };
      case PromQLValueType.InstantVector: {
        const samples: Array<PromQLVectorResultSample> = value.samples.map(
          (sample: PromQLSample): PromQLVectorResultSample => {
            return {
              labels: sample.labels,
              timestampMs: timeMs,
              value: sample.value,
            };
          },
        );
        const root: PromQLExpression = unwrapParens(expression);
        const keepsOrder: boolean =
          root.kind === PromQLNodeKind.Call &&
          PROMQL_ORDERING_FUNCTIONS.has(root.functionName);

        return {
          resultType: PromQLResultType.Vector,
          samples: keepsOrder ? samples : sortByLabels(samples),
        };
      }
      case PromQLValueType.RangeVector:
        return {
          resultType: PromQLResultType.Matrix,
          series: sortByLabels(
            value.series.map(
              (series: PromQLRangeSeries): PromQLMatrixResultSeries => {
                const points: Array<{ timestampMs: number; value: number }> =
                  [];

                for (
                  let index: number = 0;
                  index < series.values.length;
                  index++
                ) {
                  points.push({
                    timestampMs: series.timestampsMs[index]!,
                    value: series.values[index]!,
                  });
                }

                return { labels: series.labels, points };
              },
            ),
          ),
        };
    }
  }

  // Evaluates a query at every step from start to end.
  public async rangeQuery(
    query: string | PromQLExpression,
    startMs: number,
    endMs: number,
    stepMs: number,
  ): Promise<PromQLQueryResult> {
    if (!(stepMs > 0)) {
      throw new PromQLError(
        "The step must be longer than zero, such as 15s or 60.",
      );
    }

    if (endMs < startMs) {
      throw new PromQLError("The end of the time range is before its start.");
    }

    const points: number = Math.floor((endMs - startMs) / stepMs) + 1;

    if (points > this.options.maxPointsPerSeries) {
      throw new PromQLError(
        `The time range and step give ${points.toLocaleString("en-US")} points per series, more than the ${this.options.maxPointsPerSeries.toLocaleString("en-US")} allowed. Use a larger step or a shorter time range.`,
      );
    }

    const expression: PromQLExpression =
      typeof query === "string" ? parsePromQL(query) : query;
    const type: PromQLValueType = getPromQLValueType(expression);

    if (
      type !== PromQLValueType.Scalar &&
      type !== PromQLValueType.InstantVector
    ) {
      throw new PromQLError(
        `A chart over time needs a number or an instant vector, but this query is a ${type === PromQLValueType.RangeVector ? "range vector" : "string"}. Wrap it in a function such as rate(...[5m]).`,
      );
    }

    const evaluation: PromQLEvaluation = await this.prepare(
      expression,
      startMs,
      endMs,
    );
    const series: Map<string, PromQLMatrixResultSeries> = new Map();
    let totalPoints: number = 0;

    for (let timeMs: number = startMs; timeMs <= endMs; timeMs += stepMs) {
      evaluation.checkDeadline();
      const value: PromQLEvalValue = evaluation.evaluate(expression, timeMs);
      const samples: Array<{ labels: PromQLLabels; value: number }> =
        value.type === PromQLValueType.Scalar
          ? [{ labels: {}, value: value.value }]
          : value.type === PromQLValueType.InstantVector
            ? value.samples
            : [];

      for (const sample of samples) {
        const key: string = promQLLabelsKey(sample.labels);
        let entry: PromQLMatrixResultSeries | undefined = series.get(key);

        if (!entry) {
          entry = { labels: sample.labels, points: [] };
          series.set(key, entry);
        }

        entry.points.push({ timestampMs: timeMs, value: sample.value });
        totalPoints++;
      }

      if (totalPoints > this.options.maxSamples) {
        throw tooManySamplesError(this.options.maxSamples);
      }
    }

    return {
      resultType: PromQLResultType.Matrix,
      series: sortByLabels(Array.from(series.values())),
    };
  }

  private async prepare(
    expression: PromQLExpression,
    startMs: number,
    endMs: number,
  ): Promise<PromQLEvaluation> {
    const windows: Array<SelectorWindow> = [];
    collectSelectorWindows(
      expression,
      startMs,
      endMs,
      startMs,
      endMs,
      this.options.lookbackDeltaMs,
      windows,
    );

    // One read per distinct selector, covering every window it needs.
    const merged: Map<
      string,
      {
        selectors: Array<PromQLVectorSelector>;
        startTimeMs: number;
        endTimeMs: number;
      }
    > = new Map();

    for (const window of windows) {
      const key: string = selectorKey(window.selector);
      const existing:
        | {
            selectors: Array<PromQLVectorSelector>;
            startTimeMs: number;
            endTimeMs: number;
          }
        | undefined = merged.get(key);

      if (existing) {
        existing.selectors.push(window.selector);
        existing.startTimeMs = Math.min(
          existing.startTimeMs,
          window.startTimeMs,
        );
        existing.endTimeMs = Math.max(existing.endTimeMs, window.endTimeMs);
      } else {
        merged.set(key, {
          selectors: [window.selector],
          startTimeMs: window.startTimeMs,
          endTimeMs: window.endTimeMs,
        });
      }
    }

    const selectorData: Map<
      PromQLVectorSelector,
      Array<LoadedSeries>
    > = new Map();
    let loadedSamples: number = 0;

    const reads: Array<{
      selectors: Array<PromQLVectorSelector>;
      series: Array<PromQLSeries>;
    }> = await Promise.all(
      Array.from(merged.values()).map(
        async (group: {
          selectors: Array<PromQLVectorSelector>;
          startTimeMs: number;
          endTimeMs: number;
        }): Promise<{
          selectors: Array<PromQLVectorSelector>;
          series: Array<PromQLSeries>;
        }> => {
          const first: PromQLVectorSelector = group.selectors[0]!;
          const series: Array<PromQLSeries> = await this.source.select({
            metricName: first.name,
            matchers: first.matchers,
            startTimeMs: group.startTimeMs,
            endTimeMs: group.endTimeMs,
          });

          return { selectors: group.selectors, series };
        },
      ),
    );

    for (const read of reads) {
      const loaded: Array<LoadedSeries> = [];

      for (const series of read.series) {
        loadedSamples += series.values.length;
        loaded.push({
          labels: series.labels,
          timestampsMs: toFloat64Array(series.timestampsMs),
          values: toFloat64Array(series.values),
        });
      }

      if (loadedSamples > this.options.maxSamples) {
        throw tooManySamplesError(this.options.maxSamples);
      }

      for (const selector of read.selectors) {
        selectorData.set(selector, loaded);
      }
    }

    return new PromQLEvaluation(this.options, startMs, endMs, selectorData);
  }
}

const sortByLabels: <T extends { labels: PromQLLabels }>(
  items: Array<T>,
) => Array<T> = <T extends { labels: PromQLLabels }>(
  items: Array<T>,
): Array<T> => {
  return items
    .map((item: T): { item: T; key: string } => {
      return { item, key: promQLLabelsKey(item.labels) };
    })
    .sort(
      (a: { item: T; key: string }, b: { item: T; key: string }): number => {
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      },
    )
    .map((entry: { item: T; key: string }): T => {
      return entry.item;
    });
};
