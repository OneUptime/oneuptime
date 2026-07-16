import BadDataException from "../../Types/Exception/BadDataException";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import MetricFormulaConfigData from "../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";
import { JSONObject, JSONValue } from "../../Types/JSON";

/**
 * Shunting-yard based evaluator for metric formulas such as
 * "$A + $B * 2" or "(a - b) / 100". Variables are matched by metric
 * alias (case-insensitive, with or without a leading "$"). Evaluates
 * the formula point-by-point against a time-aligned series from the
 * referenced queries/formulas.
 *
 * Group-aware: when a referenced query is grouped (e.g. by "host.name")
 * and its result carries multiple series, the formula is evaluated once
 * per group present in ALL grouped variables (Datadog-style), and the
 * group's attributes are stamped onto the output rows so chart layers
 * can split them back into one line per group. Ungrouped variables
 * broadcast across groups; a variable whose QUERY was grouped is joined
 * by group key even when it happens to return a single series (see
 * isGroupedVariable). When every referenced variable has a single
 * series the evaluator behaves exactly like the original timestamp-only
 * join — no stamping, identical output.
 */

enum TokenType {
  Number = "number",
  Variable = "variable",
  Operator = "operator",
  LeftParen = "lparen",
  RightParen = "rparen",
}

interface Token {
  type: TokenType;
  value: string;
}

type UnaryOperator = "u-" | "u+";
type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "^";
type Operator = UnaryOperator | BinaryOperator;

const OPERATOR_PRECEDENCE: Record<Operator, number> = {
  "u-": 4,
  "u+": 4,
  "^": 3,
  "*": 2,
  "/": 2,
  "%": 2,
  "+": 1,
  "-": 1,
};

const RIGHT_ASSOCIATIVE: Set<Operator> = new Set<Operator>(["^", "u-", "u+"]);

export interface FormulaPoint {
  timestamp: Date | string;
  value: number;
}

interface VariableSeriesData {
  result: AggregatedResult;
  groupByAttributeKeys: Array<string>;
}

interface SeriesGroupBucket {
  labels: JSONObject;
  samples: Array<AggregatedModel>;
}

export default class MetricFormulaEvaluator {
  /**
   * Evaluate a formula against the provided query/formula results and
   * return a synthetic AggregatedResult whose timestamps are the union
   * of all referenced series. Grouped inputs produce one output series
   * per common group, with the group attributes stamped on each row.
   *
   * Throws for STRUCTURAL problems (invalid formula syntax/arity,
   * unknown variable, grouped variables with no groups in common).
   * Per-point data gaps (a timestamp missing from one variable) are
   * skipped silently, as before.
   */
  public static evaluateFormula(input: {
    formula: string;
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
    results: Array<AggregatedResult>;
  }): AggregatedResult {
    const trimmedFormula: string = (input.formula || "").trim();
    if (!trimmedFormula) {
      return { data: [] };
    }

    // Throws a descriptive BadDataException for syntax and arity errors.
    const rpn: Array<Token> = MetricFormulaEvaluator.toRpn(trimmedFormula);

    const variableData: Record<string, VariableSeriesData> =
      MetricFormulaEvaluator.buildVariableResultMap({
        queryConfigs: input.queryConfigs,
        formulaConfigs: input.formulaConfigs,
        results: input.results,
      });

    /*
     * Validate every variable referenced in the formula actually resolves
     * to a result series. Failing loudly is better than silently returning
     * NaN when a user typos an alias.
     */
    const referencedVariables: Array<string> =
      MetricFormulaEvaluator.collectVariableNames(rpn);

    for (const variableName of referencedVariables) {
      if (!variableData[variableName]) {
        throw new BadDataException(
          `Formula references unknown variable "$${variableName}". Define a metric query with that alias first.`,
        );
      }
    }

    /*
     * Bucket each variable's rows into series groups.
     */
    const seriesBuckets: Record<string, Map<string, SeriesGroupBucket>> = {};

    for (const variableName of referencedVariables) {
      seriesBuckets[variableName] = MetricFormulaEvaluator.bucketSeriesByGroup(
        variableData[variableName]!,
      );
    }

    /*
     * The grouped path only ENGAGES when some variable factually carries
     * two or more series. Callers like the metric-monitor worker
     * pre-bucket per series fingerprint and pass one series per variable
     * (with grouped query configs still attached), and those inputs must
     * remain an exact — byte-identical — passthrough of the original
     * single-series behavior.
     */
    const hasMultiSeriesVariable: boolean = referencedVariables.some(
      (variableName: string) => {
        return (seriesBuckets[variableName]?.size || 0) >= 2;
      },
    );

    if (!hasMultiSeriesVariable) {
      // Single-series inputs: exact passthrough of the original behavior.
      const seriesByVariable: Record<string, Array<AggregatedModel>> = {};
      for (const variableName of referencedVariables) {
        seriesByVariable[variableName] =
          variableData[variableName]!.result.data;
      }

      return {
        data: MetricFormulaEvaluator.evaluatePointwise({
          rpn,
          referencedVariables,
          seriesByVariable,
        }),
      };
    }

    /*
     * Once in the grouped path, classification switches from observed
     * series count to query intent where available: a variable whose
     * query was grouped joins by group key even when it returned a
     * single series. Every multi-series variable satisfies the
     * predicate too, so groupedVariables is never empty here.
     */
    const groupedVariables: Array<string> = referencedVariables.filter(
      (variableName: string) => {
        return MetricFormulaEvaluator.isGroupedVariable(
          seriesBuckets[variableName],
          variableData[variableName]!,
        );
      },
    );

    /*
     * Groups the formula is evaluated for = groups present in EVERY
     * grouped variable. Ungrouped variables broadcast, so they don't
     * constrain the set.
     */
    let commonGroupKeys: Array<string> = Array.from(
      seriesBuckets[groupedVariables[0]!]!.keys(),
    );

    for (let index: number = 1; index < groupedVariables.length; index++) {
      const buckets: Map<string, SeriesGroupBucket> =
        seriesBuckets[groupedVariables[index]!]!;
      commonGroupKeys = commonGroupKeys.filter((groupKey: string) => {
        return buckets.has(groupKey);
      });
    }

    if (commonGroupKeys.length === 0) {
      throw new BadDataException(
        `Formula "${trimmedFormula}" references grouped queries that have no series groups in common. Make sure every grouped query used by the formula is grouped by the same attributes.`,
      );
    }

    /*
     * Group keys are canonical "key=value|key2=value2" strings, so a
     * lexicographic sort yields a stable, human-sensible series order.
     */
    commonGroupKeys.sort();

    const resultData: Array<AggregatedModel> = [];

    for (const groupKey of commonGroupKeys) {
      const groupLabels: JSONObject =
        seriesBuckets[groupedVariables[0]!]!.get(groupKey)!.labels;

      const seriesByVariable: Record<string, Array<AggregatedModel>> = {};
      for (const variableName of referencedVariables) {
        const buckets: Map<string, SeriesGroupBucket> =
          seriesBuckets[variableName]!;
        if (
          MetricFormulaEvaluator.isGroupedVariable(
            buckets,
            variableData[variableName]!,
          )
        ) {
          seriesByVariable[variableName] = buckets.get(groupKey)?.samples || [];
        } else {
          // Ungrouped variable: broadcast to every group.
          seriesByVariable[variableName] =
            variableData[variableName]!.result.data;
        }
      }

      resultData.push(
        ...MetricFormulaEvaluator.evaluatePointwise({
          rpn,
          referencedVariables,
          seriesByVariable,
          groupAttributes: groupLabels,
        }),
      );
    }

    return { data: resultData };
  }

  /**
   * Return the set of variables referenced by a formula, preserving the
   * order of first appearance. Variable names are lower-cased to match
   * the evaluator's case-insensitive lookup. Invalid formulas return an
   * empty list rather than throwing, so callers rendering UI don't have
   * to add defensive try/catch.
   */
  public static getReferencedVariables(formula: string): Array<string> {
    const trimmedFormula: string = (formula || "").trim();
    if (!trimmedFormula) {
      return [];
    }
    try {
      const rpn: Array<Token> = MetricFormulaEvaluator.toRpn(trimmedFormula);
      return MetricFormulaEvaluator.collectVariableNames(rpn);
    } catch {
      return [];
    }
  }

  /**
   * Validate a formula's syntax without evaluating it. Returns `null`
   * when valid, otherwise a human-readable error message.
   */
  public static validateFormula(input: {
    formula: string;
    availableVariables: Array<string>;
  }): string | null {
    const trimmedFormula: string = (input.formula || "").trim();
    if (!trimmedFormula) {
      return "Formula is required.";
    }

    let rpn: Array<Token>;
    try {
      rpn = MetricFormulaEvaluator.toRpn(trimmedFormula);
    } catch (err: unknown) {
      return (err as Error).message || "Invalid formula.";
    }

    const referenced: Array<string> =
      MetricFormulaEvaluator.collectVariableNames(rpn);
    const available: Set<string> = new Set<string>(
      input.availableVariables.map((v: string) => {
        return v.toLowerCase();
      }),
    );

    for (const variable of referenced) {
      if (!available.has(variable.toLowerCase())) {
        return `Formula references unknown variable "$${variable}".`;
      }
    }

    return null;
  }

  private static buildVariableResultMap(input: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
    results: Array<AggregatedResult>;
  }): Record<string, VariableSeriesData> {
    const variableMap: Record<string, VariableSeriesData> = {};

    const totalSeries: number =
      input.queryConfigs.length + input.formulaConfigs.length;

    for (let index: number = 0; index < totalSeries; index++) {
      const result: AggregatedResult | undefined = input.results[index];
      if (!result) {
        continue;
      }

      let alias: string | undefined;
      let groupByAttributeKeys: Array<string> = [];

      if (index < input.queryConfigs.length) {
        alias =
          input.queryConfigs[index]?.metricAliasData?.metricVariable ||
          undefined;
        groupByAttributeKeys = (
          input.queryConfigs[index]?.metricQueryData?.groupByAttributeKeys || []
        ).filter((key: string) => {
          return Boolean(key);
        });
      } else {
        const formulaIndex: number = index - input.queryConfigs.length;
        alias =
          input.formulaConfigs[formulaIndex]?.metricAliasData?.metricVariable ||
          undefined;
      }

      if (!alias) {
        continue;
      }

      variableMap[alias.toLowerCase()] = {
        result,
        groupByAttributeKeys,
      };
    }

    return variableMap;
  }

  /**
   * Whether a variable participates in per-group evaluation (joined by
   * group key) rather than broadcasting across every group. True when
   * it factually carries two or more series, OR when its QUERY was
   * grouped (groupByAttributeKeys) and it returned at least one series:
   * a grouped query that collapsed to a single series (e.g. only one
   * host reported the denominator metric in the window) must still be
   * matched group-by-group — broadcasting it would silently compute
   * cross-group math stamped with another group's labels. Formula
   * variables and ungrouped queries carry no grouping config, so they
   * keep the observed >=2 heuristic. A config-grouped variable with an
   * EMPTY result intentionally classifies as ungrouped: it degrades to
   * per-point gaps (empty output) instead of a structural
   * no-groups-in-common error.
   *
   * Only consulted once the grouped path has engaged — the passthrough
   * gate in evaluateFormula deliberately does NOT use this predicate,
   * so single-series inputs (the metric-monitor worker's per-fingerprint
   * shape) stay a byte-identical passthrough.
   */
  private static isGroupedVariable(
    buckets: Map<string, SeriesGroupBucket> | undefined,
    variable: VariableSeriesData,
  ): boolean {
    const bucketCount: number = buckets?.size || 0;
    if (bucketCount >= 2) {
      return true;
    }
    return bucketCount >= 1 && variable.groupByAttributeKeys.length > 0;
  }

  /**
   * Bucket a variable's rows by series group. Query variables group by
   * their configured group-by attribute keys (read from each row's
   * `attributes` map — the shape both the aggregation API and the
   * metric-monitor worker produce). Formula variables (and queries
   * without configured keys) group by whatever scalar `attributes`
   * entries their rows carry — formula outputs are stamped with exactly
   * the group attributes by this evaluator, so this round-trips
   * formula-of-formula references. Rows without attributes fall into a
   * single ungrouped bucket.
   */
  private static bucketSeriesByGroup(
    variable: VariableSeriesData,
  ): Map<string, SeriesGroupBucket> {
    const buckets: Map<string, SeriesGroupBucket> = new Map();

    for (const sample of variable.result.data) {
      const labels: JSONObject = MetricFormulaEvaluator.extractGroupLabels({
        sample,
        groupByAttributeKeys: variable.groupByAttributeKeys,
      });

      const groupKey: string = MetricFormulaEvaluator.computeGroupKey(labels);

      const existing: SeriesGroupBucket | undefined = buckets.get(groupKey);
      if (existing) {
        existing.samples.push(sample);
      } else {
        buckets.set(groupKey, { labels, samples: [sample] });
      }
    }

    return buckets;
  }

  /**
   * Mirror of MetricSeriesFingerprint.extractSeriesLabels semantics
   * (missing keys preserved as "" so groups stay stable when a series
   * occasionally drops an attribute). Not imported from that module
   * because it pulls in node's "crypto", which the browser bundles that
   * ship this evaluator cannot resolve.
   */
  private static extractGroupLabels(input: {
    sample: AggregatedModel;
    groupByAttributeKeys: Array<string>;
  }): JSONObject {
    const labels: JSONObject = {};

    const sampleAttributes: JSONObject =
      ((input.sample as unknown as JSONObject)["attributes"] as
        | JSONObject
        | undefined) || {};

    if (input.groupByAttributeKeys.length > 0) {
      for (const key of input.groupByAttributeKeys) {
        const value: JSONValue | undefined = sampleAttributes[key];
        labels[key] = value === undefined || value === null ? "" : value;
      }
      return labels;
    }

    for (const key of Object.keys(sampleAttributes)) {
      const value: JSONValue | undefined = sampleAttributes[key];
      if (value === undefined || value === null) {
        labels[key] = "";
        continue;
      }
      // Nested objects/arrays can't canonicalize into a stable label.
      if (typeof value === "object") {
        continue;
      }
      labels[key] = value;
    }

    return labels;
  }

  /**
   * Canonical in-memory series key: sorted "key=value" pairs. Same
   * equivalence classes as MetricSeriesFingerprint.computeFingerprint
   * (which hashes this exact string), without the crypto dependency.
   * Empty labels — an ungrouped series — map to "".
   */
  private static computeGroupKey(labels: JSONObject): string {
    const keys: Array<string> = Object.keys(labels).sort();

    if (keys.length === 0) {
      return "";
    }

    const parts: Array<string> = [];
    for (const key of keys) {
      const raw: JSONValue | undefined = labels[key];
      const value: string =
        raw === undefined || raw === null ? "" : String(raw);
      parts.push(`${key}=${value}`);
    }

    return parts.join("|");
  }

  /**
   * Join the given series on timestamp and evaluate the formula per
   * point. Points missing a value for any referenced variable are
   * skipped (a partial join would produce misleading numbers — e.g.
   * treating a gap as zero silently when using subtraction), as are
   * non-finite results like divide-by-zero. Structural formula errors
   * are impossible here: the RPN's arity is validated at parse time.
   */
  private static evaluatePointwise(input: {
    rpn: Array<Token>;
    referencedVariables: Array<string>;
    seriesByVariable: Record<string, Array<AggregatedModel>>;
    groupAttributes?: JSONObject | undefined;
  }): Array<AggregatedModel> {
    const timestampIndex: Map<
      string,
      Record<string, number>
    > = MetricFormulaEvaluator.buildTimestampIndex(
      input.referencedVariables,
      input.seriesByVariable,
    );

    const sortedTimestamps: Array<string> = Array.from(
      timestampIndex.keys(),
    ).sort();

    const resultData: Array<AggregatedModel> = [];

    for (const timestampString of sortedTimestamps) {
      const values: Record<string, number> =
        timestampIndex.get(timestampString) || {};

      const hasAllValues: boolean = input.referencedVariables.every(
        (variable: string) => {
          return typeof values[variable] === "number";
        },
      );

      if (!hasAllValues) {
        continue;
      }

      const evaluated: number = MetricFormulaEvaluator.evaluateRpn(
        input.rpn,
        values,
      );

      if (!Number.isFinite(evaluated)) {
        continue;
      }

      const row: AggregatedModel = {
        timestamp: new Date(timestampString),
        value: evaluated,
      };

      if (
        input.groupAttributes &&
        Object.keys(input.groupAttributes).length > 0
      ) {
        row["attributes"] = input.groupAttributes;
      }

      resultData.push(row);
    }

    return resultData;
  }

  private static buildTimestampIndex(
    variables: Array<string>,
    seriesByVariable: Record<string, Array<AggregatedModel>>,
  ): Map<string, Record<string, number>> {
    const index: Map<string, Record<string, number>> = new Map();

    for (const variable of variables) {
      const series: Array<AggregatedModel> | undefined =
        seriesByVariable[variable];
      if (!series) {
        continue;
      }

      for (const sample of series) {
        const timestampKey: string = MetricFormulaEvaluator.normalizeTimestamp(
          sample.timestamp,
        );

        if (!index.has(timestampKey)) {
          index.set(timestampKey, {});
        }

        const bucket: Record<string, number> = index.get(timestampKey) || {};
        bucket[variable] = sample.value;
      }
    }

    return index;
  }

  private static normalizeTimestamp(timestamp: Date | string): string {
    if (timestamp instanceof Date) {
      return timestamp.toISOString();
    }

    /*
     * ClickHouse sometimes returns timestamps at varying precisions
     * ("2024-01-01T00:00:00" vs "2024-01-01T00:00:00.000Z"). Normalize
     * by parsing through Date so differently formatted strings for the
     * same instant align correctly.
     */
    const asDate: Date = new Date(timestamp);
    if (!isNaN(asDate.getTime())) {
      return asDate.toISOString();
    }
    return String(timestamp);
  }

  private static collectVariableNames(rpn: Array<Token>): Array<string> {
    const seen: Set<string> = new Set<string>();
    const result: Array<string> = [];
    for (const token of rpn) {
      if (token.type === TokenType.Variable) {
        const normalized: string = token.value.toLowerCase();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          result.push(normalized);
        }
      }
    }
    return result;
  }

  private static tokenize(expression: string): Array<Token> {
    const tokens: Array<Token> = [];
    let position: number = 0;

    while (position < expression.length) {
      const char: string = expression[position]!;

      if (char === " " || char === "\t" || char === "\n") {
        position++;
        continue;
      }

      // Number literal (with optional decimal and exponent)
      if (char >= "0" && char <= "9") {
        let numberBuffer: string = "";
        while (
          position < expression.length &&
          MetricFormulaEvaluator.isNumberChar(
            expression[position]!,
            numberBuffer,
          )
        ) {
          numberBuffer += expression[position];
          position++;
        }
        tokens.push({ type: TokenType.Number, value: numberBuffer });
        continue;
      }

      // Decimal starting without leading 0 (e.g. ".5")
      if (
        char === "." &&
        position + 1 < expression.length &&
        expression[position + 1]! >= "0" &&
        expression[position + 1]! <= "9"
      ) {
        let numberBuffer: string = "";
        while (
          position < expression.length &&
          MetricFormulaEvaluator.isNumberChar(
            expression[position]!,
            numberBuffer,
          )
        ) {
          numberBuffer += expression[position];
          position++;
        }
        tokens.push({ type: TokenType.Number, value: numberBuffer });
        continue;
      }

      // Variable — may be prefixed with "$" or bare ("a", "b1", etc.)
      if (char === "$" || MetricFormulaEvaluator.isIdentifierStart(char)) {
        if (char === "$") {
          position++;
        }
        let identifier: string = "";
        while (
          position < expression.length &&
          MetricFormulaEvaluator.isIdentifierPart(expression[position]!)
        ) {
          identifier += expression[position];
          position++;
        }

        if (!identifier) {
          throw new BadDataException(
            `Unexpected character "$" without a variable name.`,
          );
        }

        tokens.push({ type: TokenType.Variable, value: identifier });
        continue;
      }

      if (char === "(") {
        tokens.push({ type: TokenType.LeftParen, value: char });
        position++;
        continue;
      }

      if (char === ")") {
        tokens.push({ type: TokenType.RightParen, value: char });
        position++;
        continue;
      }

      if (
        char === "+" ||
        char === "-" ||
        char === "*" ||
        char === "/" ||
        char === "%" ||
        char === "^"
      ) {
        tokens.push({ type: TokenType.Operator, value: char });
        position++;
        continue;
      }

      throw new BadDataException(
        `Unexpected character "${char}" at position ${position}.`,
      );
    }

    return tokens;
  }

  private static isNumberChar(char: string, currentBuffer: string): boolean {
    if (char >= "0" && char <= "9") {
      return true;
    }
    if (char === "." && !currentBuffer.includes(".")) {
      return true;
    }
    if (
      (char === "e" || char === "E") &&
      !currentBuffer.toLowerCase().includes("e") &&
      currentBuffer.length > 0
    ) {
      return true;
    }
    if (
      (char === "+" || char === "-") &&
      currentBuffer.length > 0 &&
      (currentBuffer[currentBuffer.length - 1] === "e" ||
        currentBuffer[currentBuffer.length - 1] === "E")
    ) {
      return true;
    }
    return false;
  }

  private static isIdentifierStart(char: string): boolean {
    return (
      (char >= "a" && char <= "z") ||
      (char >= "A" && char <= "Z") ||
      char === "_"
    );
  }

  private static isIdentifierPart(char: string): boolean {
    return (
      MetricFormulaEvaluator.isIdentifierStart(char) ||
      (char >= "0" && char <= "9")
    );
  }

  private static toRpn(expression: string): Array<Token> {
    const tokens: Array<Token> = MetricFormulaEvaluator.tokenize(expression);
    const output: Array<Token> = [];
    const operatorStack: Array<Token> = [];

    let previousToken: Token | null = null;

    for (const token of tokens) {
      if (token.type === TokenType.Number) {
        output.push(token);
      } else if (token.type === TokenType.Variable) {
        output.push(token);
      } else if (token.type === TokenType.Operator) {
        let operatorValue: Operator = token.value as Operator;
        const isUnary: boolean =
          (operatorValue === "+" || operatorValue === "-") &&
          (previousToken === null ||
            previousToken.type === TokenType.Operator ||
            previousToken.type === TokenType.LeftParen);

        if (isUnary) {
          operatorValue = operatorValue === "-" ? "u-" : "u+";
        }

        while (operatorStack.length > 0) {
          const top: Token = operatorStack[operatorStack.length - 1]!;
          if (top.type !== TokenType.Operator) {
            break;
          }
          const topPrecedence: number =
            OPERATOR_PRECEDENCE[top.value as Operator];
          const currentPrecedence: number = OPERATOR_PRECEDENCE[operatorValue];
          const isRightAssociative: boolean =
            RIGHT_ASSOCIATIVE.has(operatorValue);

          if (
            topPrecedence > currentPrecedence ||
            (topPrecedence === currentPrecedence && !isRightAssociative)
          ) {
            output.push(operatorStack.pop()!);
          } else {
            break;
          }
        }

        operatorStack.push({ type: TokenType.Operator, value: operatorValue });
      } else if (token.type === TokenType.LeftParen) {
        operatorStack.push(token);
      } else if (token.type === TokenType.RightParen) {
        let foundLeftParen: boolean = false;
        while (operatorStack.length > 0) {
          const top: Token = operatorStack.pop()!;
          if (top.type === TokenType.LeftParen) {
            foundLeftParen = true;
            break;
          }
          output.push(top);
        }
        if (!foundLeftParen) {
          throw new BadDataException("Mismatched parentheses in formula.");
        }
      }

      previousToken = token;
    }

    while (operatorStack.length > 0) {
      const top: Token = operatorStack.pop()!;
      if (
        top.type === TokenType.LeftParen ||
        top.type === TokenType.RightParen
      ) {
        throw new BadDataException("Mismatched parentheses in formula.");
      }
      output.push(top);
    }

    MetricFormulaEvaluator.assertValidRpn(output);

    return output;
  }

  /**
   * Verify operator arity by simulating stack depth over the RPN. This
   * turns malformed expressions like "a**b", "a+" or "()" into
   * descriptive parse-time errors instead of silent per-point failures
   * that render as "no data".
   */
  private static assertValidRpn(rpn: Array<Token>): void {
    let depth: number = 0;

    for (const token of rpn) {
      if (
        token.type === TokenType.Number ||
        token.type === TokenType.Variable
      ) {
        depth++;
        continue;
      }

      if (token.type === TokenType.Operator) {
        const operatorValue: Operator = token.value as Operator;

        if (operatorValue === "u-" || operatorValue === "u+") {
          if (depth < 1) {
            throw new BadDataException(
              `Invalid formula: unary "${operatorValue.charAt(1)}" is missing its operand.`,
            );
          }
          continue;
        }

        if (depth < 2) {
          throw new BadDataException(
            `Invalid formula: operator "${operatorValue}" is missing an operand.`,
          );
        }
        depth--;
      }
    }

    if (depth === 0) {
      throw new BadDataException("Invalid formula: expression is empty.");
    }

    if (depth !== 1) {
      throw new BadDataException(
        "Invalid formula: expression does not reduce to a single value. Did you forget an operator between two values?",
      );
    }
  }

  private static evaluateRpn(
    rpn: Array<Token>,
    variableValues: Record<string, number>,
  ): number {
    const stack: Array<number> = [];

    for (const token of rpn) {
      if (token.type === TokenType.Number) {
        stack.push(parseFloat(token.value));
        continue;
      }

      if (token.type === TokenType.Variable) {
        const variableName: string = token.value.toLowerCase();
        const variableValue: number | undefined = variableValues[variableName];
        if (typeof variableValue !== "number") {
          throw new BadDataException(
            `Missing value for variable "${variableName}".`,
          );
        }
        stack.push(variableValue);
        continue;
      }

      if (token.type === TokenType.Operator) {
        const operatorValue: Operator = token.value as Operator;

        if (operatorValue === "u-" || operatorValue === "u+") {
          const operand: number | undefined = stack.pop();
          if (typeof operand !== "number") {
            throw new BadDataException("Invalid formula: missing operand.");
          }
          stack.push(operatorValue === "u-" ? -operand : operand);
          continue;
        }

        const right: number | undefined = stack.pop();
        const left: number | undefined = stack.pop();

        if (typeof right !== "number" || typeof left !== "number") {
          throw new BadDataException("Invalid formula: missing operands.");
        }

        switch (operatorValue) {
          case "+":
            stack.push(left + right);
            break;
          case "-":
            stack.push(left - right);
            break;
          case "*":
            stack.push(left * right);
            break;
          case "/":
            if (right === 0) {
              stack.push(NaN);
            } else {
              stack.push(left / right);
            }
            break;
          case "%":
            if (right === 0) {
              stack.push(NaN);
            } else {
              stack.push(left % right);
            }
            break;
          case "^":
            stack.push(Math.pow(left, right));
            break;
        }
      }
    }

    if (stack.length !== 1) {
      throw new BadDataException("Invalid formula expression.");
    }

    return stack[0]!;
  }
}
