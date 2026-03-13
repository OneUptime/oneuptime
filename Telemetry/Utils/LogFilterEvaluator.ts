import { JSONObject } from "Common/Types/JSON";

/*
 * Simple filter evaluator for log rows used by pipelines and drop filters.
 * Supports: =, !=, LIKE, IN, AND, OR, NOT, parentheses
 * Field paths: severityText, body, serviceId, attributes.<key>
 */

interface Token {
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

function getFieldValue(logRow: JSONObject, fieldPath: string): string {
  if (fieldPath.startsWith("attributes.")) {
    const attrKey: string = fieldPath.slice("attributes.".length);
    const attrs: Record<string, unknown> =
      (logRow["attributes"] as Record<string, unknown>) || {};
    const val: unknown = attrs[attrKey];
    if (val === undefined || val === null) {
      return "";
    }
    if (typeof val === "object") {
      return JSON.stringify(val);
    }
    return String(val);
  }

  const val: unknown = logRow[fieldPath];
  if (val === undefined || val === null) {
    return "";
  }
  return String(val);
}

function tokenize(query: string): Array<Token> {
  const tokens: Array<Token> = [];
  let i: number = 0;
  const len: number = query.length;

  while (i < len) {
    // Skip whitespace
    if ((/\s/).test(query[i]!)) {
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
    while (i < len && !(/[\s()=!]/).test(query[i]!)) {
      word += query[i];
      i++;
    }
    if (word.length > 0) {
      // Determine if this is a field or a value based on context
      const lastToken: Token | undefined = tokens[tokens.length - 1];
      if (lastToken && lastToken.type === "operator") {
        tokens.push({ type: "value", value: word });
      } else {
        tokens.push({ type: "field", value: word });
      }
    }
  }

  return tokens;
}

interface FilterExpression {
  type: "comparison" | "and" | "or" | "not";
}

interface ComparisonExpr extends FilterExpression {
  type: "comparison";
  field: string;
  operator: string;
  value: string | Array<string>;
}

interface AndExpr extends FilterExpression {
  type: "and";
  left: FilterExpression;
  right: FilterExpression;
}

interface OrExpr extends FilterExpression {
  type: "or";
  left: FilterExpression;
  right: FilterExpression;
}

interface NotExpr extends FilterExpression {
  type: "not";
  expr: FilterExpression;
}

class Parser {
  private tokens: Array<Token>;
  private pos: number;

  public constructor(tokens: Array<Token>) {
    this.tokens = tokens;
    this.pos = 0;
  }

  public parse(): FilterExpression {
    const expr: FilterExpression = this.parseOr();
    return expr;
  }

  private parseOr(): FilterExpression {
    let left: FilterExpression = this.parseAnd();
    while (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "or"
    ) {
      this.pos++;
      const right: FilterExpression = this.parseAnd();
      left = { type: "or", left, right } as OrExpr;
    }
    return left;
  }

  private parseAnd(): FilterExpression {
    let left: FilterExpression = this.parseUnary();
    while (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "and"
    ) {
      this.pos++;
      const right: FilterExpression = this.parseUnary();
      left = { type: "and", left, right } as AndExpr;
    }
    return left;
  }

  private parseUnary(): FilterExpression {
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "not"
    ) {
      this.pos++;
      const expr: FilterExpression = this.parseUnary();
      return { type: "not", expr } as NotExpr;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FilterExpression {
    if (
      this.pos < this.tokens.length &&
      this.tokens[this.pos]!.type === "lparen"
    ) {
      this.pos++; // skip (
      const expr: FilterExpression = this.parseOr();
      if (
        this.pos < this.tokens.length &&
        this.tokens[this.pos]!.type === "rparen"
      ) {
        this.pos++; // skip )
      }
      return expr;
    }

    // Comparison: field operator value
    const fieldToken: Token | undefined = this.tokens[this.pos];
    if (!fieldToken || fieldToken.type !== "field") {
      throw new Error(
        `Expected field at position ${this.pos}, got: ${fieldToken?.type || "end of input"}`,
      );
    }
    this.pos++;

    const opToken: Token | undefined = this.tokens[this.pos];
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
      } as ComparisonExpr;
    }

    const valToken: Token | undefined = this.tokens[this.pos];
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
    } as ComparisonExpr;
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

function evaluateExpr(logRow: JSONObject, expr: FilterExpression): boolean {
  switch (expr.type) {
    case "comparison": {
      const comp: ComparisonExpr = expr as ComparisonExpr;
      const fieldVal: string = getFieldValue(logRow, comp.field);

      switch (comp.operator) {
        case "=":
          return fieldVal === comp.value;
        case "!=":
          return fieldVal !== comp.value;
        case "LIKE": {
          // Convert SQL LIKE pattern to regex: % -> .*, _ -> .
          const pattern: string = String(comp.value)
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // escape regex chars first
            .replace(/%/g, ".*")
            .replace(/_/g, ".");
          return new RegExp(`^${pattern}$`, "i").test(fieldVal);
        }
        case "IN": {
          const values: Array<string> = comp.value as Array<string>;
          return values.includes(fieldVal);
        }
        default:
          return false;
      }
    }
    case "and": {
      const andExpr: AndExpr = expr as AndExpr;
      return (
        evaluateExpr(logRow, andExpr.left) &&
        evaluateExpr(logRow, andExpr.right)
      );
    }
    case "or": {
      const orExpr: OrExpr = expr as OrExpr;
      return (
        evaluateExpr(logRow, orExpr.left) || evaluateExpr(logRow, orExpr.right)
      );
    }
    case "not": {
      const notExpr: NotExpr = expr as NotExpr;
      return !evaluateExpr(logRow, notExpr.expr);
    }
    default:
      return false;
  }
}

export function evaluateFilter(
  logRow: JSONObject,
  filterQuery: string,
): boolean {
  if (!filterQuery || filterQuery.trim().length === 0) {
    return true; // empty filter matches everything
  }

  try {
    const tokens: Array<Token> = tokenize(filterQuery);
    if (tokens.length === 0) {
      return true;
    }
    const parser: Parser = new Parser(tokens);
    const expr: FilterExpression = parser.parse();
    return evaluateExpr(logRow, expr);
  } catch {
    // If filter can't be parsed, don't match (safe default)
    return false;
  }
}

export default evaluateFilter;
