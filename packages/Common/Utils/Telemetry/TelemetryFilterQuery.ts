/*
 * THE QUERY A DROP FILTER, A PIPELINE OR A CATEGORY PROCESSOR PICKS RECORDS
 * WITH, AS ONE PARSER READS IT.
 *
 * `severityText = 'Debug' AND attributes.http.route LIKE '%/health%'`: a
 * condition is a field, an operator and a value; conditions are joined by
 * AND, OR and NOT, and grouped by parentheses.
 *
 *   - Operators: =, !=, LIKE, IN (a list in parentheses).
 *   - Fields: a top-level field of the row (severityText, body, name,
 *     primaryEntityId ...), attributes.<key>, or a bare <key>, which is read
 *     as an attribute when the row has no such field.
 *
 * Ingest compiles a project's filters with this parser and evaluates them
 * on every record (App/FeatureSet/Telemetry/Utils/LogFilterEvaluator.ts),
 * and the server reads the same query as a ClickHouse condition to count
 * what a filter would take before it is saved (#10436,
 * Server/Utils/Telemetry/TelemetryFilterQuerySql.ts) - one parser, so the
 * count and the drop read a query the same way. It moved here from the
 * evaluator unchanged.
 *
 * The parser throws on a query it cannot read: ingest then makes the
 * filter match nothing (compileFilter), and so does the count.
 */

export interface TelemetryFilterToken {
  type:
    | "field"
    | "operator"
    | "value"
    | "and"
    | "or"
    | "not"
    | "lparen"
    | "rparen";
  value: string;
}

export interface TelemetryFilterExpression {
  type: "comparison" | "and" | "or" | "not";
}

export interface TelemetryFilterComparison extends TelemetryFilterExpression {
  type: "comparison";
  field: string;
  // "=", "!=", "LIKE" or "IN".
  operator: string;
  // A list for IN; the value as written otherwise.
  value: string | Array<string>;
}

export interface TelemetryFilterAnd extends TelemetryFilterExpression {
  type: "and";
  left: TelemetryFilterExpression;
  right: TelemetryFilterExpression;
}

export interface TelemetryFilterOr extends TelemetryFilterExpression {
  type: "or";
  left: TelemetryFilterExpression;
  right: TelemetryFilterExpression;
}

export interface TelemetryFilterNot extends TelemetryFilterExpression {
  type: "not";
  expr: TelemetryFilterExpression;
}

export function tokenizeTelemetryFilterQuery(
  query: string,
): Array<TelemetryFilterToken> {
  const tokens: Array<TelemetryFilterToken> = [];
  let i: number = 0;
  const len: number = query.length;

  while (i < len) {
    // Skip whitespace
    // eslint-disable-next-line wrap-regex
    if (/\s/.test(query[i]!)) {
      i++;
      continue;
    }

    // Parentheses
    if (query[i] === "(") {
      tokens.push({ type: "lparen", value: "(" });
      i++;
      continue;
    }
    if (query[i] === ")") {
      tokens.push({ type: "rparen", value: ")" });
      i++;
      continue;
    }

    // Check for keywords (AND, OR, NOT, LIKE, IN)
    const remaining: string = query.slice(i);
    const keywordMatch: RegExpMatchArray | null = remaining.match(
      /^(AND|OR|NOT|LIKE|IN|!=)\b/i,
    );
    if (keywordMatch) {
      const kw: string = keywordMatch[1]!.toUpperCase();
      if (kw === "AND") {
        tokens.push({ type: "and", value: "AND" });
      } else if (kw === "OR") {
        tokens.push({ type: "or", value: "OR" });
      } else if (kw === "NOT") {
        tokens.push({ type: "not", value: "NOT" });
      } else if (kw === "LIKE" || kw === "IN") {
        tokens.push({ type: "operator", value: kw });
      } else if (kw === "!=") {
        tokens.push({ type: "operator", value: "!=" });
      }
      i += keywordMatch[0]!.length;
      continue;
    }

    // != operator (check before = to avoid conflict)
    if (query[i] === "!" && i + 1 < len && query[i + 1] === "=") {
      tokens.push({ type: "operator", value: "!=" });
      i += 2;
      continue;
    }

    // = operator
    if (query[i] === "=") {
      tokens.push({ type: "operator", value: "=" });
      i++;
      continue;
    }

    // Quoted string value
    if (query[i] === "'" || query[i] === '"') {
      const quote: string = query[i]!;
      i++;
      let val: string = "";
      while (i < len && query[i] !== quote) {
        if (query[i] === "\\" && i + 1 < len) {
          i++;
          val += query[i];
        } else {
          val += query[i];
        }
        i++;
      }
      i++; // skip closing quote
      tokens.push({ type: "value", value: val });
      continue;
    }

    // Field name or unquoted value
    let word: string = "";
    // eslint-disable-next-line wrap-regex
    while (i < len && !/[\s()=!]/.test(query[i]!)) {
      word += query[i];
      i++;
    }
    if (word.length > 0) {
      // Determine if this is a field or a value based on context
      const lastToken: TelemetryFilterToken | undefined =
        tokens[tokens.length - 1];
      if (lastToken && lastToken.type === "operator") {
        tokens.push({ type: "value", value: word });
      } else {
        tokens.push({ type: "field", value: word });
      }
    }
  }

  return tokens;
}

class Parser {
  private tokens: Array<TelemetryFilterToken>;
  private pos: number;

  public constructor(tokens: Array<TelemetryFilterToken>) {
    this.tokens = tokens;
    this.pos = 0;
  }

  public parse(): TelemetryFilterExpression {
    const expr: TelemetryFilterExpression = this.parseOr();
    return expr;
  }

  private parseOr(): TelemetryFilterExpression {
    let left: TelemetryFilterExpression = this.parseAnd();
    while (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "or"
    ) {
      this.pos++;
      const right: TelemetryFilterExpression = this.parseAnd();
      left = { type: "or", left, right } as TelemetryFilterOr;
    }
    return left;
  }

  private parseAnd(): TelemetryFilterExpression {
    let left: TelemetryFilterExpression = this.parseUnary();
    while (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "and"
    ) {
      this.pos++;
      const right: TelemetryFilterExpression = this.parseUnary();
      left = { type: "and", left, right } as TelemetryFilterAnd;
    }
    return left;
  }

  private parseUnary(): TelemetryFilterExpression {
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "not"
    ) {
      this.pos++;
      const expr: TelemetryFilterExpression = this.parseUnary();
      return { type: "not", expr } as TelemetryFilterNot;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): TelemetryFilterExpression {
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "lparen"
    ) {
      this.pos++; // skip (
      const expr: TelemetryFilterExpression = this.parseOr();
      if (
        this.pos < this.tokens.length &&
        this.tokens[this.pos]!.type === "rparen"
      ) {
        this.pos++; // skip )
      }
      return expr;
    }

    // Comparison: field operator value
    const fieldToken: TelemetryFilterToken | undefined = this.tokens[this.pos];
    if (!fieldToken || fieldToken.type !== "field") {
      throw new Error(
        `Expected field at position ${this.pos}, got: ${fieldToken?.type || "end of input"}`,
      );
    }
    this.pos++;

    const opToken: TelemetryFilterToken | undefined = this.tokens[this.pos];
    if (!opToken || opToken.type !== "operator") {
      throw new Error(
        `Expected operator at position ${this.pos}, got: ${opToken?.type || "end of input"}`,
      );
    }
    this.pos++;

    if (opToken.value === "IN") {
      // Parse IN (val1, val2, val3)
      const values: Array<string> = this.parseInValues();
      return {
        type: "comparison",
        field: fieldToken.value,
        operator: "IN",
        value: values,
      } as TelemetryFilterComparison;
    }

    const valToken: TelemetryFilterToken | undefined = this.tokens[this.pos];
    if (!valToken || valToken.type !== "value") {
      throw new Error(
        `Expected value at position ${this.pos}, got: ${valToken?.type || "end of input"}`,
      );
    }
    this.pos++;

    return {
      type: "comparison",
      field: fieldToken.value,
      operator: opToken.value,
      value: valToken.value,
    } as TelemetryFilterComparison;
  }

  private parseInValues(): Array<string> {
    const values: Array<string> = [];

    // Expect (
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "lparen"
    ) {
      this.pos++;
    }

    while (this.pos < this.tokens.length) {
      if (this.tokens[this.pos]!.type === "rparen") {
        this.pos++;
        break;
      }
      if (this.tokens[this.pos]!.type === "value") {
        values.push(this.tokens[this.pos]!.value);
        this.pos++;
      } else {
        this.pos++; // skip commas etc.
      }
    }

    return values;
  }
}

/*
 * The expression a list of tokens reads as. Throws on tokens that do not
 * make one: a field with no operator, an operator with no value.
 */
export function parseTelemetryFilterTokens(
  tokens: Array<TelemetryFilterToken>,
): TelemetryFilterExpression {
  return new Parser(tokens).parse();
}

/*
 * A query as the expression it reads as; null for a query with no
 * condition at all (empty, or only whitespace). Throws on a query it cannot
 * read.
 */
export function parseTelemetryFilterQuery(
  query: string,
): TelemetryFilterExpression | null {
  if (!query || query.trim().length === 0) {
    return null;
  }

  const tokens: Array<TelemetryFilterToken> =
    tokenizeTelemetryFilterQuery(query);

  if (tokens.length === 0) {
    return null;
  }

  return parseTelemetryFilterTokens(tokens);
}

/*
 * A query as the expression it reads as, or how it reads otherwise: "empty"
 * with no condition, "unreadable" when it does not parse - which ingest
 * makes match nothing (compileFilter's always-false).
 */
export type ReadTelemetryFilterQuery =
  | { kind: "empty" }
  | { kind: "unreadable" }
  | { kind: "expr"; expr: TelemetryFilterExpression };

export function readTelemetryFilterQuery(
  query: string | null | undefined,
): ReadTelemetryFilterQuery {
  try {
    const expr: TelemetryFilterExpression | null = parseTelemetryFilterQuery(
      query || "",
    );

    return expr ? { kind: "expr", expr } : { kind: "empty" };
  } catch {
    return { kind: "unreadable" };
  }
}

// Every comparison of an expression, in the order they are written.
export function getTelemetryFilterComparisons(
  expr: TelemetryFilterExpression,
): Array<TelemetryFilterComparison> {
  switch (expr.type) {
    case "comparison":
      return [expr as TelemetryFilterComparison];
    case "and":
    case "or": {
      const pair: TelemetryFilterAnd | TelemetryFilterOr = expr as
        | TelemetryFilterAnd
        | TelemetryFilterOr;

      return [
        ...getTelemetryFilterComparisons(pair.left),
        ...getTelemetryFilterComparisons(pair.right),
      ];
    }
    case "not":
      return getTelemetryFilterComparisons((expr as TelemetryFilterNot).expr);
    default:
      return [];
  }
}
