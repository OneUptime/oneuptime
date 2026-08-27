import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import { toLikePattern } from "Common/Types/BaseDatabase/WildcardPattern";
import {
  SearchQueryValue,
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  SearchValuePredicate,
  parseSearchQuery,
  parseSearchValue,
  predicateToQueryValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";

/*
 * The exceptions explorer's half of the shared telemetry search grammar.
 *
 * The grammar itself lives in Common/Types/Telemetry/TelemetrySearchQuery —
 * the same one logs, traces and metrics parse — so `@platform.team:a*` means
 * here what it means there. Everything in this file is exceptions-specific:
 * which names are columns, how a service NAME becomes the id the column
 * actually stores, and which predicates the histogram and facet endpoints are
 * able to carry.
 */

/**
 * User-facing field name (lowercased) → the column it filters.
 *
 * Every column is spelled both ways users type it, and the lookup is
 * case-insensitive, so `@Type:X`, `@type:X` and `type:X` are ONE filter. They
 * used to be three: the alias was read exactly as typed, so `@Type:TypeError`
 * fell through to an attribute filter on a key called "Type" that no
 * exception carries, and the bare `type:TypeError` form was free text.
 */
export const EXCEPTION_FIELD_ALIASES: Record<string, string> = {
  type: "exceptionType",
  exceptiontype: "exceptionType",
  service: "primaryEntityId",
  primaryentityid: "primaryEntityId",
  env: "environment",
  environment: "environment",
};

/**
 * Names that may be followed by a space before their value (`type: TypeError`).
 * Kept to known names so prose that happens to contain a colon stays free
 * text rather than becoming a filter on an invented field.
 */
export const EXCEPTION_KNOWN_FIELD_KEYS: Set<string> = new Set(
  Object.keys(EXCEPTION_FIELD_ALIASES),
);

/** The columns those aliases resolve to. Every other key is an attribute. */
export const EXCEPTION_SEARCH_COLUMNS: Set<string> = new Set(
  Object.values(EXCEPTION_FIELD_ALIASES),
);

/**
 * The column `@service:` filters. It stores an id, while the search token
 * carries a NAME, so it is the one column resolved client-side rather than
 * compiled — see {@link resolveExceptionServiceIds}.
 */
export const EXCEPTION_SERVICE_COLUMN: string = "primaryEntityId";

/*
 * A service filter that names no existing service has to show NOTHING. The
 * nil uuid is a valid ObjectID (so Postgres and ClickHouse both accept the
 * bind) that no row carries, which forces the empty result instead of
 * silently dropping the filter and showing every exception in the project.
 */
export const NO_MATCH_ENTITY_ID: string = ObjectID.getZeroObjectID().toString();

const REGEXP_SPECIAL_CHARS_REGEX: RegExp = /[.*+?^${}()|[\]\\]/g;

/*
 * Value syntax that only the parser can read: a chip stores a value
 * verbatim, so anything here has to stay in the search string instead.
 */
const DSL_PREFIX_REGEX: RegExp = /^[-~!<>([]/;

const WILDCARD_CHAR_REGEX: RegExp = /[*?]/;

/** Operators that select the complement of a positive counterpart. */
const POSITIVE_COUNTERPART: Partial<
  Record<SearchValueOperator, SearchValueOperator>
> = {
  [SearchValueOperator.NotEquals]: SearchValueOperator.Equals,
  [SearchValueOperator.NotContains]: SearchValueOperator.Contains,
  [SearchValueOperator.NotWildcard]: SearchValueOperator.Wildcard,
  [SearchValueOperator.NotIn]: SearchValueOperator.In,
};

export interface ExceptionSearchFilters {
  /**
   * Free text, as ONE contains-match on the exception message.
   *
   * Phrases are joined rather than kept apart because a single string is all
   * the histogram and facet endpoints can carry (`messageSearchText`).
   * Splitting them would give the list two predicates and the chart above it
   * one — a quieter version of the disagreement this explorer already had,
   * where free text meant `exceptionType = <text>` on the list and a message
   * search everywhere else.
   */
  freeText: string;
  /** Backend column → predicates, in the order they were typed. */
  fieldPredicates: Dictionary<Array<SearchValuePredicate>>;
  /** Instance attribute key → predicates, with the user's casing kept. */
  attributePredicates: Dictionary<Array<SearchValuePredicate>>;
}

function addPredicate(
  target: Dictionary<Array<SearchValuePredicate>>,
  key: string,
  predicate: SearchValuePredicate,
): void {
  if (!target[key]) {
    target[key] = [];
  }
  target[key]!.push(predicate);
}

/** Parse the exceptions search bar into the filters each transport needs. */
export function parseExceptionSearch(raw: string): ExceptionSearchFilters {
  const tokens: Array<SearchToken> = parseSearchQuery(raw, {
    knownFieldKeys: EXCEPTION_KNOWN_FIELD_KEYS,
    fieldAliases: EXCEPTION_FIELD_ALIASES,
  });

  const fieldPredicates: Dictionary<Array<SearchValuePredicate>> = {};
  const attributePredicates: Dictionary<Array<SearchValuePredicate>> = {};
  const freeTextPhrases: Array<string> = [];

  for (const token of tokens) {
    if (token.type === SearchTokenType.FreeText) {
      const phrase: string = token.predicate.value.trim();
      if (phrase.length > 0) {
        freeTextPhrases.push(phrase);
      }
      continue;
    }

    /*
     * `@type:` has meant the exception TYPE since this explorer shipped — the
     * placeholder, the help table and every shared link teach it — so an `@`
     * in front of a known alias resolves to the column. That is a deliberate
     * divergence from the logs parser, where `@` always means the attributes
     * map. An unknown key is an attribute either way, which is what makes
     * `@http.status_code:500` work.
     */
    const column: string | undefined =
      EXCEPTION_FIELD_ALIASES[token.key.toLowerCase()];

    if (column) {
      addPredicate(fieldPredicates, column, token.predicate);
      continue;
    }

    addPredicate(attributePredicates, token.key, token.predicate);
  }

  return {
    freeText: freeTextPhrases.join(" "),
    fieldPredicates,
    attributePredicates,
  };
}

/**
 * The literal values of an equality predicate, or null when the predicate
 * needs a real operator.
 *
 * The split matters because the histogram and facet endpoints take plain
 * string lists (`exceptionTypes`, `environments`) and nothing else: a
 * predicate that is not a literal has to reach them another way.
 */
export function getEqualityLiterals(
  predicate: SearchValuePredicate,
): Array<string> | null {
  if (predicate.operator === SearchValueOperator.Equals) {
    return [predicate.value];
  }

  if (predicate.operator === SearchValueOperator.In) {
    return [...predicate.values];
  }

  return null;
}

export interface ExceptionFieldFilters {
  /** Column → literal values, the only shape every transport can carry. */
  literals: Dictionary<Array<string>>;
  /**
   * Column → compiled operators. These are resolved through the ClickHouse
   * instance scope instead, so the list, the chart and the facet counts all
   * get them — the endpoints behind the last two speak literals only.
   */
  operators: Dictionary<Array<SearchQueryValue>>;
}

/** Split field predicates by what the transports can express. */
export function splitExceptionFieldPredicates(
  fieldPredicates: Dictionary<Array<SearchValuePredicate>>,
): ExceptionFieldFilters {
  const literals: Dictionary<Array<string>> = {};
  const operators: Dictionary<Array<SearchQueryValue>> = {};

  for (const column of Object.keys(fieldPredicates)) {
    /*
     * `@service:` carries a NAME. Compiling it against the id column would
     * filter for an exception whose primaryEntityId is literally the string
     * "api", which no row has.
     */
    if (column === EXCEPTION_SERVICE_COLUMN) {
      continue;
    }

    for (const predicate of fieldPredicates[column] || []) {
      const values: Array<string> | null = getEqualityLiterals(predicate);

      if (values) {
        if (!literals[column]) {
          literals[column] = [];
        }
        literals[column]!.push(...values);
        continue;
      }

      if (!operators[column]) {
        operators[column] = [];
      }
      operators[column]!.push(predicateToQueryValue(predicate));
    }
  }

  return { literals, operators };
}

function likePatternToRegExp(pattern: string): RegExp {
  let source: string = "^";

  for (let index: number = 0; index < pattern.length; index++) {
    const character: string = pattern[index]!;

    if (character === "\\" && index + 1 < pattern.length) {
      source += pattern[index + 1]!.replace(REGEXP_SPECIAL_CHARS_REGEX, "\\$&");
      index++;
      continue;
    }

    if (character === "%") {
      source += ".*";
      continue;
    }

    if (character === "_") {
      source += ".";
      continue;
    }

    source += character.replace(REGEXP_SPECIAL_CHARS_REGEX, "\\$&");
  }

  return new RegExp(`${source}$`, "i");
}

/*
 * A glob is matched by translating it to a LIKE pattern first, so the client
 * side and the database read `*`, `?` and `\*` off the same rulebook —
 * re-implementing the alphabet here is how a filter comes to mean one thing
 * in the dropdown and another in the query.
 */
function matchesGlob(value: string, glob: string): boolean {
  return likePatternToRegExp(toLikePattern(glob)).test(value);
}

function globsOfPredicate(predicate: SearchValuePredicate): Array<string> {
  return predicate.values.length > 0 ? predicate.values : [predicate.value];
}

/**
 * Evaluate a predicate against a value in the browser.
 *
 * Used for the one filter that cannot be sent to a database as written: a
 * service NAME, which has to become an id before any query can carry it.
 */
export function matchesSearchPredicate(
  value: string,
  predicate: SearchValuePredicate,
): boolean {
  const lowerValue: string = value.toLowerCase();
  const lowerPredicate: string = predicate.value.toLowerCase();

  switch (predicate.operator) {
    case SearchValueOperator.Equals:
      return lowerValue === lowerPredicate;
    case SearchValueOperator.NotEquals:
      return lowerValue !== lowerPredicate;
    case SearchValueOperator.Contains:
      return lowerValue.includes(lowerPredicate);
    case SearchValueOperator.NotContains:
      return !lowerValue.includes(lowerPredicate);
    case SearchValueOperator.StartsWith:
      return lowerValue.startsWith(lowerPredicate);
    case SearchValueOperator.EndsWith:
      return lowerValue.endsWith(lowerPredicate);
    case SearchValueOperator.Wildcard:
      return globsOfPredicate(predicate).some((glob: string): boolean => {
        return matchesGlob(value, glob);
      });
    case SearchValueOperator.NotWildcard:
      return !globsOfPredicate(predicate).some((glob: string): boolean => {
        return matchesGlob(value, glob);
      });
    case SearchValueOperator.In:
      return predicate.values.some((entry: string): boolean => {
        return entry.toLowerCase() === lowerValue;
      });
    case SearchValueOperator.NotIn:
      return !predicate.values.some((entry: string): boolean => {
        return entry.toLowerCase() === lowerValue;
      });
    case SearchValueOperator.Exists:
      return value.length > 0;
    case SearchValueOperator.NotExists:
      return value.length === 0;
    case SearchValueOperator.GreaterThan:
      return Number(value) > Number(predicate.value);
    case SearchValueOperator.GreaterThanOrEqual:
      return Number(value) >= Number(predicate.value);
    case SearchValueOperator.LessThan:
      return Number(value) < Number(predicate.value);
    case SearchValueOperator.LessThanOrEqual:
      return Number(value) <= Number(predicate.value);
    default:
      return false;
  }
}

export interface ExceptionServiceOption {
  id: string;
  name: string;
}

export interface ResolvedExceptionServices {
  /** Ids to filter the list, the chart and the facet counts by. */
  serviceIds: Array<string>;
  /** Ids a negated `@service:` token rules out. */
  excludedServiceIds: Array<string>;
  /** A positive token named a service that does not exist. */
  matchedNothing: boolean;
}

/*
 * Equality on a service NAME is a fragment match, not an exact one — a person
 * typing `@service:api` means the api service, and MetricsViewer resolves
 * `service:` the same way. Every other operator is evaluated as written, so
 * `@service:api-*` is a real glob over the names.
 */
function serviceNameMatches(
  name: string,
  predicate: SearchValuePredicate,
): boolean {
  const literals: Array<string> | null = getEqualityLiterals(predicate);

  if (literals) {
    const lowerName: string = name.toLowerCase();

    return literals.some((literal: string): boolean => {
      return lowerName.includes(literal.toLowerCase());
    });
  }

  return matchesSearchPredicate(name, predicate);
}

function matchServiceIds(
  predicate: SearchValuePredicate,
  services: Array<ExceptionServiceOption>,
): Array<string> {
  const ids: Array<string> = [];

  /*
   * An id pasted straight into the bar (`@service:<uuid>`, which is what a
   * copied link carries) resolves to itself — a uuid never matches a name.
   */
  for (const literal of getEqualityLiterals(predicate) || []) {
    if (ObjectID.isValidUUID(literal) && !ids.includes(literal)) {
      ids.push(literal);
    }
  }

  for (const service of services) {
    if (
      service.id.length > 0 &&
      !ids.includes(service.id) &&
      serviceNameMatches(service.name, predicate)
    ) {
      ids.push(service.id);
    }
  }

  return ids;
}

/**
 * Turn `@service:<name>` tokens into the ids the column stores.
 *
 * The alias has always been documented as taking a name, and has always been
 * bound straight to the `primaryEntityId` uuid column, so `@service:api`
 * filtered for an exception whose service id is the literal string "api" —
 * no exception has ever matched it.
 */
export function resolveExceptionServiceIds(input: {
  predicates: Array<SearchValuePredicate>;
  services: Array<ExceptionServiceOption>;
}): ResolvedExceptionServices {
  const serviceIds: Array<string> = [];
  const excludedServiceIds: Array<string> = [];
  let matchedNothing: boolean = false;

  for (const predicate of input.predicates) {
    const positiveOperator: SearchValueOperator | undefined =
      POSITIVE_COUNTERPART[predicate.operator];

    /*
     * A negation resolves through its positive counterpart and then EXCLUDES
     * what that matched. Taking the complement over the loaded services
     * instead would quietly drop every exception attributed to a host or a
     * cluster rather than a service, since none of those ids are in the list.
     */
    if (positiveOperator !== undefined) {
      const excluded: Array<string> = matchServiceIds(
        { ...predicate, operator: positiveOperator },
        input.services,
      );

      for (const id of excluded) {
        if (!excludedServiceIds.includes(id)) {
          excludedServiceIds.push(id);
        }
      }

      continue;
    }

    const matched: Array<string> = matchServiceIds(predicate, input.services);

    if (matched.length === 0) {
      matchedNothing = true;
      continue;
    }

    for (const id of matched) {
      if (!serviceIds.includes(id)) {
        serviceIds.push(id);
      }
    }
  }

  return { serviceIds, excludedServiceIds, matchedNothing };
}

/**
 * The id a `service:<name>` chip should store, or null when the name is
 * unknown or matches more than one service.
 *
 * A chip on the service facet stores what the COLUMN holds — an id. Chipping
 * the typed name instead builds `primaryEntityId = 'api'`, which no row can
 * match (and which Postgres cannot even cast). Null sends the token back to
 * the search string, where it resolves against every service at query time.
 */
export function resolveExceptionServiceChipId(input: {
  value: string;
  services: Array<ExceptionServiceOption>;
}): string | null {
  const resolved: ResolvedExceptionServices = resolveExceptionServiceIds({
    predicates: [parseSearchValue(input.value)],
    services: input.services,
  });

  return resolved.serviceIds.length === 1 ? resolved.serviceIds[0]! : null;
}

/**
 * Does this value carry syntax only the parser can read?
 *
 * The search bar offers to turn `key:value` into a chip on Enter. A chip
 * stores its value verbatim and compiles it as one predicate, so a value
 * carrying an operator (`a*`, `~foo`, `(a OR b)`) has to stay in the search
 * string instead — the bar keeps the token in the input when this says so.
 */
export function hasSearchDsl(value: string): boolean {
  const trimmed: string = value.trim();

  if (trimmed.length === 0) {
    return false;
  }

  return (
    WILDCARD_CHAR_REGEX.test(trimmed) ||
    DSL_PREFIX_REGEX.test(trimmed) ||
    trimmed.includes("\\")
  );
}
