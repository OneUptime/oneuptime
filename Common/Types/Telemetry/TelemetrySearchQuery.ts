import EndsWith from "../BaseDatabase/EndsWith";
import GreaterThan from "../BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../BaseDatabase/GreaterThanOrEqual";
import Includes from "../BaseDatabase/Includes";
import IncludesNone from "../BaseDatabase/IncludesNone";
import IsNull from "../BaseDatabase/IsNull";
import LessThan from "../BaseDatabase/LessThan";
import LessThanOrEqual from "../BaseDatabase/LessThanOrEqual";
import NotContains from "../BaseDatabase/NotContains";
import NotEqual from "../BaseDatabase/NotEqual";
import NotNull from "../BaseDatabase/NotNull";
import NotWildcard from "../BaseDatabase/NotWildcard";
import Search from "../BaseDatabase/Search";
import StartsWith from "../BaseDatabase/StartsWith";
import Wildcard from "../BaseDatabase/Wildcard";
import {
  escapeWildcards,
  hasWildcard,
  unescapeWildcards,
} from "../BaseDatabase/WildcardPattern";
import { JSONObject } from "../JSON";

/*
 * The OneUptime telemetry search language — one grammar for logs, traces,
 * metrics, exceptions and every other signal with an attributes map.
 *
 * Before this module each explorer carried its own tokenizer and its own idea
 * of what a value meant: logs stripped `*` and searched for a substring,
 * traces needed a bespoke `~` marker for "contains" and read `*` literally,
 * metrics and exceptions supported nothing but equality. The same keystrokes
 * produced three different queries, and `@platform.team:a*` — the shape every
 * search UI in the industry teaches — matched nothing anywhere.
 *
 *   free text            connection refused     message contains the phrase
 *   "quoted phrase"      "out of memory"        keeps spaces together
 *   field:value          severity:error         a top-level column
 *   @attribute:value     @http.status_code:500  an attributes map entry
 *   -<filter>            -severity:debug        negate any filter
 *
 * and, as the value of either a field or an attribute:
 *
 *   abc                  exact match (case-sensitive, like the stored value)
 *   a*   *a   a*b        glob — `*` is any run of characters
 *   a?c                  glob — `?` is exactly one character
 *   \*                   a literal asterisk (also \? and \\)
 *   *                    the key exists with a non-empty value
 *   ~abc                 contains
 *   !abc                 not equal
 *   >10  >=10  <10  <=10 numeric comparison
 *   (a OR b)   [a, b]    any of these
 *   "a b*"               quotes protect spaces, NOT wildcards
 *
 * Negation composes with all of them: `-@k:a*` is "does not match a*",
 * `-@k:>10` is "<= 10", `-@k:(a OR b)` is "none of these", `-@k:*` is "the
 * key is absent or empty".
 */

export enum SearchTokenType {
  FreeText = "FreeText",
  Field = "Field",
  Attribute = "Attribute",
}

export enum SearchValueOperator {
  Equals = "Equals",
  NotEquals = "NotEquals",
  Contains = "Contains",
  NotContains = "NotContains",
  StartsWith = "StartsWith",
  EndsWith = "EndsWith",
  Wildcard = "Wildcard",
  NotWildcard = "NotWildcard",
  GreaterThan = "GreaterThan",
  GreaterThanOrEqual = "GreaterThanOrEqual",
  LessThan = "LessThan",
  LessThanOrEqual = "LessThanOrEqual",
  In = "In",
  NotIn = "NotIn",
  Exists = "Exists",
  NotExists = "NotExists",
}

export interface SearchValuePredicate {
  operator: SearchValueOperator;
  /**
   * The single literal this predicate compares against. For a glob it is the
   * glob as typed (escapes intact) so it can be re-rendered; for everything
   * else the escapes are already resolved. Empty for Exists / NotExists.
   */
  value: string;
  /** Populated for In / NotIn only. */
  values: Array<string>;
}

export interface SearchToken {
  type: SearchTokenType;
  /** Field name or attribute key, with the user's casing preserved. */
  key: string;
  predicate: SearchValuePredicate;
  negated: boolean;
  /** The token exactly as typed, so a search string can be rebuilt. */
  raw: string;
}

export interface ParseSearchQueryOptions {
  /**
   * Field names this surface understands, lowercased. A `name: value` token
   * (a space after the colon) is only glued back together for one of these or
   * for an `@attribute`, so ordinary prose like "note: check this" stays free
   * text rather than becoming a filter on a field called "note".
   */
  knownFieldKeys?: Set<string> | undefined;
  /**
   * Map a user-facing field name to the column it filters, e.g.
   * `severity → severityText`. Looked up case-insensitively. Attribute keys
   * are never aliased.
   */
  fieldAliases?: Record<string, string> | undefined;
}

const BOOLEAN_KEYWORDS: Set<string> = new Set(["AND", "OR", "NOT"]);

const LIST_SEPARATOR_REGEX: RegExp = /\s+OR\s+|,/i;

const NUMERIC_REGEX: RegExp = /^-?\d+(\.\d+)?$/;

const WHITESPACE_REGEX: RegExp = /\s/;

const RESERVED_PREFIX_REGEX: RegExp = /(["~!<>()[\]])/g;

const LEADING_DASH_REGEX: RegExp = /^-/;

type StripQuotesFunction = (value: string) => string;

/** Remove one layer of surrounding double quotes, if present. */
export const stripQuotes: StripQuotesFunction = (value: string): string => {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }

  return value;
};

type TokenizeSearchQueryFunction = (
  raw: string,
  options?: ParseSearchQueryOptions | undefined,
) => Array<string>;

/**
 * Split a search string into raw tokens.
 *
 * A character scanner rather than a regex, because the three things that have
 * to survive splitting all nest: double quotes (`name:"SELECT wp_options"`),
 * bracketed value lists (`@k:(a OR b)`), and backslash escapes (`@k:a\ b`).
 * The regex tokenizers this replaces each handled one of the three and
 * silently mangled the others.
 */
export const tokenizeSearchQuery: TokenizeSearchQueryFunction = (
  raw: string,
  options?: ParseSearchQueryOptions | undefined,
): Array<string> => {
  const tokens: Array<string> = [];
  let current: string = "";
  let inQuotes: boolean = false;
  let depth: number = 0;

  type IsAwaitingValueFunction = () => boolean;

  /*
   * True when `current` is a field prefix still waiting for its value —
   * `severity:` or `@http.method:`. Only then does a space get absorbed
   * instead of ending the token, which is what makes `name: POST` and
   * `@k: "a b"` work without turning every colon in prose into a filter.
   */
  const isAwaitingValue: IsAwaitingValueFunction = (): boolean => {
    if (!current.endsWith(":")) {
      return false;
    }

    const prefix: string = current.slice(0, -1).replace(/^-/, "");

    if (prefix.startsWith("@")) {
      return prefix.length > 1;
    }

    return Boolean(options?.knownFieldKeys?.has(prefix.toLowerCase()));
  };

  for (let index: number = 0; index < raw.length; index++) {
    const character: string = raw[index]!;

    if (character === "\\") {
      // Escapes are preserved verbatim; the value grammar resolves them.
      current += character;

      if (index + 1 < raw.length) {
        current += raw[index + 1]!;
        index++;
      }

      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      current += character;
      continue;
    }

    if (!inQuotes && (character === "(" || character === "[")) {
      depth++;
      current += character;
      continue;
    }

    if (!inQuotes && (character === ")" || character === "]")) {
      depth = Math.max(0, depth - 1);
      current += character;
      continue;
    }

    if (character === " " && !inQuotes && depth === 0) {
      if (isAwaitingValue()) {
        // Absorb the space: the next word is this field's value.
        continue;
      }

      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }

      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
};

type ParseSearchValueFunction = (
  rawValue: string,
  negated?: boolean | undefined,
) => SearchValuePredicate;

type NegateOperatorFunction = (
  operator: SearchValueOperator,
) => SearchValueOperator;

/*
 * Every operator has an exact opposite, so `-` composes with all of them
 * instead of being silently dropped on the ones the old log parser could not
 * express (its `-@k:a*` produced a POSITIVE contains — the complement of what
 * was asked for).
 */
const negateOperator: NegateOperatorFunction = (
  operator: SearchValueOperator,
): SearchValueOperator => {
  switch (operator) {
    case SearchValueOperator.Equals:
      return SearchValueOperator.NotEquals;
    case SearchValueOperator.NotEquals:
      return SearchValueOperator.Equals;
    case SearchValueOperator.Contains:
      return SearchValueOperator.NotContains;
    case SearchValueOperator.NotContains:
      return SearchValueOperator.Contains;
    case SearchValueOperator.Wildcard:
      return SearchValueOperator.NotWildcard;
    case SearchValueOperator.NotWildcard:
      return SearchValueOperator.Wildcard;
    case SearchValueOperator.In:
      return SearchValueOperator.NotIn;
    case SearchValueOperator.NotIn:
      return SearchValueOperator.In;
    case SearchValueOperator.Exists:
      return SearchValueOperator.NotExists;
    case SearchValueOperator.NotExists:
      return SearchValueOperator.Exists;
    case SearchValueOperator.GreaterThan:
      return SearchValueOperator.LessThanOrEqual;
    case SearchValueOperator.GreaterThanOrEqual:
      return SearchValueOperator.LessThan;
    case SearchValueOperator.LessThan:
      return SearchValueOperator.GreaterThanOrEqual;
    case SearchValueOperator.LessThanOrEqual:
      return SearchValueOperator.GreaterThan;
    case SearchValueOperator.StartsWith:
    case SearchValueOperator.EndsWith:
    default:
      /*
       * StartsWith / EndsWith are never produced by the parser (a glob covers
       * both); they exist so a caller can hand-build a predicate. Negating one
       * is expressed as the equivalent negated glob by the caller.
       */
      return operator;
  }
};

type SplitListFunction = (inner: string) => Array<string>;

/*
 * Split `(a OR b)` / `[a, b]` into its entries, quotes stripped but ESCAPES
 * INTACT — whether an entry is a glob is decided per entry afterwards, so
 * `(a* OR bravo)` keeps the star that makes the first entry a pattern.
 */
const splitList: SplitListFunction = (inner: string): Array<string> => {
  return inner
    .split(LIST_SEPARATOR_REGEX)
    .map((entry: string) => {
      return stripQuotes(entry.trim());
    })
    .filter((entry: string) => {
      return entry.length > 0;
    });
};

/**
 * Parse the value half of a `key:value` token into a predicate.
 *
 * This is the single definition of what a typed value means, shared by the
 * search bar, the facet chips and every viewer, so a value cannot mean
 * "contains" in one place and "equals" in another.
 */
export const parseSearchValue: ParseSearchValueFunction = (
  rawValue: string,
  negated?: boolean | undefined,
): SearchValuePredicate => {
  type BuildFunction = (
    operator: SearchValueOperator,
    value: string,
    values?: Array<string> | undefined,
  ) => SearchValuePredicate;

  const build: BuildFunction = (
    operator: SearchValueOperator,
    value: string,
    values?: Array<string> | undefined,
  ): SearchValuePredicate => {
    return {
      operator: negated ? negateOperator(operator) : operator,
      value,
      values: values || [],
    };
  };

  const trimmed: string = rawValue.trim();

  // `@k:*` — the key exists with a non-empty value.
  if (trimmed === "*") {
    return build(SearchValueOperator.Exists, "");
  }

  if (trimmed.startsWith("~")) {
    return build(
      SearchValueOperator.Contains,
      unescapeWildcards(stripQuotes(trimmed.slice(1))),
    );
  }

  if (trimmed.startsWith("!")) {
    return build(
      SearchValueOperator.NotEquals,
      unescapeWildcards(stripQuotes(trimmed.slice(1))),
    );
  }

  if (trimmed.startsWith(">=")) {
    return build(
      SearchValueOperator.GreaterThanOrEqual,
      stripQuotes(trimmed.slice(2)),
    );
  }

  if (trimmed.startsWith("<=")) {
    return build(
      SearchValueOperator.LessThanOrEqual,
      stripQuotes(trimmed.slice(2)),
    );
  }

  if (trimmed.startsWith(">")) {
    return build(
      SearchValueOperator.GreaterThan,
      stripQuotes(trimmed.slice(1)),
    );
  }

  if (trimmed.startsWith("<")) {
    return build(SearchValueOperator.LessThan, stripQuotes(trimmed.slice(1)));
  }

  const isBracketedList: boolean =
    (trimmed.startsWith("(") && trimmed.endsWith(")")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));

  if (isBracketedList && trimmed.length >= 2) {
    const entries: Array<string> = splitList(trimmed.slice(1, -1));

    /*
     * An empty list constrains nothing. Falling through to equality on the
     * literal "()" would match no row at all, which reads to the user as
     * "your filter is broken" rather than "you typed nothing".
     */
    if (entries.length === 0) {
      return build(SearchValueOperator.Contains, "");
    }

    /*
     * A list of plain literals compiles to `IN (...)`, which the database can
     * satisfy with a hash lookup. Only a list that actually carries a glob
     * pays for the OR-of-ILIKEs form.
     */
    const anyGlob: boolean = entries.some((entry: string) => {
      return hasWildcard(entry);
    });

    if (anyGlob) {
      return build(SearchValueOperator.Wildcard, entries[0]!, entries);
    }

    const literals: Array<string> = entries.map((entry: string) => {
      return unescapeWildcards(entry);
    });

    if (literals.length === 1) {
      return build(SearchValueOperator.Equals, literals[0]!);
    }

    return build(SearchValueOperator.In, literals[0]!, literals);
  }

  const unquoted: string = stripQuotes(trimmed);

  if (hasWildcard(unquoted)) {
    // Keep the escapes: the glob is compiled, and re-rendered, from this.
    return build(SearchValueOperator.Wildcard, unquoted, [unquoted]);
  }

  return build(SearchValueOperator.Equals, unescapeWildcards(unquoted));
};

type ParseSearchQueryFunction = (
  raw: string,
  options?: ParseSearchQueryOptions | undefined,
) => Array<SearchToken>;

/**
 * Parse a whole search string into tokens.
 *
 * Consecutive free-text words are combined into one phrase token; a field
 * filter between them ends the phrase, so `foo severity:error bar` searches
 * for "foo" and for "bar", never for the phrase "foo bar" that never occurred
 * in any log line.
 */
export const parseSearchQuery: ParseSearchQueryFunction = (
  raw: string,
  options?: ParseSearchQueryOptions | undefined,
): Array<SearchToken> => {
  const trimmed: string = raw.trim();

  if (trimmed.length === 0) {
    return [];
  }

  const rawTokens: Array<string> = tokenizeSearchQuery(trimmed, options);
  const tokens: Array<SearchToken> = [];
  let freeTextParts: Array<string> = [];

  type FlushFreeTextFunction = () => void;

  const flushFreeText: FlushFreeTextFunction = (): void => {
    if (freeTextParts.length === 0) {
      return;
    }

    const combined: string = freeTextParts.join(" ");

    tokens.push({
      type: SearchTokenType.FreeText,
      key: "",
      predicate: {
        operator: SearchValueOperator.Contains,
        value: combined,
        values: [],
      },
      negated: false,
      raw: combined,
    });

    freeTextParts = [];
  };

  for (const rawToken of rawTokens) {
    if (BOOLEAN_KEYWORDS.has(rawToken)) {
      /*
       * Tokens are ANDed. `AND` is therefore a no-op, and a bare `OR` cannot
       * be honoured between two different filters — it is skipped rather than
       * silently reinterpreted. Use `@k:(a OR b)` for an OR over one key.
       */
      continue;
    }

    let working: string = rawToken;
    let negated: boolean = false;

    if (working.startsWith("-") && working.length > 1) {
      negated = true;
      working = working.slice(1);
    }

    const isAttribute: boolean = working.startsWith("@");

    if (isAttribute) {
      working = working.slice(1);
    }

    /*
     * A quoted token is free text even if it contains a colon — quoting is
     * how a user searches for a literal `foo:bar` in a message.
     */
    const colonIndex: number = working.startsWith('"')
      ? -1
      : working.indexOf(":");

    if (colonIndex <= 0) {
      if (isAttribute) {
        // `@key` with no value: a bare mention, not a filter. Ignore it.
        continue;
      }

      freeTextParts.push(unescapeWildcards(stripQuotes(working)));
      continue;
    }

    const rawKey: string = working.slice(0, colonIndex);
    const rawValue: string = working.slice(colonIndex + 1);

    if (rawValue.length === 0) {
      // `severity:` with nothing after it — the user is still typing.
      continue;
    }

    flushFreeText();

    const key: string = isAttribute
      ? rawKey
      : options?.fieldAliases?.[rawKey.toLowerCase()] || rawKey;

    tokens.push({
      type: isAttribute ? SearchTokenType.Attribute : SearchTokenType.Field,
      key,
      predicate: parseSearchValue(rawValue, negated),
      negated,
      raw: rawToken,
    });
  }

  flushFreeText();

  return tokens;
};

type ParseNumericOrStringFunction = (value: string) => number | string;

const parseNumericOrString: ParseNumericOrStringFunction = (
  value: string,
): number | string => {
  return NUMERIC_REGEX.test(value.trim()) ? Number(value.trim()) : value;
};

export type SearchQueryValue =
  | string
  | Search<string>
  | NotEqual<string>
  | NotContains<string>
  | StartsWith<string>
  | EndsWith<string>
  | Wildcard<string>
  | NotWildcard<string>
  | GreaterThan<number | string>
  | GreaterThanOrEqual<number | string>
  | LessThan<number | string>
  | LessThanOrEqual<number | string>
  | Includes
  | IncludesNone
  | IsNull
  | NotNull;

type GlobsOfFunction = (predicate: SearchValuePredicate) => Array<string>;

/** The glob list of a wildcard predicate; a single glob is a list of one. */
const globsOf: GlobsOfFunction = (
  predicate: SearchValuePredicate,
): Array<string> => {
  return predicate.values.length > 0 ? predicate.values : [predicate.value];
};

type PredicateToQueryValueFunction = (
  predicate: SearchValuePredicate,
) => SearchQueryValue;

/**
 * Compile a predicate into the query-operator vocabulary the analytics and
 * Postgres compilers already speak. A bare string is returned for equality so
 * the fast `attributes['k'] = 'v'` map-subscript path is preserved.
 */
export const predicateToQueryValue: PredicateToQueryValueFunction = (
  predicate: SearchValuePredicate,
): SearchQueryValue => {
  switch (predicate.operator) {
    case SearchValueOperator.NotEquals:
      return new NotEqual(predicate.value);
    case SearchValueOperator.Contains:
      return new Search(predicate.value);
    case SearchValueOperator.NotContains:
      return new NotContains(predicate.value);
    case SearchValueOperator.StartsWith:
      return new StartsWith(predicate.value);
    case SearchValueOperator.EndsWith:
      return new EndsWith(predicate.value);
    case SearchValueOperator.Wildcard:
      return new Wildcard(globsOf(predicate));
    case SearchValueOperator.NotWildcard:
      return new NotWildcard(globsOf(predicate));
    case SearchValueOperator.GreaterThan:
      return new GreaterThan(parseNumericOrString(predicate.value));
    case SearchValueOperator.GreaterThanOrEqual:
      return new GreaterThanOrEqual(parseNumericOrString(predicate.value));
    case SearchValueOperator.LessThan:
      return new LessThan(parseNumericOrString(predicate.value));
    case SearchValueOperator.LessThanOrEqual:
      return new LessThanOrEqual(parseNumericOrString(predicate.value));
    case SearchValueOperator.In:
      return new Includes(predicate.values);
    case SearchValueOperator.NotIn:
      return new IncludesNone(predicate.values);
    case SearchValueOperator.Exists:
      return new NotNull();
    case SearchValueOperator.NotExists:
      return new IsNull();
    case SearchValueOperator.Equals:
    default:
      return predicate.value;
  }
};

type PredicateToSerializedValueFunction = (
  predicate: SearchValuePredicate,
) => JSONObject | string;

/**
 * The same compilation, in the `{_type, value}` wire shape the histogram /
 * facet / analytics endpoints accept. Going through one function is what
 * keeps the chart and the table showing the same filter.
 */
export const predicateToSerializedValue: PredicateToSerializedValueFunction = (
  predicate: SearchValuePredicate,
): JSONObject | string => {
  const queryValue: SearchQueryValue = predicateToQueryValue(predicate);

  if (typeof queryValue === "string") {
    return queryValue;
  }

  return queryValue.toJSON();
};

type BuildSearchTokenValueFunction = (literal: string) => string;

/**
 * Render a value that came from the DATA into a search token that means
 * exactly that value.
 *
 * A facet value the user clicked, or an attribute copied off a log row, may
 * legitimately contain `*`, `?`, a space or a quote — a Kubernetes arg like
 * `--foo=*`, a URL pattern `/api/*`. Without escaping, clicking such a value
 * would build a filter that matches far more than the row it came from.
 */
export const buildSearchTokenValue: BuildSearchTokenValueFunction = (
  literal: string,
): string => {
  const escaped: string = escapeWildcards(literal)
    .replace(RESERVED_PREFIX_REGEX, "\\$1")
    .replace(LEADING_DASH_REGEX, "\\-");

  return WHITESPACE_REGEX.test(escaped) ? `"${escaped}"` : escaped;
};

type CompileAttributeChipValuesFunction = (
  values: Array<string>,
) => SearchQueryValue | Array<SearchQueryValue> | undefined;

/**
 * Compile the values of one `attributes.<key>` chip group into a query value.
 *
 * A chip carries the value exactly as the user typed it, so the same grammar
 * that governs the search bar governs the chip — this is what makes
 * `@platform.team:a*` work whether it is submitted as text or applied as a
 * chip, and what stops the two paths compiling to different SQL.
 *
 *  - one value        → that predicate
 *  - several literals → `IN (...)`, which the database resolves by hash
 *  - several globs    → one Wildcard carrying all of them (an OR of ILIKEs)
 *  - anything mixed   → the predicates AND-ed, the only reading a flat map
 *                       slot can express for unlike operators
 */
export const compileAttributeChipValues: CompileAttributeChipValuesFunction = (
  values: Array<string>,
): SearchQueryValue | Array<SearchQueryValue> | undefined => {
  const meaningful: Array<string> = values.filter((value: string) => {
    return value.length > 0;
  });

  if (meaningful.length === 0) {
    return undefined;
  }

  const predicates: Array<SearchValuePredicate> = meaningful.map(
    (value: string) => {
      return parseSearchValue(value);
    },
  );

  if (predicates.length === 1) {
    return predicateToQueryValue(predicates[0]!);
  }

  const everyEquals: boolean = predicates.every(
    (predicate: SearchValuePredicate) => {
      return predicate.operator === SearchValueOperator.Equals;
    },
  );

  if (everyEquals) {
    return new Includes(
      predicates.map((predicate: SearchValuePredicate) => {
        return predicate.value;
      }),
    );
  }

  const everyEqualsOrGlob: boolean = predicates.every(
    (predicate: SearchValuePredicate) => {
      return (
        predicate.operator === SearchValueOperator.Equals ||
        predicate.operator === SearchValueOperator.Wildcard
      );
    },
  );

  if (everyEqualsOrGlob) {
    return new Wildcard(
      predicates.flatMap((predicate: SearchValuePredicate) => {
        /*
         * A literal joins the glob list as an inert glob, so an OR that mixes
         * `abc` with `a*` still evaluates as one disjunction.
         */
        return predicate.operator === SearchValueOperator.Wildcard
          ? globsOf(predicate)
          : [escapeWildcards(predicate.value)];
      }),
    );
  }

  return predicates.map((predicate: SearchValuePredicate) => {
    return predicateToQueryValue(predicate);
  });
};

type DescribeSearchValueFunction = (value: string) => string;

/**
 * How a chip value should read to a person: escapes resolved, operator
 * markers kept (`~foo` still says "contains foo").
 */
export const describeSearchValue: DescribeSearchValueFunction = (
  value: string,
): string => {
  const predicate: SearchValuePredicate = parseSearchValue(value);

  switch (predicate.operator) {
    case SearchValueOperator.Equals:
      return predicate.value;
    case SearchValueOperator.Wildcard:
      return globsOf(predicate).join(" OR ");
    case SearchValueOperator.In:
      return predicate.values.join(" OR ");
    case SearchValueOperator.Exists:
      return "any value";
    case SearchValueOperator.NotExists:
      return "no value";
    default:
      return value;
  }
};
