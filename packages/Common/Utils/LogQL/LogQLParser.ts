import {
  LOGQL_LINE_RANGE_OPERATIONS,
  LOGQL_RANGE_SERIES_PREFIX,
  LogQLComparison,
  LogQLLabelFilterExpression,
  LogQLLabelFilterStage,
  LogQLLineFilterOperator,
  LogQLLogSelector,
  LogQLParserKind,
  LogQLQuery,
  LogQLRangeAggregation,
  LogQLRangeOperation,
  LogQLStage,
  LogQLTemplatePart,
  LogQLUnwrap,
  LogQLUnwrapConversion,
  LogQLValueKind,
} from "./LogQLAst";
import { parseLogQLBytes, parseLogQLDuration } from "./LogQLValues";
import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLAggregateOperator,
  PromQLBinaryOperator,
  PromQLExpression,
  PromQLLabelMatcher,
  PromQLMatchType,
  PromQLNodeKind,
  PromQLPosition,
  PromQLValueType,
  PromQLVectorMatchCardinality,
  PromQLVectorMatching,
  isComparisonOperator,
  isSetOperator,
} from "../PromQL/PromQLAst";
import { getPromQLValueType } from "../PromQL/PromQLParser";
import { parsePromQLDuration } from "../PromQL/PromQLDuration";
import PromQLError from "../PromQL/PromQLError";
import { compilePromQLMatchers } from "../PromQL/PromQLLabels";
import {
  compilePromQLRegex,
  describePromQLPatternProblem,
} from "../PromQL/PromQLRegex";

/*
 * Reads a LogQL query into its tree (LogQLAst), the way Loki's own parser
 * reads it (pkg/logql/syntax): the stream selector, the pipeline, range
 * aggregations of log queries and the PromQL-shaped expression around
 * them. A query that is wrong is refused with what is wrong and where, in
 * Loki's words where it has them ("parse error at line 1, col 7: ...").
 *
 * OneUptime reads the part of LogQL dashboards use (see LogQLEngine): a
 * stage it does not read yet - label_format, pattern, regexp, unpack, an
 * ip() filter - is refused by name, rather than read as something else.
 */

enum TokenType {
  Identifier = "identifier",
  // A number, or a number glued to a unit: 5m, 1h30m, 250ms, 20MB.
  Number = "number",
  String = "string",
  LeftBrace = "{",
  RightBrace = "}",
  LeftParen = "(",
  RightParen = ")",
  LeftBracket = "[",
  RightBracket = "]",
  Comma = ",",
  Assign = "=",
  NotEqual = "!=",
  RegexMatch = "=~",
  RegexNoMatch = "!~",
  PipeExact = "|=",
  PipeMatch = "|~",
  Pipe = "|",
  Equal = "==",
  Greater = ">",
  GreaterOrEqual = ">=",
  Less = "<",
  LessOrEqual = "<=",
  Add = "+",
  Sub = "-",
  Mul = "*",
  Div = "/",
  Mod = "%",
  Pow = "^",
  EOF = "end of query",
}

interface Token {
  type: TokenType;
  text: string;
  start: number;
  end: number;
}

const TWO_CHARACTER_TOKENS: ReadonlyMap<string, TokenType> = new Map<
  string,
  TokenType
>([
  ["!=", TokenType.NotEqual],
  ["=~", TokenType.RegexMatch],
  ["!~", TokenType.RegexNoMatch],
  ["|=", TokenType.PipeExact],
  ["|~", TokenType.PipeMatch],
  ["==", TokenType.Equal],
  [">=", TokenType.GreaterOrEqual],
  ["<=", TokenType.LessOrEqual],
]);

const ONE_CHARACTER_TOKENS: ReadonlyMap<string, TokenType> = new Map<
  string,
  TokenType
>([
  ["{", TokenType.LeftBrace],
  ["}", TokenType.RightBrace],
  ["(", TokenType.LeftParen],
  [")", TokenType.RightParen],
  ["[", TokenType.LeftBracket],
  ["]", TokenType.RightBracket],
  [",", TokenType.Comma],
  ["=", TokenType.Assign],
  ["|", TokenType.Pipe],
  [">", TokenType.Greater],
  ["<", TokenType.Less],
  ["+", TokenType.Add],
  ["-", TokenType.Sub],
  ["*", TokenType.Mul],
  ["/", TokenType.Div],
  ["%", TokenType.Mod],
  ["^", TokenType.Pow],
]);

const SIMPLE_ESCAPES: ReadonlyMap<string, string> = new Map<string, string>([
  ["a", "\x07"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
  ["\\", "\\"],
  ["'", "'"],
  ['"', '"'],
]);

const WHITE_SPACE: RegExp = /\s/;

const HEX_DIGITS: RegExp = /^[0-9a-fA-F]+$/;

// A number with no unit glued to it: 500, 1.5, 1e3.
const PLAIN_NUMBER: RegExp = /^[0-9.]+([eE][-+]?[0-9]+)?$/;

const isDigit: (character: string) => boolean = (
  character: string,
): boolean => {
  return character >= "0" && character <= "9";
};

const isLetter: (character: string) => boolean = (
  character: string,
): boolean => {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "_"
  );
};

/*
 * Where an offset in the query is, as Loki says it: line and column, both
 * from 1.
 */
const describePosition: (query: string, offset: number) => string = (
  query: string,
  offset: number,
): string => {
  const before: string = query.slice(0, offset);
  const line: number = before.split("\n").length;
  const column: number = offset - (before.lastIndexOf("\n") + 1) + 1;

  return `line ${line}, col ${column}`;
};

const parseError: (
  query: string,
  offset: number,
  message: string,
) => PromQLError = (
  query: string,
  offset: number,
  message: string,
): PromQLError => {
  return new PromQLError(
    `parse error at ${describePosition(query, offset)}: ${message}`,
    undefined,
    { start: offset, end: offset + 1 },
  );
};

const tokenize: (query: string) => Array<Token> = (
  query: string,
): Array<Token> => {
  const tokens: Array<Token> = [];
  let position: number = 0;

  while (position < query.length) {
    const character: string = query[position]!;

    if (WHITE_SPACE.test(character)) {
      position++;
      continue;
    }

    // A comment runs to the end of its line, as in Loki.
    if (character === "#") {
      while (position < query.length && query[position] !== "\n") {
        position++;
      }
      continue;
    }

    if (
      isDigit(character) ||
      (character === "." && isDigit(query[position + 1] || ""))
    ) {
      const start: number = position;

      while (
        position < query.length &&
        (isDigit(query[position]!) || query[position] === ".")
      ) {
        position++;
      }

      // An exponent: 1e3, 2.5E-4.
      if (
        (query[position] === "e" || query[position] === "E") &&
        (isDigit(query[position + 1] || "") ||
          ((query[position + 1] === "-" || query[position + 1] === "+") &&
            isDigit(query[position + 2] || "")))
      ) {
        position += 2;

        while (position < query.length && isDigit(query[position]!)) {
          position++;
        }
      }

      // A unit glued to it: 5m, 1h30m, 1.5s, 20MB, 1KiB, 100µs.
      while (
        position < query.length &&
        (isLetter(query[position]!) ||
          isDigit(query[position]!) ||
          query[position] === "µ" ||
          query[position] === ".")
      ) {
        position++;
      }

      tokens.push({
        type: TokenType.Number,
        text: query.slice(start, position),
        start,
        end: position,
      });
      continue;
    }

    if (isLetter(character)) {
      const start: number = position;

      while (
        position < query.length &&
        (isLetter(query[position]!) || isDigit(query[position]!))
      ) {
        position++;
      }

      tokens.push({
        type: TokenType.Identifier,
        text: query.slice(start, position),
        start,
        end: position,
      });
      continue;
    }

    if (character === '"') {
      const start: number = position;
      let value: string = "";
      position++;

      while (position < query.length && query[position] !== '"') {
        const current: string = query[position]!;

        if (current === "\n") {
          throw parseError(query, position, "a string has no closing quote.");
        }

        if (current === "\\") {
          const next: string = query[position + 1] || "";
          const simple: string | undefined = SIMPLE_ESCAPES.get(next);

          if (simple !== undefined) {
            value += simple;
            position += 2;
            continue;
          }

          if (next === "x" || next === "u" || next === "U") {
            const length: number = next === "x" ? 2 : next === "u" ? 4 : 8;
            const hex: string = query.slice(
              position + 2,
              position + 2 + length,
            );

            if (hex.length !== length || !HEX_DIGITS.test(hex)) {
              throw parseError(
                query,
                position,
                "a string has an escape that is not one.",
              );
            }

            value += String.fromCodePoint(parseInt(hex, 16));
            position += 2 + length;
            continue;
          }

          throw parseError(
            query,
            position,
            `a string has an escape that is not one: \\${next}.`,
          );
        }

        value += current;
        position++;
      }

      if (position >= query.length) {
        throw parseError(query, start, "a string has no closing quote.");
      }

      position++;
      tokens.push({
        type: TokenType.String,
        text: value,
        start,
        end: position,
      });
      continue;
    }

    // A raw string: no escapes, as in Go.
    if (character === "`") {
      const start: number = position;
      const close: number = query.indexOf("`", position + 1);

      if (close === -1) {
        throw parseError(query, start, "a string has no closing backtick.");
      }

      tokens.push({
        type: TokenType.String,
        text: query.slice(position + 1, close),
        start,
        end: close + 1,
      });
      position = close + 1;
      continue;
    }

    const pair: string = query.slice(position, position + 2);
    const pairType: TokenType | undefined = TWO_CHARACTER_TOKENS.get(pair);

    if (pairType) {
      tokens.push({
        type: pairType,
        text: pair,
        start: position,
        end: position + 2,
      });
      position += 2;
      continue;
    }

    const singleType: TokenType | undefined =
      ONE_CHARACTER_TOKENS.get(character);

    if (singleType) {
      tokens.push({
        type: singleType,
        text: character,
        start: position,
        end: position + 1,
      });
      position++;
      continue;
    }

    throw parseError(
      query,
      position,
      `syntax error: unexpected character "${character}".`,
    );
  }

  tokens.push({
    type: TokenType.EOF,
    text: "",
    start: query.length,
    end: query.length,
  });

  return tokens;
};

const RANGE_OPERATIONS: ReadonlyMap<string, LogQLRangeOperation> = new Map<
  string,
  LogQLRangeOperation
>(
  Object.values(LogQLRangeOperation).map(
    (operation: LogQLRangeOperation): [string, LogQLRangeOperation] => {
      return [operation, operation];
    },
  ),
);

const VECTOR_AGGREGATIONS: ReadonlyMap<string, PromQLAggregateOperator> =
  new Map<string, PromQLAggregateOperator>([
    ["sum", PromQLAggregateOperator.Sum],
    ["avg", PromQLAggregateOperator.Avg],
    ["min", PromQLAggregateOperator.Min],
    ["max", PromQLAggregateOperator.Max],
    ["count", PromQLAggregateOperator.Count],
    ["stddev", PromQLAggregateOperator.Stddev],
    ["stdvar", PromQLAggregateOperator.Stdvar],
    ["topk", PromQLAggregateOperator.Topk],
    ["bottomk", PromQLAggregateOperator.Bottomk],
  ]);

// Stages Loki has that OneUptime does not read yet: refused by name.
const UNSUPPORTED_STAGES: ReadonlySet<string> = new Set<string>([
  "label_format",
  "pattern",
  "regexp",
  "unpack",
  "logfmt_strict",
]);

// Binary operators by precedence, lowest first, as PromQL's (and Loki's).
const PRECEDENCE: ReadonlyArray<ReadonlyArray<PromQLBinaryOperator>> = [
  [PromQLBinaryOperator.Or],
  [PromQLBinaryOperator.And, PromQLBinaryOperator.Unless],
  [
    PromQLBinaryOperator.Eql,
    PromQLBinaryOperator.Neq,
    PromQLBinaryOperator.Gtr,
    PromQLBinaryOperator.Gte,
    PromQLBinaryOperator.Lss,
    PromQLBinaryOperator.Lte,
  ],
  [PromQLBinaryOperator.Add, PromQLBinaryOperator.Sub],
  [
    PromQLBinaryOperator.Mul,
    PromQLBinaryOperator.Div,
    PromQLBinaryOperator.Mod,
  ],
  [PromQLBinaryOperator.Pow],
];

const LABEL_NAME: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

class LogQLParser {
  private readonly query: string;
  private readonly tokens: Array<Token>;
  private index: number = 0;
  private readonly ranges: Array<LogQLRangeAggregation> = [];

  public constructor(query: string) {
    this.query = query;
    this.tokens = tokenize(query);
  }

  public parse(): LogQLQuery {
    if (this.peek().type === TokenType.EOF) {
      throw parseError(this.query, 0, "syntax error: the query is empty.");
    }

    // A log query is a selector and its pipeline, and nothing around it.
    if (this.peek().type === TokenType.LeftBrace) {
      const selector: LogQLLogSelector = this.parseLogSelector();

      if (this.peek().type === TokenType.LeftBracket) {
        throw this.errorAt(
          this.peek(),
          "a range like [5m] belongs inside a range aggregation, such as count_over_time({...}[5m]).",
        );
      }

      this.expect(TokenType.EOF);

      return { kind: "LogQuery", selector };
    }

    /*
     * Numbers and vector() alone are a metric query too, as in Loki:
     * Grafana checks a Loki data source with vector(1)+vector(1).
     */
    const expression: PromQLExpression = this.parseExpression(0);
    this.expect(TokenType.EOF);

    return { kind: "MetricQuery", expression, ranges: this.ranges };
  }

  private peek(offset: number = 0): Token {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)]!;
  }

  private next(): Token {
    const token: Token = this.peek();

    if (token.type !== TokenType.EOF) {
      this.index++;
    }

    return token;
  }

  private errorAt(token: Token, message: string): PromQLError {
    return parseError(this.query, token.start, message);
  }

  private unexpected(token: Token, expected: string): PromQLError {
    const found: string =
      token.type === TokenType.EOF
        ? "end of query"
        : token.type === TokenType.String
          ? `the string "${token.text}"`
          : `"${token.text}"`;

    return this.errorAt(
      token,
      `syntax error: unexpected ${found}, expected ${expected}.`,
    );
  }

  private expect(type: TokenType, expected?: string): Token {
    const token: Token = this.peek();

    if (token.type !== type) {
      throw this.unexpected(token, expected || `"${type}"`);
    }

    return this.next();
  }

  private isKeyword(token: Token, keyword: string): boolean {
    return token.type === TokenType.Identifier && token.text === keyword;
  }

  private positionOf(start: Token, end: Token): PromQLPosition {
    return { start: start.start, end: end.end };
  }

  // A stream selector, `{app="api", env=~"prod|staging"}`, and its pipeline.
  private parseLogSelector(): LogQLLogSelector {
    const open: Token = this.expect(TokenType.LeftBrace);
    const matchers: Array<PromQLLabelMatcher> = [];

    while (this.peek().type !== TokenType.RightBrace) {
      const name: Token = this.expect(TokenType.Identifier, "a label name");
      const operator: Token = this.next();
      let type: PromQLMatchType;

      switch (operator.type) {
        case TokenType.Assign:
          type = PromQLMatchType.Equal;
          break;
        case TokenType.NotEqual:
          type = PromQLMatchType.NotEqual;
          break;
        case TokenType.RegexMatch:
          type = PromQLMatchType.RegexMatch;
          break;
        case TokenType.RegexNoMatch:
          type = PromQLMatchType.RegexNoMatch;
          break;
        default:
          throw this.unexpected(operator, "=, !=, =~ or !~");
      }

      const value: Token = this.expect(TokenType.String, "a quoted value");
      matchers.push(this.matcherOf(name, type, value));

      if (this.peek().type === TokenType.Comma) {
        this.next();
        continue;
      }

      if (this.peek().type !== TokenType.RightBrace) {
        throw this.unexpected(this.peek(), '"," or "}"');
      }
    }

    this.expect(TokenType.RightBrace);

    /*
     * Loki's own rule, which keeps every read narrowed by a label value: at
     * least one matcher a log without the label does not pass.
     */
    const narrows: boolean = matchers.some(
      (matcher: PromQLLabelMatcher): boolean => {
        return (
          (matcher.type === PromQLMatchType.Equal ||
            matcher.type === PromQLMatchType.RegexMatch) &&
          !compilePromQLMatchers([matcher])({})
        );
      },
    );

    if (!narrows) {
      throw this.errorAt(
        open,
        'queries require at least one regexp or equality matcher that does not have an empty-compatible value. For instance, app=~".*" does not meet this requirement, but app=~".+" will',
      );
    }

    const selector: LogQLLogSelector = {
      kind: "LogSelector",
      matchers,
      stages: this.parseStages(),
    };

    return selector;
  }

  private matcherOf(
    name: Token,
    type: PromQLMatchType,
    value: Token,
  ): PromQLLabelMatcher {
    if (
      type === PromQLMatchType.RegexMatch ||
      type === PromQLMatchType.RegexNoMatch
    ) {
      this.checkPattern(value);
    }

    return { name: name.text, type, value: value.text };
  }

  private checkPattern(value: Token): void {
    try {
      compilePromQLRegex(value.text);
    } catch (error: unknown) {
      throw this.errorAt(
        value,
        `"${value.text}" is not a valid regular expression: ${
          describePromQLPatternProblem(error) || "it cannot be read"
        }.`,
      );
    }
  }

  /*
   * The pipeline after a selector, up to a range, a closing parenthesis or
   * the end. An unwrap ends a pipeline: it is read by the range aggregation
   * around it (readUnwrap).
   */
  private parseStages(): Array<LogQLStage> {
    const stages: Array<LogQLStage> = [];

    for (;;) {
      const token: Token = this.peek();

      if (
        token.type === TokenType.PipeExact ||
        token.type === TokenType.PipeMatch ||
        token.type === TokenType.NotEqual ||
        token.type === TokenType.RegexNoMatch
      ) {
        stages.push(this.parseLineFilter());
        continue;
      }

      if (token.type !== TokenType.Pipe) {
        return stages;
      }

      // `| unwrap` is read by the range aggregation, after the stages.
      if (this.isKeyword(this.peek(1), "unwrap")) {
        return stages;
      }

      this.next();
      stages.push(this.parsePipeStage());
    }
  }

  private parseLineFilter(): LogQLStage {
    const operatorToken: Token = this.next();
    const operator: LogQLLineFilterOperator =
      operatorToken.type === TokenType.PipeExact
        ? LogQLLineFilterOperator.Contains
        : operatorToken.type === TokenType.PipeMatch
          ? LogQLLineFilterOperator.Matches
          : operatorToken.type === TokenType.NotEqual
            ? LogQLLineFilterOperator.NotContains
            : LogQLLineFilterOperator.NotMatches;

    if (
      this.isKeyword(this.peek(), "ip") &&
      this.peek(1).type === TokenType.LeftParen
    ) {
      throw this.errorAt(
        this.peek(),
        'ip() line filters are not supported yet. Filter by the address as a string, such as |= "10.0.0.1".',
      );
    }

    const values: Array<string> = [];

    for (;;) {
      const value: Token = this.expect(TokenType.String, "a quoted string");

      if (
        operator === LogQLLineFilterOperator.Matches ||
        operator === LogQLLineFilterOperator.NotMatches
      ) {
        this.checkPattern(value);
      }

      values.push(value.text);

      // `|= "a" or "b"`: either string, as Loki 3 reads it.
      if (
        this.isKeyword(this.peek(), "or") &&
        this.peek(1).type === TokenType.String
      ) {
        this.next();
        continue;
      }

      break;
    }

    return { kind: "LineFilter", operator, values };
  }

  // The stage after a `|`.
  private parsePipeStage(): LogQLStage {
    const token: Token = this.peek();

    if (token.type === TokenType.Identifier) {
      if (token.text === "json" || token.text === "logfmt") {
        this.next();

        /*
         * `| json status="response.status"` names what to extract: not read
         * yet. A bare `| json` extracts every field.
         */
        if (
          this.peek().type === TokenType.Identifier &&
          (this.peek(1).type === TokenType.Assign ||
            this.peek(1).type === TokenType.Comma)
        ) {
          throw this.errorAt(
            this.peek(),
            `| ${token.text} with expressions is not supported yet: use | ${token.text}, which extracts every field.`,
          );
        }

        if (this.peek().type === TokenType.Sub) {
          throw this.errorAt(
            this.peek(),
            `| ${token.text} with flags is not supported yet: use | ${token.text}.`,
          );
        }

        return {
          kind: "Parser",
          parser:
            token.text === "json"
              ? LogQLParserKind.Json
              : LogQLParserKind.Logfmt,
        };
      }

      if (token.text === "line_format") {
        this.next();
        const template: Token = this.expect(TokenType.String, "a template");
        return { kind: "LineFormat", parts: this.parseTemplate(template) };
      }

      if (token.text === "drop" || token.text === "keep") {
        this.next();
        const labels: Array<string> = [];

        for (;;) {
          const name: Token = this.expect(TokenType.Identifier, "a label name");

          if (
            this.peek().type === TokenType.Assign ||
            this.peek().type === TokenType.RegexMatch
          ) {
            throw this.errorAt(
              this.peek(),
              `| ${token.text} with a value is not supported yet: name the labels only.`,
            );
          }

          labels.push(name.text);

          if (this.peek().type !== TokenType.Comma) {
            break;
          }

          this.next();
        }

        return { kind: token.text === "drop" ? "Drop" : "Keep", labels };
      }

      if (token.text === "decolorize") {
        this.next();
        return { kind: "Decolorize" };
      }

      if (UNSUPPORTED_STAGES.has(token.text)) {
        throw this.errorAt(
          token,
          `| ${token.text} is not supported yet. Use | json or | logfmt to extract labels, and | line_format "{{.label}}" to rewrite a line.`,
        );
      }

      // Anything else after a pipe is a label filter: `| status >= 500`.
      return { kind: "LabelFilter", expression: this.parseLabelFilterOr() };
    }

    if (token.type === TokenType.LeftParen) {
      return { kind: "LabelFilter", expression: this.parseLabelFilterOr() };
    }

    throw this.unexpected(
      token,
      "a parser (json, logfmt), a label filter, line_format, drop or keep",
    );
  }

  // `a or b`, of `and`s.
  private parseLabelFilterOr(): LogQLLabelFilterExpression {
    let left: LogQLLabelFilterExpression = this.parseLabelFilterAnd();

    while (this.isKeyword(this.peek(), "or")) {
      this.next();
      left = { kind: "Or", left, right: this.parseLabelFilterAnd() };
    }

    return left;
  }

  // `a and b`, `a, b` and `a b` all mean both, as in Loki.
  private parseLabelFilterAnd(): LogQLLabelFilterExpression {
    let left: LogQLLabelFilterExpression = this.parseLabelFilterPrimary();

    for (;;) {
      if (
        this.isKeyword(this.peek(), "and") ||
        this.peek().type === TokenType.Comma
      ) {
        this.next();
        left = { kind: "And", left, right: this.parseLabelFilterPrimary() };
        continue;
      }

      // Two filters side by side, `| a="x" b="y"`.
      if (
        this.peek().type === TokenType.Identifier &&
        !this.isKeyword(this.peek(), "or") &&
        this.isLabelFilterOperator(this.peek(1))
      ) {
        left = { kind: "And", left, right: this.parseLabelFilterPrimary() };
        continue;
      }

      return left;
    }
  }

  private isLabelFilterOperator(token: Token): boolean {
    return [
      TokenType.Assign,
      TokenType.NotEqual,
      TokenType.RegexMatch,
      TokenType.RegexNoMatch,
      TokenType.Equal,
      TokenType.Greater,
      TokenType.GreaterOrEqual,
      TokenType.Less,
      TokenType.LessOrEqual,
    ].includes(token.type);
  }

  private parseLabelFilterPrimary(): LogQLLabelFilterExpression {
    if (this.peek().type === TokenType.LeftParen) {
      this.next();
      const inner: LogQLLabelFilterExpression = this.parseLabelFilterOr();
      this.expect(TokenType.RightParen);
      return inner;
    }

    const name: Token = this.expect(TokenType.Identifier, "a label name");
    const operator: Token = this.next();

    if (!this.isLabelFilterOperator(operator)) {
      throw this.unexpected(
        operator,
        "a comparison such as =, !=, =~, > or <=",
      );
    }

    const value: Token = this.next();

    if (value.type === TokenType.String) {
      let type: PromQLMatchType;

      switch (operator.type) {
        case TokenType.Assign:
        case TokenType.Equal:
          type = PromQLMatchType.Equal;
          break;
        case TokenType.NotEqual:
          type = PromQLMatchType.NotEqual;
          break;
        case TokenType.RegexMatch:
          type = PromQLMatchType.RegexMatch;
          break;
        case TokenType.RegexNoMatch:
          type = PromQLMatchType.RegexNoMatch;
          break;
        default:
          throw this.errorAt(
            operator,
            `"${operator.text}" compares numbers: compare "${name.text}" with a number, a duration or a size, not a string.`,
          );
      }

      return { kind: "Match", matcher: this.matcherOf(name, type, value) };
    }

    // A number, a duration or a size, possibly negative.
    let negative: boolean = false;
    let numberToken: Token = value;

    if (value.type === TokenType.Sub) {
      negative = true;
      numberToken = this.next();
    }

    if (numberToken.type !== TokenType.Number) {
      throw this.unexpected(
        numberToken,
        "a quoted string, a number, a duration or a size",
      );
    }

    if (
      operator.type === TokenType.RegexMatch ||
      operator.type === TokenType.RegexNoMatch
    ) {
      throw this.errorAt(
        operator,
        `"${operator.text}" needs a quoted pattern.`,
      );
    }

    const read: { value: number; valueKind: LogQLValueKind } =
      this.readLabelFilterNumber(numberToken);
    const comparison: LogQLComparison =
      operator.type === TokenType.Assign || operator.type === TokenType.Equal
        ? LogQLComparison.Equal
        : operator.type === TokenType.NotEqual
          ? LogQLComparison.NotEqual
          : (operator.text as LogQLComparison);

    return {
      kind: "Compare",
      label: name.text,
      comparison,
      value: negative ? -read.value : read.value,
      valueKind: read.valueKind,
    };
  }

  // 500, 1.5, 250ms (in seconds), 20MB (in bytes).
  private readLabelFilterNumber(token: Token): {
    value: number;
    valueKind: LogQLValueKind;
  } {
    const plain: number = Number(token.text);

    if (PLAIN_NUMBER.test(token.text) && Number.isFinite(plain)) {
      return { value: plain, valueKind: LogQLValueKind.Number };
    }

    const seconds: number | undefined = parseLogQLDuration(token.text);

    if (seconds !== undefined) {
      return { value: seconds, valueKind: LogQLValueKind.Duration };
    }

    const bytes: number | undefined = parseLogQLBytes(token.text);

    if (bytes !== undefined) {
      return { value: bytes, valueKind: LogQLValueKind.Bytes };
    }

    throw this.errorAt(
      token,
      `"${token.text}" is not a number, a duration (250ms, 1.5s) or a size (20MB, 1KiB).`,
    );
  }

  /*
   * line_format's template, as far as OneUptime reads Go templates: text,
   * and {{.label}} (or {{ .label }}) filled with a label's value -
   * {{.__line__}} the line itself.
   */
  private parseTemplate(token: Token): Array<LogQLTemplatePart> {
    const parts: Array<LogQLTemplatePart> = [];
    const template: string = token.text;
    let position: number = 0;

    while (position < template.length) {
      const open: number = template.indexOf("{{", position);

      if (open === -1) {
        parts.push({ text: template.slice(position) });
        break;
      }

      if (open > position) {
        parts.push({ text: template.slice(position, open) });
      }

      const close: number = template.indexOf("}}", open + 2);

      if (close === -1) {
        throw this.errorAt(
          token,
          "line_format's template has a {{ with no }}.",
        );
      }

      const action: string = template.slice(open + 2, close).trim();
      const label: RegExpMatchArray | null = action.match(
        /^\.([a-zA-Z_][a-zA-Z0-9_]*)$/,
      );

      if (!label) {
        throw this.errorAt(
          token,
          `line_format reads {{.label}} only, and "{{${template.slice(open + 2, close)}}}" is more: write each label as {{.name}}.`,
        );
      }

      parts.push({ label: label[1]! });
      position = close + 2;
    }

    return parts;
  }

  // `| unwrap latency`, `| unwrap duration(took)`, `| unwrap bytes(size)`.
  private readUnwrap(): LogQLUnwrap | undefined {
    if (
      this.peek().type !== TokenType.Pipe ||
      !this.isKeyword(this.peek(1), "unwrap")
    ) {
      return undefined;
    }

    this.next();
    this.next();

    let conversion: LogQLUnwrapConversion = LogQLUnwrapConversion.None;
    let labelToken: Token = this.expect(TokenType.Identifier, "a label name");

    if (this.peek().type === TokenType.LeftParen) {
      const converter: string = labelToken.text;

      if (converter === "duration" || converter === "duration_seconds") {
        conversion = LogQLUnwrapConversion.Duration;
      } else if (converter === "bytes") {
        conversion = LogQLUnwrapConversion.Bytes;
      } else {
        throw this.errorAt(
          labelToken,
          `"${converter}" is not an unwrap conversion: use duration(...), duration_seconds(...) or bytes(...).`,
        );
      }

      this.next();
      labelToken = this.expect(TokenType.Identifier, "a label name");
      this.expect(TokenType.RightParen);
    }

    // Label filters after the unwrap, such as | __error__="".
    const stages: Array<LogQLLabelFilterStage> = [];

    while (this.peek().type === TokenType.Pipe) {
      this.next();
      stages.push({
        kind: "LabelFilter",
        expression: this.parseLabelFilterOr(),
      });
    }

    return { label: labelToken.text, conversion, stages };
  }

  // `[5m]`, in milliseconds.
  private parseRange(): number {
    this.expect(TokenType.LeftBracket, "a range such as [5m]");
    const duration: Token = this.expect(
      TokenType.Number,
      "a duration such as 5m",
    );
    const rangeMs: number | undefined = parsePromQLDuration(duration.text);

    if (rangeMs === undefined || rangeMs <= 0) {
      throw this.errorAt(
        duration,
        `"${duration.text}" is not a duration a range can be, such as 5m or 1h.`,
      );
    }

    this.expect(TokenType.RightBracket);
    return rangeMs;
  }

  private parseOffset(): number {
    if (!this.isKeyword(this.peek(), "offset")) {
      return 0;
    }

    this.next();
    const duration: Token = this.expect(
      TokenType.Number,
      "a duration such as 1h",
    );
    const offsetMs: number | undefined = parsePromQLDuration(duration.text);

    if (offsetMs === undefined) {
      throw this.errorAt(duration, `"${duration.text}" is not a duration.`);
    }

    return offsetMs;
  }

  // `by (a, b)` or `without (a)`.
  private parseGrouping(): { labels: Array<string>; without: boolean } {
    const keyword: Token = this.next();
    this.expect(TokenType.LeftParen);
    const labels: Array<string> = [];

    while (this.peek().type !== TokenType.RightParen) {
      const name: Token = this.expect(TokenType.Identifier, "a label name");

      if (!LABEL_NAME.test(name.text)) {
        throw this.errorAt(name, `"${name.text}" is not a label name.`);
      }

      labels.push(name.text);

      if (this.peek().type === TokenType.Comma) {
        this.next();
      } else if (this.peek().type !== TokenType.RightParen) {
        throw this.unexpected(this.peek(), '"," or ")"');
      }
    }

    this.expect(TokenType.RightParen);

    return { labels, without: keyword.text === "without" };
  }

  private isGroupingKeyword(token: Token): boolean {
    return this.isKeyword(token, "by") || this.isKeyword(token, "without");
  }

  // A range aggregation: count_over_time({...} |= "x" [5m]).
  private parseRangeAggregation(name: Token): PromQLExpression {
    const operation: LogQLRangeOperation = RANGE_OPERATIONS.get(name.text)!;
    this.expect(TokenType.LeftParen);

    let parameter: number | undefined = undefined;

    if (operation === LogQLRangeOperation.QuantileOverTime) {
      const value: Token = this.expect(
        TokenType.Number,
        "a quantile between 0 and 1",
      );
      parameter = Number(value.text);

      if (!Number.isFinite(parameter)) {
        throw this.errorAt(value, `"${value.text}" is not a quantile.`);
      }

      this.expect(TokenType.Comma);
    }

    if (this.peek().type !== TokenType.LeftBrace) {
      throw this.unexpected(this.peek(), 'a log query such as {app="api"}');
    }

    const selector: LogQLLogSelector = this.parseLogSelector();
    let rangeMs: number;
    let unwrap: LogQLUnwrap | undefined;

    // The range after the pipeline, or right after the selector.
    if (this.peek().type === TokenType.LeftBracket) {
      rangeMs = this.parseRange();
      selector.stages.push(...this.parseStages());
      unwrap = this.readUnwrap();
    } else {
      unwrap = this.readUnwrap();
      rangeMs = this.parseRange();
    }

    const offsetMs: number = this.parseOffset();
    const close: Token = this.expect(TokenType.RightParen);

    if (
      LOGQL_LINE_RANGE_OPERATIONS.has(operation) &&
      unwrap &&
      operation !== LogQLRangeOperation.Rate
    ) {
      throw this.errorAt(
        name,
        `${operation} counts lines, and reads no unwrapped label: leave out | unwrap ${unwrap.label}.`,
      );
    }

    if (!LOGQL_LINE_RANGE_OPERATIONS.has(operation) && !unwrap) {
      throw this.errorAt(
        name,
        `${operation} reads a label's values: add | unwrap <label> before the range, such as ${operation}({app="api"} | logfmt | unwrap latency [5m]).`,
      );
    }

    let grouping: { labels: Array<string>; without: boolean } | undefined;

    if (this.isGroupingKeyword(this.peek())) {
      if (!unwrap) {
        throw this.errorAt(
          this.peek(),
          `grouping ${operation} by labels needs an unwrapped label; group the result instead, such as sum by (level) (${operation}(...)).`,
        );
      }

      grouping = this.parseGrouping();
    }

    const seriesName: string = `${LOGQL_RANGE_SERIES_PREFIX}${this.ranges.length}`;

    this.ranges.push({
      kind: "RangeAggregation",
      seriesName,
      operation,
      selector,
      unwrap,
      rangeMs,
      offsetMs,
      parameter,
      grouping,
    });

    return {
      kind: PromQLNodeKind.VectorSelector,
      name: seriesName,
      matchers: [
        {
          name: PROMQL_METRIC_NAME_LABEL,
          type: PromQLMatchType.Equal,
          value: seriesName,
        },
      ],
      offsetMs: 0,
      at: undefined,
      position: this.positionOf(name, close),
    };
  }

  // sum by (level) (...), topk(5, ...), sort(...).
  private parseVectorAggregation(name: Token): PromQLExpression {
    const operator: PromQLAggregateOperator = VECTOR_AGGREGATIONS.get(
      name.text,
    )!;
    let grouping: { labels: Array<string>; without: boolean } | undefined;

    if (this.isGroupingKeyword(this.peek())) {
      grouping = this.parseGrouping();
    }

    this.expect(TokenType.LeftParen);
    let parameter: PromQLExpression | undefined = undefined;

    if (
      operator === PromQLAggregateOperator.Topk ||
      operator === PromQLAggregateOperator.Bottomk
    ) {
      const value: Token = this.expect(
        TokenType.Number,
        "how many series to keep",
      );
      parameter = {
        kind: PromQLNodeKind.NumberLiteral,
        value: Number(value.text),
        position: { start: value.start, end: value.end },
      };
      this.expect(TokenType.Comma);
    }

    const expression: PromQLExpression = this.parseExpression(0);
    const close: Token = this.expect(TokenType.RightParen);

    if (!grouping && this.isGroupingKeyword(this.peek())) {
      grouping = this.parseGrouping();
    }

    return {
      kind: PromQLNodeKind.Aggregate,
      operator,
      expression,
      parameter,
      grouping: grouping?.labels || [],
      without: grouping?.without || false,
      position: this.positionOf(name, close),
    };
  }

  private parseCall(name: Token): PromQLExpression {
    this.expect(TokenType.LeftParen);
    const args: Array<PromQLExpression> = [];

    while (this.peek().type !== TokenType.RightParen) {
      if (this.peek().type === TokenType.String) {
        const value: Token = this.next();
        args.push({
          kind: PromQLNodeKind.StringLiteral,
          value: value.text,
          position: { start: value.start, end: value.end },
        });
      } else {
        args.push(this.parseExpression(0));
      }

      if (this.peek().type === TokenType.Comma) {
        this.next();
      } else if (this.peek().type !== TokenType.RightParen) {
        throw this.unexpected(this.peek(), '"," or ")"');
      }
    }

    const close: Token = this.expect(TokenType.RightParen);

    if (
      name.text === "vector" &&
      (args.length !== 1 || args[0]!.kind !== PromQLNodeKind.NumberLiteral)
    ) {
      throw this.errorAt(name, "vector() takes one number, such as vector(0).");
    }

    if (name.text === "label_replace" && args.length !== 5) {
      throw this.errorAt(
        name,
        "label_replace() takes a query and four strings: destination, replacement, source and regex.",
      );
    }

    return {
      kind: PromQLNodeKind.Call,
      functionName: name.text,
      args,
      position: this.positionOf(name, close),
    };
  }

  private parsePrimary(): PromQLExpression {
    const token: Token = this.peek();

    if (token.type === TokenType.Number) {
      this.next();
      const value: number =
        token.text === "Inf" ? Infinity : Number(token.text);

      if (!Number.isFinite(value) && token.text !== "Inf") {
        throw this.errorAt(token, `"${token.text}" is not a number.`);
      }

      return {
        kind: PromQLNodeKind.NumberLiteral,
        value,
        position: { start: token.start, end: token.end },
      };
    }

    if (token.type === TokenType.LeftParen) {
      this.next();
      const expression: PromQLExpression = this.parseExpression(0);
      const close: Token = this.expect(TokenType.RightParen);

      return {
        kind: PromQLNodeKind.Paren,
        expression,
        position: this.positionOf(token, close),
      };
    }

    if (token.type === TokenType.LeftBrace) {
      throw this.errorAt(
        token,
        "a log query inside a metric query needs a range aggregation around it, such as count_over_time({...}[5m]).",
      );
    }

    if (token.type === TokenType.Identifier) {
      if (RANGE_OPERATIONS.has(token.text)) {
        this.next();
        return this.parseRangeAggregation(token);
      }

      if (VECTOR_AGGREGATIONS.has(token.text)) {
        this.next();
        return this.parseVectorAggregation(token);
      }

      if (
        (token.text === "sort" ||
          token.text === "sort_desc" ||
          token.text === "vector" ||
          token.text === "label_replace") &&
        this.peek(1).type === TokenType.LeftParen
      ) {
        this.next();
        return this.parseCall(token);
      }

      if (token.text === "Inf" || token.text === "NaN") {
        this.next();
        return {
          kind: PromQLNodeKind.NumberLiteral,
          value: token.text === "Inf" ? Infinity : NaN,
          position: { start: token.start, end: token.end },
        };
      }

      throw this.errorAt(
        token,
        `syntax error: unexpected "${token.text}": a metric query is built of range aggregations (count_over_time, rate, ...), aggregations (sum, topk, ...) and numbers.`,
      );
    }

    throw this.unexpected(
      token,
      "a range aggregation, an aggregation or a number",
    );
  }

  private parseUnary(): PromQLExpression {
    const token: Token = this.peek();

    if (token.type === TokenType.Sub || token.type === TokenType.Add) {
      this.next();
      const expression: PromQLExpression = this.parseUnary();

      // -5 is the number -5.
      if (expression.kind === PromQLNodeKind.NumberLiteral) {
        return {
          ...expression,
          value:
            token.type === TokenType.Sub ? -expression.value : expression.value,
          position: { start: token.start, end: expression.position.end },
        };
      }

      return {
        kind: PromQLNodeKind.Unary,
        operator:
          token.type === TokenType.Sub
            ? PromQLBinaryOperator.Sub
            : PromQLBinaryOperator.Add,
        expression,
        position: { start: token.start, end: expression.position.end },
      };
    }

    return this.parsePrimary();
  }

  private binaryOperatorOf(token: Token): PromQLBinaryOperator | undefined {
    switch (token.type) {
      case TokenType.Add:
        return PromQLBinaryOperator.Add;
      case TokenType.Sub:
        return PromQLBinaryOperator.Sub;
      case TokenType.Mul:
        return PromQLBinaryOperator.Mul;
      case TokenType.Div:
        return PromQLBinaryOperator.Div;
      case TokenType.Mod:
        return PromQLBinaryOperator.Mod;
      case TokenType.Pow:
        return PromQLBinaryOperator.Pow;
      case TokenType.Equal:
        return PromQLBinaryOperator.Eql;
      case TokenType.NotEqual:
        return PromQLBinaryOperator.Neq;
      case TokenType.Greater:
        return PromQLBinaryOperator.Gtr;
      case TokenType.GreaterOrEqual:
        return PromQLBinaryOperator.Gte;
      case TokenType.Less:
        return PromQLBinaryOperator.Lss;
      case TokenType.LessOrEqual:
        return PromQLBinaryOperator.Lte;
      case TokenType.Identifier:
        if (token.text === "and") {
          return PromQLBinaryOperator.And;
        }
        if (token.text === "or") {
          return PromQLBinaryOperator.Or;
        }
        if (token.text === "unless") {
          return PromQLBinaryOperator.Unless;
        }
        return undefined;
      default:
        return undefined;
    }
  }

  // `on (a)`, `ignoring (b)`, then `group_left (c)` or `group_right`.
  private parseVectorMatching(
    operator: PromQLBinaryOperator,
  ): PromQLVectorMatching | undefined {
    let matching: PromQLVectorMatching | undefined = undefined;

    if (
      this.isKeyword(this.peek(), "on") ||
      this.isKeyword(this.peek(), "ignoring")
    ) {
      const keyword: Token = this.next();
      const labels: Array<string> = this.parseLabelList();
      matching = {
        cardinality: isSetOperator(operator)
          ? PromQLVectorMatchCardinality.ManyToMany
          : PromQLVectorMatchCardinality.OneToOne,
        // Set below from group_left or group_right, when one is written.
        on: keyword.text === "on",
        matchingLabels: labels,
        include: [],
      };

      if (
        this.isKeyword(this.peek(), "group_left") ||
        this.isKeyword(this.peek(), "group_right")
      ) {
        const group: Token = this.next();
        matching.cardinality =
          group.text === "group_left"
            ? PromQLVectorMatchCardinality.ManyToOne
            : PromQLVectorMatchCardinality.OneToMany;
        matching.include =
          this.peek().type === TokenType.LeftParen ? this.parseLabelList() : [];
      }
    }

    return matching;
  }

  private parseLabelList(): Array<string> {
    this.expect(TokenType.LeftParen);
    const labels: Array<string> = [];

    while (this.peek().type !== TokenType.RightParen) {
      labels.push(this.expect(TokenType.Identifier, "a label name").text);

      if (this.peek().type === TokenType.Comma) {
        this.next();
      }
    }

    this.expect(TokenType.RightParen);
    return labels;
  }

  private parseExpression(level: number): PromQLExpression {
    if (level >= PRECEDENCE.length) {
      return this.parseUnary();
    }

    let lhs: PromQLExpression = this.parseExpression(level + 1);

    for (;;) {
      const token: Token = this.peek();
      const operator: PromQLBinaryOperator | undefined =
        this.binaryOperatorOf(token);

      if (!operator || !PRECEDENCE[level]!.includes(operator)) {
        return lhs;
      }

      this.next();
      let returnBool: boolean = false;

      if (this.isKeyword(this.peek(), "bool")) {
        if (!isComparisonOperator(operator)) {
          throw this.errorAt(this.peek(), "bool only follows a comparison.");
        }

        this.next();
        returnBool = true;
      }

      const matching: PromQLVectorMatching | undefined =
        this.parseVectorMatching(operator);

      // ^ binds to the right, every other operator to the left.
      const rhs: PromQLExpression =
        operator === PromQLBinaryOperator.Pow
          ? this.parseExpression(level)
          : this.parseExpression(level + 1);

      lhs = this.buildBinary({
        operator,
        token,
        lhs,
        rhs,
        returnBool,
        matching,
      });
    }
  }

  /*
   * A binary operation, its vector matching settled as PromQL's parser
   * settles it (PromQLParser.buildBinary): between two vectors one to one
   * by default (many to many for and, or, unless), between a vector and a
   * number none.
   */
  private buildBinary(data: {
    operator: PromQLBinaryOperator;
    token: Token;
    lhs: PromQLExpression;
    rhs: PromQLExpression;
    returnBool: boolean;
    matching: PromQLVectorMatching | undefined;
  }): PromQLExpression {
    const lhsType: PromQLValueType = getPromQLValueType(data.lhs);
    const rhsType: PromQLValueType = getPromQLValueType(data.rhs);
    const bothVectors: boolean =
      lhsType === PromQLValueType.InstantVector &&
      rhsType === PromQLValueType.InstantVector;

    if (
      isComparisonOperator(data.operator) &&
      !data.returnBool &&
      lhsType === PromQLValueType.Scalar &&
      rhsType === PromQLValueType.Scalar
    ) {
      throw this.errorAt(
        data.token,
        `a comparison between two numbers needs the bool modifier: write "${data.operator} bool".`,
      );
    }

    if (isSetOperator(data.operator) && !bothVectors) {
      throw this.errorAt(
        data.token,
        `"${data.operator}" works between two metric queries, not with a number.`,
      );
    }

    if (
      !bothVectors &&
      data.matching &&
      data.matching.matchingLabels.length > 0
    ) {
      throw this.errorAt(
        data.token,
        "vector matching (on or ignoring) only works between two metric queries.",
      );
    }

    let matching: PromQLVectorMatching | undefined = undefined;

    if (bothVectors) {
      matching = data.matching || {
        cardinality: PromQLVectorMatchCardinality.OneToOne,
        on: false,
        matchingLabels: [],
        include: [],
      };

      if (
        isSetOperator(data.operator) &&
        matching.cardinality === PromQLVectorMatchCardinality.OneToOne
      ) {
        matching = {
          ...matching,
          cardinality: PromQLVectorMatchCardinality.ManyToMany,
        };
      }
    }

    return {
      kind: PromQLNodeKind.Binary,
      operator: data.operator,
      lhs: data.lhs,
      rhs: data.rhs,
      returnBool: data.returnBool,
      matching,
      position: { start: data.lhs.position.start, end: data.rhs.position.end },
    };
  }
}

// Reads a LogQL query, or throws a PromQLError saying what is wrong and where.
export const parseLogQL: (query: string) => LogQLQuery = (
  query: string,
): LogQLQuery => {
  return new LogQLParser(query).parse();
};
