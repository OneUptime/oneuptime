import { JSONObject } from "Common/Types/JSON";

/*
 * Filter evaluator for log / span rows used by pipelines, drop
 * filters, and category processors. Two-stage by design:
 *
 *   compileFilter(query): tokenize -> parse -> pre-compile
 *      (build LIKE RegExp, build IN Set, mark always-true /
 *      always-false). Called once per filter rule at cache-load
 *      time (every 60s) for the project's small set of rules.
 *
 *   evaluateCompiledFilter(row, compiled): walks the AST against
 *      the row. Called once per record per rule on the ingest hot
 *      path. Zero allocation, zero string parsing, zero RegExp
 *      construction in this loop.
 *
 * The legacy evaluateFilter(row, query) is kept for places that
 * only have the raw query string (mostly tests). Per-record ingest
 * paths must call compileFilter first and reuse the result.
 *
 * Supports: =, !=, LIKE, IN, AND, OR, NOT, parentheses.
 * Field paths: top-level row fields, attributes.<key>, or bare
 * <key> resolved as attribute (with optional resource. prefix).
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

function getAttrValue(
  attrs: Record<string, unknown>,
  key: string,
): unknown | undefined {
  // Try exact key first
  if (attrs[key] !== undefined && attrs[key] !== null) {
    return attrs[key];
  }
  // Try with resource. prefix (OTel resource attributes)
  if (
    attrs[`resource.${key}`] !== undefined &&
    attrs[`resource.${key}`] !== null
  ) {
    return attrs[`resource.${key}`];
  }
  return undefined;
}

/*
 * Coerce a raw attribute / row value to a string for comparison.
 * Object-typed values are returned as "" rather than JSON.stringify'd:
 * meaningfully matching against the stringified form of a nested
 * attribute is a rare power-user case, and the per-record stringify
 * cost dominated bursty ingest. Users who need nested matching
 * should reach for a structured query at read time.
 */
function stringifyAttrValue(val: unknown): string {
  if (val === undefined || val === null) {
    return "";
  }
  if (typeof val === "object") {
    return "";
  }
  return String(val);
}

function getFieldValue(logRow: JSONObject, fieldPath: string): string {
  if (fieldPath.startsWith("attributes.")) {
    const attrKey: string = fieldPath.slice("attributes.".length);
    const attrs: Record<string, unknown> =
      (logRow["attributes"] as Record<string, unknown>) || {};
    return stringifyAttrValue(getAttrValue(attrs, attrKey));
  }

  const topLevel: unknown = logRow[fieldPath];
  if (topLevel !== undefined && topLevel !== null) {
    return stringifyAttrValue(topLevel);
  }

  /*
   * Fallback: treat the bare path as an attribute key. Lets users write e.g.
   * `url.full LIKE '%foo%'` without remembering the `attributes.` prefix,
   * since OTel semantic-convention keys are commonly referenced bare.
   */
  const attrs: Record<string, unknown> =
    (logRow["attributes"] as Record<string, unknown>) || {};
  return stringifyAttrValue(getAttrValue(attrs, fieldPath));
}

function tokenize(query: string): Array<Token> {
  const tokens: Array<Token> = [];
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

/*
 * AST nodes. ComparisonExpr carries pre-compiled auxiliary state
 * (likeRegex, likeSubstring, inSet) that is populated once in
 * compileExpr below and reused on every record evaluation. This is
 * the core of the 2.1b optimisation: a LIKE filter never builds a
 * RegExp at evaluation time and an IN filter never does an
 * Array.includes scan.
 */
interface FilterExpression {
  type: "comparison" | "and" | "or" | "not";
}

interface ComparisonExpr extends FilterExpression {
  type: "comparison";
  field: string;
  operator: string;
  value: string | Array<string>;
  /*
   * Populated when operator === "LIKE" and the pattern uses
   * SQL wildcards (`%`, `_`). null otherwise.
   */
  likeRegex?: RegExp | null;
  /*
   * Populated when operator === "LIKE" and the pattern contains
   * no `%`. Lowercase form for case-insensitive substring match.
   */
  likeSubstring?: string;
  /*
   * Populated when operator === "IN". O(1) membership lookup.
   */
  inSet?: Set<string>;
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

/*
 * Walk the parsed AST once and attach pre-compiled forms to each
 * ComparisonExpr node. This runs at filter-load time (60s cache)
 * so every record evaluation in the next window pays only the
 * comparison cost, not the LIKE-regex-build or IN-set-build cost.
 */
function compileExpr(expr: FilterExpression): void {
  switch (expr.type) {
    case "comparison": {
      const comp: ComparisonExpr = expr as ComparisonExpr;
      if (comp.operator === "LIKE") {
        const raw: string = String(comp.value);
        /*
         * Mirrors the runtime LIKE semantics: no `%` means
         * substring match (the UI labels this operator
         * "contains"); presence of `%` switches to SQL-style
         * wildcard regex. `_` keeps single-char-wildcard.
         */
        if (!raw.includes("%")) {
          comp.likeSubstring = raw.toLowerCase();
          comp.likeRegex = null;
        } else {
          const pattern: string = raw
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/%/g, ".*")
            .replace(/_/g, ".");
          comp.likeRegex = new RegExp(`^${pattern}$`, "i");
        }
      } else if (comp.operator === "IN") {
        const values: Array<string> = comp.value as Array<string>;
        comp.inSet = new Set(values);
      }
      return;
    }
    case "and": {
      const andExpr: AndExpr = expr as AndExpr;
      compileExpr(andExpr.left);
      compileExpr(andExpr.right);
      return;
    }
    case "or": {
      const orExpr: OrExpr = expr as OrExpr;
      compileExpr(orExpr.left);
      compileExpr(orExpr.right);
      return;
    }
    case "not": {
      const notExpr: NotExpr = expr as NotExpr;
      compileExpr(notExpr.expr);
      return;
    }
    default:
      return;
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
          /*
           * Pre-compiled at filter-load time; both fields are set
           * by compileExpr above. likeRegex === null means the
           * pattern had no `%` and we should substring-match.
           */
          if (comp.likeRegex) {
            return comp.likeRegex.test(fieldVal);
          }
          const needle: string = comp.likeSubstring ?? "";
          return fieldVal.toLowerCase().includes(needle);
        }
        case "IN": {
          // Pre-compiled Set lookup. O(1) vs the old Array.includes.
          if (comp.inSet) {
            return comp.inSet.has(fieldVal);
          }
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

/*
 * Public compiled-filter representation. Three states so the
 * caller doesn't have to retain the raw query string and re-parse
 * on every record:
 *
 *   kind: "always-true"   — empty / whitespace-only query.
 *   kind: "always-false"  — query failed to parse. Matches the
 *                           legacy "unparsable filter does not
 *                           match" safe default.
 *   kind: "expr"          — normal compiled AST with pre-built
 *                           LIKE/IN auxiliary state.
 */
export type CompiledFilter =
  | { kind: "always-true" }
  | { kind: "always-false" }
  | { kind: "expr"; expr: FilterExpression };

export function compileFilter(filterQuery: string): CompiledFilter {
  if (!filterQuery || filterQuery.trim().length === 0) {
    return { kind: "always-true" };
  }

  try {
    const tokens: Array<Token> = tokenize(filterQuery);
    if (tokens.length === 0) {
      return { kind: "always-true" };
    }
    const parser: Parser = new Parser(tokens);
    const expr: FilterExpression = parser.parse();
    compileExpr(expr);
    return { kind: "expr", expr };
  } catch {
    // Match the legacy safe default: an unparsable filter never matches.
    return { kind: "always-false" };
  }
}

export function evaluateCompiledFilter(
  logRow: JSONObject,
  compiled: CompiledFilter,
): boolean {
  switch (compiled.kind) {
    case "always-true":
      return true;
    case "always-false":
      return false;
    case "expr":
      return evaluateExpr(logRow, compiled.expr);
    default:
      return false;
  }
}

/*
 * Legacy entry point retained for code paths that only have the
 * raw filter query (mostly tests). Production ingest paths must
 * call compileFilter once at cache-load time and reuse the result.
 */
export function evaluateFilter(
  logRow: JSONObject,
  filterQuery: string,
): boolean {
  return evaluateCompiledFilter(logRow, compileFilter(filterQuery));
}

export default evaluateFilter;
