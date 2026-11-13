import {
  PROMQL_METRIC_NAME_LABEL,
  PROMQL_VALUE_TYPE_WITH_ARTICLE,
  PromQLAggregate,
  PromQLAggregateOperator,
  PromQLAtModifier,
  PromQLBinary,
  PromQLBinaryOperator,
  PromQLCall,
  PromQLExpression,
  PromQLLabelMatcher,
  PromQLMatchType,
  PromQLMatrixSelector,
  PromQLNodeKind,
  PromQLPosition,
  PromQLSubquery,
  PromQLValueType,
  PromQLVectorMatchCardinality,
  PromQLVectorMatching,
  PromQLVectorSelector,
  isComparisonOperator,
  isSetOperator,
} from "./PromQLAst";
import { parsePromQLDuration } from "./PromQLDuration";
import PromQLError from "./PromQLError";
import {
  PROMQL_NATIVE_HISTOGRAM_FUNCTIONS,
  PromQLFunctionSignature,
  getPromQLFunction,
} from "./PromQLFunctions";
import { PromQLToken, PromQLTokenType, tokenizePromQL } from "./PromQLLexer";
import { compilePromQLRegex } from "./PromQLRegex";
import { describePatternProblem } from "../LinearRegExp/PatternCache";

/*
 * Parses a PromQL query into a checked syntax tree (promql/parser).
 *
 * A precedence-climbing parser over PromQLLexer's tokens. It checks what
 * Prometheus' parser checks (argument types, `bool` on scalar comparisons,
 * vector matching only between vectors, a selector that selects something),
 * so a query OneUptime accepts is one Prometheus accepts, and the engine can
 * trust the tree it is handed.
 */

const AGGREGATE_OPERATORS: ReadonlyMap<string, PromQLAggregateOperator> =
  new Map<string, PromQLAggregateOperator>(
    Object.values(PromQLAggregateOperator).map(
      (
        operator: PromQLAggregateOperator,
      ): [string, PromQLAggregateOperator] => {
        return [operator, operator];
      },
    ),
  );

const AGGREGATES_WITH_PARAMETER: ReadonlySet<PromQLAggregateOperator> =
  new Set<PromQLAggregateOperator>([
    PromQLAggregateOperator.Topk,
    PromQLAggregateOperator.Bottomk,
    PromQLAggregateOperator.Quantile,
    PromQLAggregateOperator.CountValues,
  ]);

const KEYWORD_BINARY_OPERATORS: Record<string, PromQLBinaryOperator> = {
  and: PromQLBinaryOperator.And,
  or: PromQLBinaryOperator.Or,
  unless: PromQLBinaryOperator.Unless,
  atan2: PromQLBinaryOperator.Atan2,
};

const SYMBOL_BINARY_OPERATORS: ReadonlyMap<
  PromQLTokenType,
  PromQLBinaryOperator
> = new Map<PromQLTokenType, PromQLBinaryOperator>([
  [PromQLTokenType.Add, PromQLBinaryOperator.Add],
  [PromQLTokenType.Sub, PromQLBinaryOperator.Sub],
  [PromQLTokenType.Mul, PromQLBinaryOperator.Mul],
  [PromQLTokenType.Div, PromQLBinaryOperator.Div],
  [PromQLTokenType.Mod, PromQLBinaryOperator.Mod],
  [PromQLTokenType.Pow, PromQLBinaryOperator.Pow],
  [PromQLTokenType.Eql, PromQLBinaryOperator.Eql],
  [PromQLTokenType.Neq, PromQLBinaryOperator.Neq],
  [PromQLTokenType.Gtr, PromQLBinaryOperator.Gtr],
  [PromQLTokenType.Lss, PromQLBinaryOperator.Lss],
  [PromQLTokenType.Gte, PromQLBinaryOperator.Gte],
  [PromQLTokenType.Lte, PromQLBinaryOperator.Lte],
]);

// Lowest first, as Prometheus binds them.
const PRECEDENCE: Record<PromQLBinaryOperator, number> = {
  [PromQLBinaryOperator.Or]: 1,
  [PromQLBinaryOperator.And]: 2,
  [PromQLBinaryOperator.Unless]: 2,
  [PromQLBinaryOperator.Eql]: 3,
  [PromQLBinaryOperator.Neq]: 3,
  [PromQLBinaryOperator.Gtr]: 3,
  [PromQLBinaryOperator.Lss]: 3,
  [PromQLBinaryOperator.Gte]: 3,
  [PromQLBinaryOperator.Lte]: 3,
  [PromQLBinaryOperator.Add]: 4,
  [PromQLBinaryOperator.Sub]: 4,
  [PromQLBinaryOperator.Mul]: 5,
  [PromQLBinaryOperator.Div]: 5,
  [PromQLBinaryOperator.Mod]: 5,
  [PromQLBinaryOperator.Atan2]: 5,
  [PromQLBinaryOperator.Pow]: 6,
};

/*
 * A unary minus binds like `*`: `-a * b` is `(-a) * b`, but `-2 ^ 2` is
 * `-(2 ^ 2)`, so its operand takes only what binds tighter than `*`.
 */
const UNARY_OPERAND_PRECEDENCE: number = PRECEDENCE[PromQLBinaryOperator.Pow];

const MATCH_TYPES: ReadonlyMap<PromQLTokenType, PromQLMatchType> = new Map<
  PromQLTokenType,
  PromQLMatchType
>([
  [PromQLTokenType.Assign, PromQLMatchType.Equal],
  [PromQLTokenType.Neq, PromQLMatchType.NotEqual],
  [PromQLTokenType.RegexMatch, PromQLMatchType.RegexMatch],
  [PromQLTokenType.RegexNoMatch, PromQLMatchType.RegexNoMatch],
]);

const describeToken: (token: PromQLToken) => string = (
  token: PromQLToken,
): string => {
  switch (token.type) {
    case PromQLTokenType.EOF:
      return "the end of the query";
    case PromQLTokenType.String:
      return `the string "${token.text}"`;
    case PromQLTokenType.Number:
      return `the number ${token.text}`;
    case PromQLTokenType.Duration:
      return `the duration ${token.text}`;
    case PromQLTokenType.Identifier:
    case PromQLTokenType.MetricIdentifier:
      return `"${token.text}"`;
    default:
      return `"${token.text}"`;
  }
};

const parseNumberText: (text: string) => number = (text: string): number => {
  if (text.startsWith("0x") || text.startsWith("0X")) {
    return parseInt(text.slice(2), 16);
  }

  return Number(text);
};

export const getPromQLValueType: (
  expression: PromQLExpression,
) => PromQLValueType = (expression: PromQLExpression): PromQLValueType => {
  switch (expression.kind) {
    case PromQLNodeKind.NumberLiteral:
      return PromQLValueType.Scalar;
    case PromQLNodeKind.StringLiteral:
      return PromQLValueType.String;
    case PromQLNodeKind.VectorSelector:
      return PromQLValueType.InstantVector;
    case PromQLNodeKind.MatrixSelector:
    case PromQLNodeKind.Subquery:
      return PromQLValueType.RangeVector;
    case PromQLNodeKind.Call:
      return getPromQLFunction(expression.functionName)!.returnType;
    case PromQLNodeKind.Aggregate:
      return PromQLValueType.InstantVector;
    case PromQLNodeKind.Binary:
      return getPromQLValueType(expression.lhs) === PromQLValueType.Scalar &&
        getPromQLValueType(expression.rhs) === PromQLValueType.Scalar
        ? PromQLValueType.Scalar
        : PromQLValueType.InstantVector;
    case PromQLNodeKind.Unary:
    case PromQLNodeKind.Paren:
      return getPromQLValueType(expression.expression);
  }
};

class PromQLParser {
  private readonly tokens: Array<PromQLToken>;
  private index: number = 0;
  // Selectors and subqueries whose offset or `@` the query has written.
  private readonly offsetWritten: WeakSet<PromQLExpression> = new WeakSet();
  private readonly atWritten: WeakSet<PromQLExpression> = new WeakSet();

  public constructor(query: string) {
    this.tokens = tokenizePromQL(query);
  }

  public parse(): PromQLExpression {
    if (this.peek().type === PromQLTokenType.EOF) {
      throw new PromQLError(
        "The query is empty. Write a PromQL expression, such as up or rate(http_requests_total[5m]).",
      );
    }

    const expression: PromQLExpression = this.parseExpression(0);
    const next: PromQLToken = this.peek();

    if (next.type !== PromQLTokenType.EOF) {
      throw this.unexpected(next, "an operator or the end of the query");
    }

    return expression;
  }

  private peek(offset: number = 0): PromQLToken {
    return (
      this.tokens[this.index + offset] || this.tokens[this.tokens.length - 1]!
    );
  }

  private next(): PromQLToken {
    const token: PromQLToken = this.peek();

    if (token.type !== PromQLTokenType.EOF) {
      this.index++;
    }

    return token;
  }

  private expect(type: PromQLTokenType, what: string): PromQLToken {
    const token: PromQLToken = this.peek();

    if (token.type !== type) {
      throw this.unexpected(token, what);
    }

    return this.next();
  }

  private unexpected(token: PromQLToken, expected: string): PromQLError {
    return new PromQLError(
      `Unexpected ${describeToken(token)} at position ${token.start + 1}: expected ${expected}.`,
      undefined,
      { start: token.start, end: Math.max(token.end, token.start + 1) },
    );
  }

  private isKeyword(token: PromQLToken, keyword: string): boolean {
    return (
      token.type === PromQLTokenType.Identifier &&
      token.text.toLowerCase() === keyword
    );
  }

  private peekBinaryOperator(): PromQLBinaryOperator | undefined {
    const token: PromQLToken = this.peek();

    if (token.type === PromQLTokenType.Identifier) {
      return KEYWORD_BINARY_OPERATORS[token.text.toLowerCase()];
    }

    return SYMBOL_BINARY_OPERATORS.get(token.type);
  }

  private parseExpression(minimumPrecedence: number): PromQLExpression {
    let lhs: PromQLExpression = this.parseUnaryOrPostfix();

    for (;;) {
      const operator: PromQLBinaryOperator | undefined =
        this.peekBinaryOperator();

      if (!operator || PRECEDENCE[operator] < minimumPrecedence) {
        return lhs;
      }

      const operatorToken: PromQLToken = this.next();
      const modifiers: {
        returnBool: boolean;
        matching: PromQLVectorMatching;
      } = this.parseBinaryModifiers();

      // `^` is right-associative: 2 ^ 3 ^ 2 is 2 ^ (3 ^ 2).
      const rhs: PromQLExpression = this.parseExpression(
        operator === PromQLBinaryOperator.Pow
          ? PRECEDENCE[operator]
          : PRECEDENCE[operator] + 1,
      );

      lhs = this.buildBinary({
        operator,
        operatorToken,
        lhs,
        rhs,
        returnBool: modifiers.returnBool,
        matching: modifiers.matching,
      });
    }
  }

  private parseBinaryModifiers(): {
    returnBool: boolean;
    matching: PromQLVectorMatching;
  } {
    let returnBool: boolean = false;

    if (this.isKeyword(this.peek(), "bool")) {
      this.next();
      returnBool = true;
    }

    const matching: PromQLVectorMatching = {
      cardinality: PromQLVectorMatchCardinality.OneToOne,
      on: false,
      matchingLabels: [],
      include: [],
    };
    const token: PromQLToken = this.peek();

    if (this.isKeyword(token, "on") || this.isKeyword(token, "ignoring")) {
      this.next();
      matching.on = token.text.toLowerCase() === "on";
      matching.matchingLabels = this.parseLabelList();

      const group: PromQLToken = this.peek();

      if (
        this.isKeyword(group, "group_left") ||
        this.isKeyword(group, "group_right")
      ) {
        this.next();
        matching.cardinality =
          group.text.toLowerCase() === "group_left"
            ? PromQLVectorMatchCardinality.ManyToOne
            : PromQLVectorMatchCardinality.OneToMany;

        if (this.peek().type === PromQLTokenType.LeftParen) {
          matching.include = this.parseLabelList();
        }
      }
    }

    return { returnBool, matching };
  }

  private buildBinary(data: {
    operator: PromQLBinaryOperator;
    operatorToken: PromQLToken;
    lhs: PromQLExpression;
    rhs: PromQLExpression;
    returnBool: boolean;
    matching: PromQLVectorMatching;
  }): PromQLBinary {
    const { operator, operatorToken, lhs, rhs, returnBool, matching } = data;
    const operatorPosition: PromQLPosition = {
      start: operatorToken.start,
      end: operatorToken.end,
    };
    const lhsType: PromQLValueType = getPromQLValueType(lhs);
    const rhsType: PromQLValueType = getPromQLValueType(rhs);

    if (returnBool && !isComparisonOperator(operator)) {
      throw new PromQLError(
        `The bool modifier only goes after a comparison (==, !=, >, <, >= or <=), not after "${operator}".`,
        undefined,
        operatorPosition,
      );
    }

    if (
      isComparisonOperator(operator) &&
      !returnBool &&
      lhsType === PromQLValueType.Scalar &&
      rhsType === PromQLValueType.Scalar
    ) {
      throw new PromQLError(
        `A comparison between two numbers needs the bool modifier: write "${operator} bool".`,
        undefined,
        operatorPosition,
      );
    }

    if (
      isSetOperator(operator) &&
      matching.cardinality === PromQLVectorMatchCardinality.OneToOne
    ) {
      matching.cardinality = PromQLVectorMatchCardinality.ManyToMany;
    }

    if (matching.on) {
      for (const label of matching.matchingLabels) {
        if (matching.include.includes(label)) {
          throw new PromQLError(
            `The label "${label}" is in both on(...) and group_left/group_right(...). List it in one of them.`,
            undefined,
            operatorPosition,
          );
        }
      }
    }

    for (const [side, type] of [
      [lhs, lhsType],
      [rhs, rhsType],
    ] as Array<[PromQLExpression, PromQLValueType]>) {
      if (
        type !== PromQLValueType.Scalar &&
        type !== PromQLValueType.InstantVector
      ) {
        throw new PromQLError(
          `"${operator}" works on numbers and instant vectors, not on ${PROMQL_VALUE_TYPE_WITH_ARTICLE[type]}.`,
          undefined,
          side.position,
        );
      }
    }

    let finalMatching: PromQLVectorMatching | undefined = matching;

    if (
      lhsType !== PromQLValueType.InstantVector ||
      rhsType !== PromQLValueType.InstantVector
    ) {
      if (matching.matchingLabels.length > 0) {
        throw new PromQLError(
          "Vector matching (on or ignoring) only works between two instant vectors.",
          undefined,
          operatorPosition,
        );
      }

      finalMatching = undefined;
    } else if (isSetOperator(operator)) {
      if (
        matching.cardinality === PromQLVectorMatchCardinality.OneToMany ||
        matching.cardinality === PromQLVectorMatchCardinality.ManyToOne
      ) {
        throw new PromQLError(
          `"${operator}" takes no group_left or group_right.`,
          undefined,
          operatorPosition,
        );
      }
    }

    if (
      (lhsType === PromQLValueType.Scalar ||
        rhsType === PromQLValueType.Scalar) &&
      isSetOperator(operator)
    ) {
      throw new PromQLError(
        `"${operator}" works between two instant vectors, not with a number.`,
        undefined,
        operatorPosition,
      );
    }

    return {
      kind: PromQLNodeKind.Binary,
      operator,
      lhs,
      rhs,
      returnBool,
      matching: finalMatching,
      position: { start: lhs.position.start, end: rhs.position.end },
    };
  }

  private parseUnaryOrPostfix(): PromQLExpression {
    const token: PromQLToken = this.peek();

    if (
      token.type === PromQLTokenType.Add ||
      token.type === PromQLTokenType.Sub
    ) {
      this.next();
      const operand: PromQLExpression = this.parseExpression(
        UNARY_OPERAND_PRECEDENCE,
      );
      const position: PromQLPosition = {
        start: token.start,
        end: operand.position.end,
      };

      // `-1` is the number -1, as in Prometheus.
      if (operand.kind === PromQLNodeKind.NumberLiteral) {
        return {
          ...operand,
          value:
            token.type === PromQLTokenType.Sub ? -operand.value : operand.value,
          position,
        };
      }

      const operandType: PromQLValueType = getPromQLValueType(operand);

      if (
        operandType !== PromQLValueType.Scalar &&
        operandType !== PromQLValueType.InstantVector
      ) {
        throw new PromQLError(
          `A unary "${token.text}" works on a number or an instant vector, not on ${PROMQL_VALUE_TYPE_WITH_ARTICLE[operandType]}.`,
          undefined,
          position,
        );
      }

      return {
        kind: PromQLNodeKind.Unary,
        operator:
          token.type === PromQLTokenType.Sub
            ? PromQLBinaryOperator.Sub
            : PromQLBinaryOperator.Add,
        expression: operand,
        position,
      };
    }

    return this.parsePostfix(this.parsePrimary());
  }

  private parsePrimary(): PromQLExpression {
    const token: PromQLToken = this.peek();

    switch (token.type) {
      case PromQLTokenType.Number: {
        this.next();
        return {
          kind: PromQLNodeKind.NumberLiteral,
          value: parseNumberText(token.text),
          position: { start: token.start, end: token.end },
        };
      }
      case PromQLTokenType.String: {
        this.next();
        return {
          kind: PromQLNodeKind.StringLiteral,
          value: token.text,
          position: { start: token.start, end: token.end },
        };
      }
      case PromQLTokenType.LeftParen: {
        this.next();
        const inner: PromQLExpression = this.parseExpression(0);
        const close: PromQLToken = this.expect(
          PromQLTokenType.RightParen,
          '")"',
        );
        return {
          kind: PromQLNodeKind.Paren,
          expression: inner,
          position: { start: token.start, end: close.end },
        };
      }
      case PromQLTokenType.LeftBrace:
        return this.parseVectorSelector(undefined, token.start);
      case PromQLTokenType.Identifier:
      case PromQLTokenType.MetricIdentifier:
        return this.parseIdentifierExpression();
      default:
        throw this.unexpected(
          token,
          "a metric name, a function, a number or an opening bracket",
        );
    }
  }

  private parseIdentifierExpression(): PromQLExpression {
    const token: PromQLToken = this.next();
    const lower: string = token.text.toLowerCase();
    const following: PromQLToken = this.peek();

    if (token.type === PromQLTokenType.Identifier) {
      const aggregate: PromQLAggregateOperator | undefined =
        AGGREGATE_OPERATORS.get(lower);

      if (
        aggregate &&
        (following.type === PromQLTokenType.LeftParen ||
          this.isKeyword(following, "by") ||
          this.isKeyword(following, "without"))
      ) {
        return this.parseAggregate(aggregate, token);
      }

      if (following.type === PromQLTokenType.LeftParen) {
        return this.parseCall(token);
      }

      if (lower === "inf" || lower === "nan") {
        return {
          kind: PromQLNodeKind.NumberLiteral,
          value: lower === "inf" ? Infinity : NaN,
          position: { start: token.start, end: token.end },
        };
      }
    }

    return this.parseVectorSelector(token.text, token.start);
  }

  private parseVectorSelector(
    name: string | undefined,
    start: number,
  ): PromQLVectorSelector {
    let metricName: string | undefined = name;
    const matchers: Array<PromQLLabelMatcher> = [];
    let end: number = this.tokens[this.index - 1]?.end ?? start;

    if (this.peek().type === PromQLTokenType.LeftBrace) {
      this.next();

      while (this.peek().type !== PromQLTokenType.RightBrace) {
        const labelToken: PromQLToken = this.next();
        let labelName: string;

        if (labelToken.type === PromQLTokenType.String) {
          // `{"http.server.duration"}`: a quoted metric name, Prometheus 3.
          if (!MATCH_TYPES.has(this.peek().type)) {
            if (metricName !== undefined) {
              throw new PromQLError(
                `The metric name is written twice: "${metricName}" and "${labelToken.text}". Keep one.`,
                undefined,
                { start, end: labelToken.end },
              );
            }

            metricName = labelToken.text;
            this.finishMatcherListItem();
            continue;
          }

          labelName = labelToken.text;
        } else if (labelToken.type === PromQLTokenType.Identifier) {
          labelName = labelToken.text;
        } else {
          throw this.unexpected(labelToken, "a label name");
        }

        const operatorToken: PromQLToken = this.next();
        const matchType: PromQLMatchType | undefined = MATCH_TYPES.get(
          operatorToken.type,
        );

        if (!matchType) {
          throw this.unexpected(operatorToken, '"=", "!=", "=~" or "!~"');
        }

        const valueToken: PromQLToken = this.next();

        if (valueToken.type !== PromQLTokenType.String) {
          throw this.unexpected(
            valueToken,
            `a quoted value for the label "${labelName}"`,
          );
        }

        if (
          matchType === PromQLMatchType.RegexMatch ||
          matchType === PromQLMatchType.RegexNoMatch
        ) {
          try {
            compilePromQLRegex(valueToken.text);
          } catch (error: unknown) {
            // Why a regular expression cannot run here, or null.
            const problem: string | null = describePatternProblem(error);

            throw new PromQLError(
              problem === null
                ? `"${valueToken.text}" is not a regular expression the label "${labelName}" can be matched with.`
                : `The pattern "${valueToken.text}" for the label "${labelName}" ${problem}`,
              undefined,
              { start: valueToken.start, end: valueToken.end },
            );
          }
        }

        if (labelName === PROMQL_METRIC_NAME_LABEL && name !== undefined) {
          throw new PromQLError(
            `The metric name is written twice: "${name}" and "${valueToken.text}". Keep one.`,
            undefined,
            { start, end: valueToken.end },
          );
        }

        matchers.push({
          name: labelName,
          type: matchType,
          value: valueToken.text,
        });

        this.finishMatcherListItem();
      }

      end = this.next().end;
    }

    if (metricName !== undefined) {
      matchers.unshift({
        name: PROMQL_METRIC_NAME_LABEL,
        type: PromQLMatchType.Equal,
        value: metricName,
      });
    }

    const position: PromQLPosition = { start, end };

    // `{job=""}` would select every series of every metric.
    const selectsSomething: boolean = matchers.some(
      (matcher: PromQLLabelMatcher): boolean => {
        return !matchesEmptyValue(matcher);
      },
    );

    if (!selectsSomething) {
      throw new PromQLError(
        'A selector needs a metric name or a label matcher that does not match an empty value, such as {job="api"}.',
        undefined,
        position,
      );
    }

    return {
      kind: PromQLNodeKind.VectorSelector,
      name: metricName,
      matchers,
      offsetMs: 0,
      at: undefined,
      position,
    };
  }

  // After a matcher: a comma (a trailing one is fine) or the closing brace.
  private finishMatcherListItem(): void {
    const token: PromQLToken = this.peek();

    if (token.type === PromQLTokenType.Comma) {
      this.next();
      return;
    }

    if (token.type !== PromQLTokenType.RightBrace) {
      throw this.unexpected(token, '"," or "}"');
    }
  }

  private parseLabelList(): Array<string> {
    this.expect(PromQLTokenType.LeftParen, '"("');
    const labels: Array<string> = [];

    while (this.peek().type !== PromQLTokenType.RightParen) {
      const token: PromQLToken = this.next();

      if (
        token.type !== PromQLTokenType.Identifier &&
        token.type !== PromQLTokenType.String
      ) {
        throw this.unexpected(token, "a label name");
      }

      labels.push(token.text);

      if (this.peek().type === PromQLTokenType.Comma) {
        this.next();
        continue;
      }

      if (this.peek().type !== PromQLTokenType.RightParen) {
        throw this.unexpected(this.peek(), '"," or ")"');
      }
    }

    this.next();
    return labels;
  }

  private parseArguments(): { args: Array<PromQLExpression>; end: number } {
    this.expect(PromQLTokenType.LeftParen, '"("');
    const args: Array<PromQLExpression> = [];

    while (this.peek().type !== PromQLTokenType.RightParen) {
      args.push(this.parseExpression(0));

      if (this.peek().type === PromQLTokenType.Comma) {
        this.next();
        continue;
      }

      if (this.peek().type !== PromQLTokenType.RightParen) {
        throw this.unexpected(this.peek(), '"," or ")"');
      }
    }

    return { args, end: this.next().end };
  }

  private parseAggregate(
    operator: PromQLAggregateOperator,
    operatorToken: PromQLToken,
  ): PromQLAggregate {
    let grouping: Array<string> = [];
    let without: boolean = false;
    let groupingWritten: boolean = false;

    const readGrouping: () => void = (): void => {
      const token: PromQLToken = this.peek();

      if (this.isKeyword(token, "by") || this.isKeyword(token, "without")) {
        this.next();
        without = token.text.toLowerCase() === "without";
        grouping = this.parseLabelList();
        groupingWritten = true;
      }
    };

    readGrouping();
    const { args, end } = this.parseArguments();
    let finalEnd: number = end;

    if (!groupingWritten) {
      readGrouping();

      if (groupingWritten) {
        finalEnd = this.tokens[this.index - 1]!.end;
      }
    }

    const position: PromQLPosition = {
      start: operatorToken.start,
      end: finalEnd,
    };
    const expectedArguments: number = AGGREGATES_WITH_PARAMETER.has(operator)
      ? 2
      : 1;

    if (args.length !== expectedArguments) {
      throw new PromQLError(
        `${operator}(...) takes ${expectedArguments} argument${expectedArguments === 1 ? "" : "s"}, but the query gives it ${args.length}.`,
        undefined,
        position,
      );
    }

    const expression: PromQLExpression = args[expectedArguments - 1]!;
    const parameter: PromQLExpression | undefined =
      expectedArguments === 2 ? args[0] : undefined;

    this.expectType(
      expression,
      PromQLValueType.InstantVector,
      `the expression in ${operator}(...)`,
    );

    if (parameter) {
      this.expectType(
        parameter,
        operator === PromQLAggregateOperator.CountValues
          ? PromQLValueType.String
          : PromQLValueType.Scalar,
        `the first argument of ${operator}(...)`,
      );
    }

    return {
      kind: PromQLNodeKind.Aggregate,
      operator,
      expression,
      parameter,
      grouping,
      without,
      position,
    };
  }

  private parseCall(nameToken: PromQLToken): PromQLCall {
    const functionName: string = nameToken.text;

    if (PROMQL_NATIVE_HISTOGRAM_FUNCTIONS.has(functionName)) {
      throw new PromQLError(
        `${functionName}() reads Prometheus native histograms, which OneUptime does not store. Read the histogram's _count, _sum and _bucket series instead, for example with histogram_quantile().`,
        undefined,
        { start: nameToken.start, end: nameToken.end },
      );
    }

    const signature: PromQLFunctionSignature | undefined =
      getPromQLFunction(functionName);

    if (!signature) {
      throw new PromQLError(
        `Unknown function "${functionName}". The docs list every function OneUptime evaluates.`,
        undefined,
        { start: nameToken.start, end: nameToken.end },
      );
    }

    const { args, end } = this.parseArguments();
    const position: PromQLPosition = { start: nameToken.start, end };
    const fixed: number = signature.argTypes.length;

    if (signature.variadic === 0 && args.length !== fixed) {
      throw new PromQLError(
        `${functionName}() takes ${fixed} argument${fixed === 1 ? "" : "s"}, but the query gives it ${args.length}.`,
        undefined,
        position,
      );
    }

    if (signature.variadic !== 0) {
      const minimum: number = fixed - 1;

      if (args.length < minimum) {
        throw new PromQLError(
          `${functionName}() takes at least ${minimum} argument${minimum === 1 ? "" : "s"}, but the query gives it ${args.length}.`,
          undefined,
          position,
        );
      }

      const maximum: number = minimum + signature.variadic;

      if (signature.variadic > 0 && args.length > maximum) {
        throw new PromQLError(
          `${functionName}() takes at most ${maximum} argument${maximum === 1 ? "" : "s"}, but the query gives it ${args.length}.`,
          undefined,
          position,
        );
      }
    }

    args.forEach((arg: PromQLExpression, argIndex: number): void => {
      const typeIndex: number = Math.min(argIndex, fixed - 1);
      this.expectType(
        arg,
        signature.argTypes[typeIndex]!,
        `argument ${argIndex + 1} of ${functionName}()`,
      );
    });

    return {
      kind: PromQLNodeKind.Call,
      functionName,
      args,
      position,
    };
  }

  private expectType(
    expression: PromQLExpression,
    expected: PromQLValueType,
    context: string,
  ): void {
    const actual: PromQLValueType = getPromQLValueType(expression);

    if (actual === expected) {
      return;
    }

    let hint: string = "";

    if (
      expected === PromQLValueType.RangeVector &&
      expression.kind === PromQLNodeKind.VectorSelector
    ) {
      hint = " Add a range, such as [5m], after the selector.";
    }

    throw new PromQLError(
      `${capitalize(context)} must be ${PROMQL_VALUE_TYPE_WITH_ARTICLE[expected]}, but it is ${PROMQL_VALUE_TYPE_WITH_ARTICLE[actual]}.${hint}`,
      undefined,
      expression.position,
    );
  }

  private parsePostfix(primary: PromQLExpression): PromQLExpression {
    let expression: PromQLExpression = primary;

    for (;;) {
      const token: PromQLToken = this.peek();

      if (token.type === PromQLTokenType.LeftBracket) {
        expression = this.parseRangeOrSubquery(expression);
        continue;
      }

      if (this.isKeyword(token, "offset")) {
        expression = this.parseOffset(expression);
        continue;
      }

      if (token.type === PromQLTokenType.At) {
        expression = this.parseAt(expression);
        continue;
      }

      return expression;
    }
  }

  private parseDurationValue(what: string, allowZero: boolean): number {
    const token: PromQLToken = this.next();
    let milliseconds: number | undefined = undefined;

    if (token.type === PromQLTokenType.Duration) {
      milliseconds = parsePromQLDuration(token.text);
    } else if (token.type === PromQLTokenType.Number) {
      // A bare number is seconds, as Prometheus 3 reads it.
      const seconds: number = parseNumberText(token.text);
      milliseconds = Number.isFinite(seconds)
        ? Math.round(seconds * 1000)
        : undefined;
    } else {
      throw this.unexpected(token, `a duration for the ${what}, such as 5m`);
    }

    if (milliseconds === undefined) {
      throw new PromQLError(
        `"${token.text}" is not a duration. Write the ${what} as 30s, 5m, 1h or 1h30m.`,
        undefined,
        { start: token.start, end: token.end },
      );
    }

    if (!allowZero && milliseconds <= 0) {
      throw new PromQLError(
        `The ${what} must be longer than zero.`,
        undefined,
        { start: token.start, end: token.end },
      );
    }

    return milliseconds;
  }

  private parseRangeOrSubquery(expression: PromQLExpression): PromQLExpression {
    const open: PromQLToken = this.next();
    const rangeMs: number = this.parseDurationValue("range", false);

    if (this.peek().type === PromQLTokenType.Colon) {
      this.next();
      let stepMs: number | undefined = undefined;

      if (this.peek().type !== PromQLTokenType.RightBracket) {
        stepMs = this.parseDurationValue("subquery step", false);
      }

      const close: PromQLToken = this.expect(
        PromQLTokenType.RightBracket,
        '"]"',
      );
      const subquery: PromQLSubquery = {
        kind: PromQLNodeKind.Subquery,
        expression,
        rangeMs,
        stepMs,
        offsetMs: 0,
        at: undefined,
        position: { start: expression.position.start, end: close.end },
      };

      const innerType: PromQLValueType = getPromQLValueType(expression);

      if (innerType !== PromQLValueType.InstantVector) {
        throw new PromQLError(
          `A subquery ([range:step]) needs an instant vector before it, not ${PROMQL_VALUE_TYPE_WITH_ARTICLE[innerType]}.`,
          undefined,
          subquery.position,
        );
      }

      return subquery;
    }

    const close: PromQLToken = this.expect(PromQLTokenType.RightBracket, '"]"');
    const position: PromQLPosition = {
      start: expression.position.start,
      end: close.end,
    };

    if (expression.kind !== PromQLNodeKind.VectorSelector) {
      throw new PromQLError(
        `A range such as [5m] only goes after a selector, such as http_requests_total[5m]. To range over an expression, write a subquery: (...)[5m:1m].`,
        undefined,
        { start: open.start, end: close.end },
      );
    }

    if (this.offsetWritten.has(expression)) {
      throw new PromQLError(
        "Write the offset after the range: up[5m] offset 1h, not up offset 1h[5m].",
        undefined,
        position,
      );
    }

    if (this.atWritten.has(expression)) {
      throw new PromQLError(
        "Write @ after the range: up[5m] @ 1700000000, not up @ 1700000000[5m].",
        undefined,
        position,
      );
    }

    const matrix: PromQLMatrixSelector = {
      kind: PromQLNodeKind.MatrixSelector,
      vectorSelector: expression,
      rangeMs,
      position,
    };

    return matrix;
  }

  /*
   * The node an offset or `@` written after `expression` belongs to, or
   * undefined when nothing there can take one.
   */
  private modifierTarget(
    expression: PromQLExpression,
  ): PromQLVectorSelector | PromQLSubquery | undefined {
    if (expression.kind === PromQLNodeKind.VectorSelector) {
      return expression;
    }

    if (expression.kind === PromQLNodeKind.MatrixSelector) {
      return expression.vectorSelector;
    }

    if (expression.kind === PromQLNodeKind.Subquery) {
      return expression;
    }

    return undefined;
  }

  private parseOffset(expression: PromQLExpression): PromQLExpression {
    const keyword: PromQLToken = this.next();
    let sign: number = 1;

    if (this.peek().type === PromQLTokenType.Sub) {
      this.next();
      sign = -1;
    } else if (this.peek().type === PromQLTokenType.Add) {
      this.next();
    }

    const offsetMs: number = sign * this.parseDurationValue("offset", true);
    const target: PromQLVectorSelector | PromQLSubquery | undefined =
      this.modifierTarget(expression);

    if (!target) {
      throw new PromQLError(
        "An offset only goes after a selector, a range or a subquery, such as up offset 1h or rate(up[5m] offset 1h).",
        undefined,
        { start: keyword.start, end: keyword.end },
      );
    }

    if (this.offsetWritten.has(target)) {
      throw new PromQLError(
        "The offset is written twice. Keep one.",
        undefined,
        { start: keyword.start, end: keyword.end },
      );
    }

    target.offsetMs = offsetMs;
    this.offsetWritten.add(target);
    expression.position = {
      start: expression.position.start,
      end: this.tokens[this.index - 1]!.end,
    };

    return expression;
  }

  private parseAt(expression: PromQLExpression): PromQLExpression {
    const atToken: PromQLToken = this.next();
    let at: PromQLAtModifier;
    const token: PromQLToken = this.peek();

    if (
      (this.isKeyword(token, "start") || this.isKeyword(token, "end")) &&
      this.peek(1).type === PromQLTokenType.LeftParen
    ) {
      this.next();
      this.next();
      this.expect(PromQLTokenType.RightParen, '")"');
      at = { kind: token.text.toLowerCase() === "start" ? "start" : "end" };
    } else {
      let sign: number = 1;

      if (this.peek().type === PromQLTokenType.Sub) {
        this.next();
        sign = -1;
      } else if (this.peek().type === PromQLTokenType.Add) {
        this.next();
      }

      const numberToken: PromQLToken = this.next();

      if (numberToken.type !== PromQLTokenType.Number) {
        throw this.unexpected(
          numberToken,
          "a Unix timestamp in seconds, start() or end() after @",
        );
      }

      const seconds: number = sign * parseNumberText(numberToken.text);

      if (!Number.isFinite(seconds)) {
        throw new PromQLError(
          "The time after @ must be a Unix timestamp in seconds, such as 1700000000.",
          undefined,
          { start: numberToken.start, end: numberToken.end },
        );
      }

      at = { kind: "timestamp", timestampMs: Math.round(seconds * 1000) };
    }

    const target: PromQLVectorSelector | PromQLSubquery | undefined =
      this.modifierTarget(expression);

    if (!target) {
      throw new PromQLError(
        "@ only goes after a selector, a range or a subquery, such as up @ 1700000000.",
        undefined,
        { start: atToken.start, end: atToken.end },
      );
    }

    if (this.atWritten.has(target)) {
      throw new PromQLError("@ is written twice. Keep one.", undefined, {
        start: atToken.start,
        end: atToken.end,
      });
    }

    target.at = at;
    this.atWritten.add(target);
    expression.position = {
      start: expression.position.start,
      end: this.tokens[this.index - 1]!.end,
    };

    return expression;
  }
}

const capitalize: (text: string) => string = (text: string): string => {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
};

// Whether a matcher accepts a series that does not have its label at all.
export const matchesEmptyValue: (matcher: PromQLLabelMatcher) => boolean = (
  matcher: PromQLLabelMatcher,
): boolean => {
  switch (matcher.type) {
    case PromQLMatchType.Equal:
      return matcher.value === "";
    case PromQLMatchType.NotEqual:
      return matcher.value !== "";
    case PromQLMatchType.RegexMatch:
      return compilePromQLRegex(matcher.value).regex.test("");
    case PromQLMatchType.RegexNoMatch:
      return !compilePromQLRegex(matcher.value).regex.test("");
  }
};

/*
 * The checked syntax tree of a PromQL query. Throws a PromQLError, with the
 * position of the mistake, for a query Prometheus would refuse.
 */
export const parsePromQL: (query: string) => PromQLExpression = (
  query: string,
): PromQLExpression => {
  return new PromQLParser(query).parse();
};
