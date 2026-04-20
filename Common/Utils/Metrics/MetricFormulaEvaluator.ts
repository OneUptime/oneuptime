import BadDataException from "../../Types/Exception/BadDataException";
import AggregatedModel from "../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../Types/BaseDatabase/AggregatedResult";
import MetricFormulaConfigData from "../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../Types/Metrics/MetricQueryConfigData";

/**
 * Shunting-yard based evaluator for metric formulas such as
 * "$A + $B * 2" or "(a - b) / 100". Variables are matched by metric
 * alias (case-insensitive, with or without a leading "$"). Evaluates
 * the formula point-by-point against a time-aligned series from the
 * referenced queries/formulas.
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

export default class MetricFormulaEvaluator {
  /**
   * Evaluate a formula against the provided query/formula results and
   * return a synthetic AggregatedResult whose timestamps are the union
   * of all referenced series.
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

    const rpn: Array<Token> = MetricFormulaEvaluator.toRpn(trimmedFormula);

    const variableResults: Record<string, AggregatedResult> =
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
      if (!variableResults[variableName]) {
        throw new BadDataException(
          `Formula references unknown variable "$${variableName}". Define a metric query with that alias first.`,
        );
      }
    }

    const timestampIndex: Map<string, Record<string, number>> =
      MetricFormulaEvaluator.buildTimestampIndex(
        referencedVariables,
        variableResults,
      );

    const sortedTimestamps: Array<string> = Array.from(
      timestampIndex.keys(),
    ).sort();

    const resultData: Array<AggregatedModel> = [];

    for (const timestampString of sortedTimestamps) {
      const values: Record<string, number> =
        timestampIndex.get(timestampString) || {};

      /*
       * Skip points where any referenced variable is missing a value. A
       * partial join would produce misleading numbers (e.g. treating a
       * gap as zero silently when using subtraction).
       */
      const hasAllValues: boolean = referencedVariables.every(
        (variable: string) => {
          return typeof values[variable] === "number";
        },
      );

      if (!hasAllValues) {
        continue;
      }

      let evaluated: number;
      try {
        evaluated = MetricFormulaEvaluator.evaluateRpn(rpn, values);
      } catch {
        continue;
      }

      if (!Number.isFinite(evaluated)) {
        continue;
      }

      resultData.push({
        timestamp: new Date(timestampString),
        value: evaluated,
      });
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
  }): Record<string, AggregatedResult> {
    const variableMap: Record<string, AggregatedResult> = {};

    const totalSeries: number =
      input.queryConfigs.length + input.formulaConfigs.length;

    for (let index: number = 0; index < totalSeries; index++) {
      const result: AggregatedResult | undefined = input.results[index];
      if (!result) {
        continue;
      }

      let alias: string | undefined;
      if (index < input.queryConfigs.length) {
        alias =
          input.queryConfigs[index]?.metricAliasData?.metricVariable ||
          undefined;
      } else {
        const formulaIndex: number = index - input.queryConfigs.length;
        alias =
          input.formulaConfigs[formulaIndex]?.metricAliasData?.metricVariable ||
          undefined;
      }

      if (!alias) {
        continue;
      }

      variableMap[alias.toLowerCase()] = result;
    }

    return variableMap;
  }

  private static buildTimestampIndex(
    variables: Array<string>,
    variableResults: Record<string, AggregatedResult>,
  ): Map<string, Record<string, number>> {
    const index: Map<string, Record<string, number>> = new Map();

    for (const variable of variables) {
      const series: AggregatedResult | undefined = variableResults[variable];
      if (!series) {
        continue;
      }

      for (const sample of series.data) {
        const timestampKey: string =
          MetricFormulaEvaluator.normalizeTimestamp(sample.timestamp);

        if (!index.has(timestampKey)) {
          index.set(timestampKey, {});
        }

        const bucket: Record<string, number> =
          index.get(timestampKey) || {};
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
          MetricFormulaEvaluator.isNumberChar(expression[position]!, numberBuffer)
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
          MetricFormulaEvaluator.isNumberChar(expression[position]!, numberBuffer)
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
      if (top.type === TokenType.LeftParen || top.type === TokenType.RightParen) {
        throw new BadDataException("Mismatched parentheses in formula.");
      }
      output.push(top);
    }

    return output;
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
