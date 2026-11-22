import { JSONObject } from "Common/Types/JSON";
import escapeRegExp from "Common/Utils/RegExpEscape";
import {
  getLinearRegExp,
  LinearRegExpHandle,
} from "Common/Utils/LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternWorkLimitError,
} from "Common/Utils/LinearRegExp/PatternProblem";
import { patternWorkRefusesQuestions } from "Common/Utils/LinearRegExp/PatternWork";
import { readOwnValue } from "Common/Utils/LookupTable";
import {
  parseTelemetryFilterTokens,
  TelemetryFilterAnd,
  TelemetryFilterComparison,
  TelemetryFilterExpression,
  TelemetryFilterNot,
  TelemetryFilterOr,
  TelemetryFilterToken,
  tokenizeTelemetryFilterQuery,
} from "Common/Utils/Telemetry/TelemetryFilterQuery";

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

function getAttrValue(
  attrs: Record<string, unknown>,
  key: string,
): unknown | undefined {
  /*
   * Try exact key first: the row's own keys only, as a filter may name a key
   * such as constructor, which every object inherits and no row carries
   * unless it was given one.
   */
  const exact: unknown = readOwnValue(attrs, key);
  if (exact !== undefined && exact !== null) {
    return exact;
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

function stringifyAttrValue(val: unknown): string {
  if (val === undefined || val === null) {
    return "";
  }
  if (typeof val === "object") {
    return JSON.stringify(val);
  }
  return String(val);
}

/*
 * Resolve a user-written field path against a log/span row and return it
 * as a string. Exported because the pipeline's grok processor reads its
 * source field with exactly these semantics - a grok `source` of
 * "body", "attributes.message" or a bare attribute key has to mean the
 * same thing it means in a filter query.
 */
export function getRowFieldValue(
  logRow: JSONObject,
  fieldPath: string,
): string {
  if (fieldPath.startsWith("attributes.")) {
    const attrKey: string = fieldPath.slice("attributes.".length);
    const attrs: Record<string, unknown> =
      (logRow["attributes"] as Record<string, unknown>) || {};
    return stringifyAttrValue(getAttrValue(attrs, attrKey));
  }

  const topLevel: unknown = readOwnValue(logRow, fieldPath);
  if (topLevel !== undefined && topLevel !== null) {
    return String(topLevel);
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

/*
 * AST nodes, as the shared parser reads a query
 * (Common/Utils/Telemetry/TelemetryFilterQuery: one parser for ingest and
 * for the count a drop filter's form shows, #10436). ComparisonExpr carries
 * pre-compiled auxiliary state (likeRegex, likeSubstring, inSet) that is
 * populated once in compileExpr below and reused on every record
 * evaluation. This is the core of the 2.1b optimisation: a LIKE filter
 * never builds a RegExp at evaluation time and an IN filter never does an
 * Array.includes scan.
 */
type FilterExpression = TelemetryFilterExpression;

interface ComparisonExpr extends TelemetryFilterComparison {
  /*
   * Populated when operator === "LIKE" and the pattern uses
   * SQL wildcards (`%`, `_`). null otherwise. Run on the linear-time
   * matcher: every `%` is a run of any text, and a filter a project
   * writes with many of them must cost time in line with the record,
   * not a power of its length (Utils/LinearRegExp). Kept as a handle:
   * the compiled pattern stays in the matcher's bounded cache, not in
   * the minute-long cache of the project's filters.
   */
  likePattern?: LinearRegExpHandle | null;
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

type AndExpr = TelemetryFilterAnd;

type OrExpr = TelemetryFilterOr;

type NotExpr = TelemetryFilterNot;

/*
 * A LIKE condition with no answer: its pattern needed more work than the
 * value - or what is left of the batch's work allowance
 * (Common/Utils/LinearRegExp/PatternWork.ts) - allows, or could not be
 * compiled. A filter with one does not apply to the record, whatever the
 * rest of it says: "no answer" read as "does not match" would make NOT
 * LIKE hold on a value nobody read to the end.
 */
class UnansweredConditionError extends Error {
  public constructor() {
    super("A LIKE condition of the filter has no answer for this record.");
    this.name = "UnansweredConditionError";
  }
}

/*
 * Made once: a batch can have millions of conditions without an answer once
 * its allowance is spent, and an error's stack costs more than the question.
 */
const UNANSWERED_CONDITION: UnansweredConditionError =
  new UnansweredConditionError();

function isUnansweredPatternError(error: unknown): boolean {
  return (
    error instanceof PatternWorkLimitError ||
    error instanceof PatternProblemError ||
    error instanceof SyntaxError
  );
}

// Whether a LIKE pattern matches the value; throws when there is no answer.
function likeMatches(pattern: LinearRegExpHandle, value: string): boolean {
  if (patternWorkRefusesQuestions(value)) {
    // The batch's work allowance is spent: no answer, without a lookup.
    throw UNANSWERED_CONDITION;
  }

  try {
    return pattern.get().test(value);
  } catch (error: unknown) {
    if (isUnansweredPatternError(error)) {
      throw UNANSWERED_CONDITION;
    }

    throw error;
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
          comp.likePattern = null;
        } else {
          const pattern: string = escapeRegExp(raw)
            .replace(/%/g, ".*")
            .replace(/_/g, ".");
          // Too long to run: compileFilter's catch makes the filter match nothing.
          const likePattern: LinearRegExpHandle = new LinearRegExpHandle(
            `^${pattern}$`,
            "i",
          );

          try {
            // Too large to run: compileFilter's catch makes the filter match nothing.
            likePattern.get();
          } catch (error: unknown) {
            /*
             * Not compiled only because the batch's work allowance is spent:
             * the pattern is compiled when a record is asked about.
             */
            if (!(error instanceof PatternWorkLimitError)) {
              throw error;
            }
          }

          comp.likePattern = likePattern;
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
      const fieldVal: string = getRowFieldValue(logRow, comp.field);

      switch (comp.operator) {
        case "=":
          return fieldVal === comp.value;
        case "!=":
          return fieldVal !== comp.value;
        case "LIKE": {
          /*
           * Use the forms compileExpr attached at filter-load time — this
           * case runs once per record per rule, and rebuilding the RegExp
           * (three escape passes + construction) per record is exactly the
           * cost the two-stage compile design exists to avoid.
           */
          if (comp.likeSubstring !== undefined) {
            return fieldVal.toLowerCase().includes(comp.likeSubstring);
          }
          if (comp.likePattern) {
            return likeMatches(comp.likePattern, fieldVal);
          }

          /*
           * Uncompiled AST (the legacy evaluateFilter path, which parses a
           * raw query string per call): mirror compileExpr's semantics
           * inline. The UI labels this operator "contains", so a value
           * without any `%` wildcard means substring match — not exact
           * match. Only honor SQL LIKE semantics (`%` -> .*, `_` -> .) when
           * the user explicitly uses `%` in the pattern.
           */
          const raw: string = String(comp.value);
          if (!raw.includes("%")) {
            return fieldVal.toLowerCase().includes(raw.toLowerCase());
          }
          const pattern: string = escapeRegExp(raw)
            .replace(/%/g, ".*")
            .replace(/_/g, ".");
          try {
            return getLinearRegExp(`^${pattern}$`, "i").test(fieldVal);
          } catch (error: unknown) {
            if (error instanceof PatternWorkLimitError) {
              throw UNANSWERED_CONDITION;
            }

            // A LIKE pattern too large to run matches nothing.
            return false;
          }
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

/*
 * How to compile a query that carries no predicate at all (empty,
 * whitespace-only, or tokenizing to nothing).
 *
 * `emptyQueryMatches: true` (the default) is right for PIPELINES and
 * severity categories: a processor with no filter is meant to apply to
 * every record, and matching everything only transforms rows.
 *
 * `emptyQueryMatches: false` is mandatory for DROP FILTERS, where
 * matching everything DELETES everything. A drop filter saved with a
 * blank query used to silently become "discard 100% of this project's
 * logs" — see LogDropFilterService.loadDropFilters.
 */
export interface CompileFilterOptions {
  emptyQueryMatches?: boolean | undefined;
}

export function compileFilter(
  filterQuery: string,
  options?: CompileFilterOptions,
): CompiledFilter {
  const emptyQueryMatches: boolean = options?.emptyQueryMatches !== false;

  const forEmptyQuery: CompiledFilter = emptyQueryMatches
    ? { kind: "always-true" }
    : { kind: "always-false" };

  if (!filterQuery || filterQuery.trim().length === 0) {
    return forEmptyQuery;
  }

  try {
    const tokens: Array<TelemetryFilterToken> =
      tokenizeTelemetryFilterQuery(filterQuery);
    if (tokens.length === 0) {
      return forEmptyQuery;
    }
    const expr: FilterExpression = parseTelemetryFilterTokens(tokens);
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
      try {
        return evaluateExpr(logRow, compiled.expr);
      } catch (error: unknown) {
        if (error instanceof UnansweredConditionError) {
          // A condition with no answer: the filter does not apply.
          return false;
        }

        throw error;
      }
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
