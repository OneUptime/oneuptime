/**
 * Compiles the metrics explorer's search bar into the filters the metric list
 * runs on.
 *
 * The grammar itself lives in Common/Types/Telemetry/TelemetrySearchQuery —
 * shared with logs, traces and exceptions, so `@platform.team:a*` means the
 * same thing on every explorer. What is metrics-specific lives here: which
 * names are fields, that a metric name is matched by FRAGMENT rather than
 * exactly, and that a name filter has to be evaluated twice — once as a
 * Postgres predicate on `MetricType.name`, and once in the browser against the
 * names ClickHouse resolved for an attribute filter, because those two paths
 * meet in the same list and must not disagree.
 */

import { toLikePattern } from "Common/Types/BaseDatabase/WildcardPattern";
import {
  SearchQueryValue,
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchValuePredicate,
  compileAttributeChipValues,
  parseSearchQuery,
  parseSearchValue,
  predicateToQueryValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";

/** Facet-key prefix that routes a chip into the attributes map. */
export const ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/*
 * User-facing field name → what it actually filters. `service` narrows the
 * Postgres relation, so it is spelled with the relation path; the search bar
 * uses the same map to look up value suggestions under the resolved key.
 */
export const METRICS_FIELD_ALIAS_MAP: Record<string, string> = {
  name: "name",
  service: "services.name",
};

/**
 * Field names that may be followed by a space before their value
 * (`name: http.server`). Kept to known names so ordinary prose containing a
 * colon stays free text rather than becoming a filter on an invented field.
 */
export const METRICS_KNOWN_FIELD_KEYS: Set<string> = new Set(
  Object.keys(METRICS_FIELD_ALIAS_MAP),
);

const NAME_FIELD_KEY: string = "name";

const SERVICE_FIELD_KEY: string = "services.name";

/**
 * One attribute slot. An ARRAY is several operators AND-ed onto one key —
 * `@k:a* @k:*b`, which the analytics compiler resolves per element.
 */
export type MetricsAttributeFilterValue =
  | SearchQueryValue
  | Array<SearchQueryValue>;

export type MetricsAttributeFilters = Record<
  string,
  MetricsAttributeFilterValue
>;

export type MetricsTextMatcher = (candidate: string) => boolean;

export interface MetricNameFilter {
  /** Compiled for the `name` column of the Postgres MetricType model. */
  queryValue: SearchQueryValue;
  /**
   * The same predicate, evaluated in the browser. Used on the path where an
   * attribute filter has already resolved the candidate names in ClickHouse
   * and the name restriction has to be applied to that list instead of to a
   * column.
   */
  matches: MetricsTextMatcher;
}

export interface ParsedMetricsSearch {
  /** Words with no field of their own — a fragment of the metric name. */
  freeText: string;
  /** `name:`, or the free text when no `name:` was typed. */
  nameFilter: MetricNameFilter | null;
  /**
   * `service:` — matched against the service names already loaded for the
   * facet sidebar, because the metric list filters by service id.
   */
  serviceMatcher: MetricsTextMatcher | null;
  attributes: MetricsAttributeFilters;
}

const REGEXP_SPECIAL_CHARS_REGEX: RegExp = /[.*+?^${}()|[\]\\]/g;

const NUMERIC_REGEX: RegExp = /^-?\d+(\.\d+)?$/;

type EscapeRegExpFunction = (value: string) => string;

const escapeRegExp: EscapeRegExpFunction = (value: string): string => {
  return value.replace(REGEXP_SPECIAL_CHARS_REGEX, "\\$&");
};

type GlobToRegExpFunction = (glob: string) => RegExp;

/*
 * A glob, as the database would read it.
 *
 * The browser half of a name filter has to agree with the SQL half exactly,
 * so the glob is translated through `toLikePattern` — the single place that
 * can tell a `%` the user typed from the one a `*` becomes — and only the
 * resulting LIKE pattern is turned into a RegExp. Re-implementing the glob
 * rules here would be a second definition of the grammar, and the two would
 * drift on the first escape someone forgot.
 *
 * Case-insensitive, because both compilers emit ILIKE.
 */
const globToRegExp: GlobToRegExpFunction = (glob: string): RegExp => {
  const pattern: string = toLikePattern(glob);
  let source: string = "^";

  for (let index: number = 0; index < pattern.length; index++) {
    const character: string = pattern[index]!;

    if (character === "\\") {
      const escaped: string | undefined = pattern[index + 1];

      if (escaped === undefined) {
        source += escapeRegExp("\\");
        continue;
      }

      source += escapeRegExp(escaped);
      index++;
      continue;
    }

    if (character === "%") {
      // `[\s\S]` rather than `.`, so a newline in a value cannot stop a match.
      source += "[\\s\\S]*";
      continue;
    }

    if (character === "_") {
      source += "[\\s\\S]";
      continue;
    }

    source += escapeRegExp(character);
  }

  return new RegExp(`${source}$`, "i");
};

type ToNumberFunction = (value: string) => number | null;

const toNumber: ToNumberFunction = (value: string): number | null => {
  const trimmed: string = value.trim();

  return NUMERIC_REGEX.test(trimmed) ? Number(trimmed) : null;
};

type CompareFunction = (candidate: string, bound: string) => number;

/*
 * Numeric when both sides are numbers, lexicographic otherwise — the same
 * choice `predicateToQueryValue` makes when it decides whether to send a
 * number or a string to the database.
 */
const compareValues: CompareFunction = (
  candidate: string,
  bound: string,
): number => {
  const left: number | null = toNumber(candidate);
  const right: number | null = toNumber(bound);

  if (left !== null && right !== null) {
    return left - right;
  }

  if (candidate === bound) {
    return 0;
  }

  return candidate > bound ? 1 : -1;
};

type CreatePredicateMatcherFunction = (
  predicate: SearchValuePredicate,
) => MetricsTextMatcher;

/**
 * Evaluate a predicate in the browser.
 *
 * The RegExps are built once per filter rather than once per candidate: the
 * name list this runs over is the whole project's set of metric names.
 */
const createPredicateMatcher: CreatePredicateMatcherFunction = (
  predicate: SearchValuePredicate,
): MetricsTextMatcher => {
  const globs: Array<string> =
    predicate.values.length > 0 ? predicate.values : [predicate.value];

  const isGlobPredicate: boolean =
    predicate.operator === SearchValueOperator.Wildcard ||
    predicate.operator === SearchValueOperator.NotWildcard;

  const patterns: Array<RegExp> = isGlobPredicate
    ? globs.map(globToRegExp)
    : [];

  const lowerValue: string = predicate.value.toLowerCase();

  return (candidate: string): boolean => {
    const lowerCandidate: string = candidate.toLowerCase();

    type MatchesAnyGlobFunction = () => boolean;

    const matchesAnyGlob: MatchesAnyGlobFunction = (): boolean => {
      return patterns.some((pattern: RegExp) => {
        return pattern.test(candidate);
      });
    };

    switch (predicate.operator) {
      case SearchValueOperator.Contains:
        return lowerCandidate.includes(lowerValue);
      case SearchValueOperator.NotContains:
        return !lowerCandidate.includes(lowerValue);
      case SearchValueOperator.Wildcard:
        return matchesAnyGlob();
      case SearchValueOperator.NotWildcard:
        return !matchesAnyGlob();
      case SearchValueOperator.StartsWith:
        return lowerCandidate.startsWith(lowerValue);
      case SearchValueOperator.EndsWith:
        return lowerCandidate.endsWith(lowerValue);
      case SearchValueOperator.In:
        return predicate.values.includes(candidate);
      case SearchValueOperator.NotIn:
        return !predicate.values.includes(candidate);
      case SearchValueOperator.Exists:
        return candidate.length > 0;
      case SearchValueOperator.NotExists:
        return candidate.length === 0;
      case SearchValueOperator.GreaterThan:
        return compareValues(candidate, predicate.value) > 0;
      case SearchValueOperator.GreaterThanOrEqual:
        return compareValues(candidate, predicate.value) >= 0;
      case SearchValueOperator.LessThan:
        return compareValues(candidate, predicate.value) < 0;
      case SearchValueOperator.LessThanOrEqual:
        return compareValues(candidate, predicate.value) <= 0;
      case SearchValueOperator.NotEquals:
        return candidate !== predicate.value;
      case SearchValueOperator.Equals:
      default:
        return candidate === predicate.value;
    }
  };
};

type NormalizeFragmentPredicateFunction = (
  predicate: SearchValuePredicate,
) => SearchValuePredicate;

/*
 * A metric name is a long dotted path (`http.server.request.duration`) and a
 * service name is typed from memory, so `name:http.server` and `service:api`
 * have always meant "contains", not "equals". That is the one place the
 * metrics explorer departs from the shared grammar, and the negated form has
 * to depart with it: leaving `-name:x` as NotEquals would exclude only an
 * exact match while `name:x` matched fragments, the same filter reading two
 * different ways depending on its sign.
 *
 * Every other operator is left alone — a glob, an any-of list and a
 * comparison already say precisely what they mean.
 */
const normalizeFragmentPredicate: NormalizeFragmentPredicateFunction = (
  predicate: SearchValuePredicate,
): SearchValuePredicate => {
  if (predicate.operator === SearchValueOperator.Equals) {
    return { ...predicate, operator: SearchValueOperator.Contains };
  }

  if (predicate.operator === SearchValueOperator.NotEquals) {
    return { ...predicate, operator: SearchValueOperator.NotContains };
  }

  return predicate;
};

type BuildNameFilterFunction = (
  predicate: SearchValuePredicate,
) => MetricNameFilter;

const buildNameFilter: BuildNameFilterFunction = (
  predicate: SearchValuePredicate,
): MetricNameFilter => {
  const normalized: SearchValuePredicate =
    normalizeFragmentPredicate(predicate);

  return {
    queryValue: predicateToQueryValue(normalized),
    matches: createPredicateMatcher(normalized),
  };
};

type AssignAttributeFunction = (
  target: MetricsAttributeFilters,
  key: string,
  value: SearchQueryValue,
) => void;

/*
 * Two filters on one key AND together rather than the second overwriting the
 * first — `@k:a* @k:*b` is "starts with a and ends with b". The analytics
 * compiler accepts an array of operators on a map sub-key and compiles each
 * one; a bare string cannot join such an array, so the first wins in that
 * case (a plain equality already pins the value to one string, and a second
 * one could only contradict it).
 */
const assignAttribute: AssignAttributeFunction = (
  target: MetricsAttributeFilters,
  key: string,
  value: SearchQueryValue,
): void => {
  const existing: MetricsAttributeFilterValue | undefined = target[key];

  if (existing === undefined) {
    target[key] = value;
    return;
  }

  if (typeof existing === "string" || typeof value === "string") {
    return;
  }

  target[key] = Array.isArray(existing)
    ? [...existing, value]
    : [existing, value];
};

/**
 * Parse the metrics search bar into the filters the list runs on.
 */
export function parseMetricsSearch(raw: string): ParsedMetricsSearch {
  const tokens: Array<SearchToken> = parseSearchQuery(raw, {
    knownFieldKeys: METRICS_KNOWN_FIELD_KEYS,
    fieldAliases: METRICS_FIELD_ALIAS_MAP,
  });

  const freeTextParts: Array<string> = [];
  const attributes: MetricsAttributeFilters = {};
  let namePredicate: SearchValuePredicate | null = null;
  let servicePredicate: SearchValuePredicate | null = null;

  for (const token of tokens) {
    if (token.type === SearchTokenType.FreeText) {
      freeTextParts.push(token.predicate.value);
      continue;
    }

    /*
     * A field only when it was typed WITHOUT `@`. `@name:x` filters an
     * attribute called "name", which is what the `@` says; reading it as the
     * metric-name column would silently ignore the one character the user
     * typed to disambiguate.
     */
    if (token.type === SearchTokenType.Field) {
      if (token.key === NAME_FIELD_KEY) {
        namePredicate = token.predicate;
        continue;
      }

      if (token.key === SERVICE_FIELD_KEY) {
        servicePredicate = token.predicate;
        continue;
      }
    }

    /*
     * Everything else is an attribute, including a bare `k8s.pod:foo` — the
     * same reading the logs explorer takes. Such a token used to become free
     * text, i.e. a substring search for "k8s.pod:foo" in the metric name,
     * which matches nothing.
     */
    assignAttribute(
      attributes,
      token.key,
      predicateToQueryValue(token.predicate),
    );
  }

  const freeText: string = freeTextParts.join(" ").trim();

  let nameFilter: MetricNameFilter | null = null;

  if (namePredicate) {
    nameFilter = buildNameFilter(namePredicate);
  } else if (freeText.length > 0) {
    /*
     * Free text is taken literally — the grammar has already resolved its
     * escapes, and re-parsing it here would turn a metric name that happens
     * to contain `*` into a pattern the user never asked for.
     */
    nameFilter = buildNameFilter({
      operator: SearchValueOperator.Equals,
      value: freeText,
      values: [],
    });
  }

  return {
    freeText,
    nameFilter,
    serviceMatcher: servicePredicate
      ? createPredicateMatcher(normalizeFragmentPredicate(servicePredicate))
      : null,
    attributes,
  };
}

export interface MetricsAttributeChip {
  facetKey: string;
  value: string;
}

export interface MergeMetricsAttributeFiltersInput {
  /** Attribute tokens from the typed search string. */
  parsed: MetricsAttributeFilters;
  /** Chips the user applied; only `attributes.<key>` ones are read. */
  chips: Array<MetricsAttributeChip>;
  /**
   * Scope pinned by the host page (a service view, a host page). These come
   * from the DATA, never from a keyboard, so they stay literal — a container
   * arg like `--foo=*` must not become a glob.
   */
  pinned?: Record<string, string> | undefined;
}

/**
 * Merge the three sources of attribute filters into the one map the queries
 * take.
 *
 * Chip values are compiled with the shared grammar, exactly as the typed
 * search string is, so `@platform.team:a*` means the same thing whether it is
 * submitted as text or applied as a chip — a chip used to compile to exact
 * equality on the literal three-character string `a*`.
 */
export function mergeMetricsAttributeFilters(
  input: MergeMetricsAttributeFiltersInput,
): MetricsAttributeFilters {
  const merged: MetricsAttributeFilters = { ...input.parsed };

  const chipValuesByKey: Record<string, Array<string>> = {};

  for (const chip of input.chips) {
    if (!chip.facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
      continue;
    }

    const key: string = chip.facetKey.substring(ATTRIBUTE_FACET_PREFIX.length);
    const existing: Array<string> | undefined = chipValuesByKey[key];

    if (existing) {
      existing.push(chip.value);
      continue;
    }

    chipValuesByKey[key] = [chip.value];
  }

  for (const [key, values] of Object.entries(chipValuesByKey)) {
    const compiled: MetricsAttributeFilterValue | undefined =
      compileAttributeChipValues(values);

    if (compiled !== undefined) {
      merged[key] = compiled;
    }
  }

  for (const [key, value] of Object.entries(input.pinned || {})) {
    if (value) {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * Does this value mean anything other than "equals this exact string"?
 *
 * The search bar's Enter key resolves a typed value against the suggestion
 * list before handing it over, so a glob that happens to have exactly one
 * matching suggestion would be replaced by that one literal value — turning
 * `@k:a*` into `@k:abc`. Anything carrying grammar therefore declines the
 * chip and stays in the input, where the parser reads it whole.
 */
export function valueCarriesSearchSyntax(value: string): boolean {
  return parseSearchValue(value).operator !== SearchValueOperator.Equals;
}
