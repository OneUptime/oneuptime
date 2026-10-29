import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import Includes from "../../Types/BaseDatabase/Includes";
import IncludesNone from "../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../Types/BaseDatabase/NotEqual";
import Query from "../../Types/BaseDatabase/Query";
import Search from "../../Types/BaseDatabase/Search";
import {
  SearchQueryValue,
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  parseSearchQuery,
  predicateToQueryValue,
} from "../../Types/Telemetry/TelemetrySearchQuery";

/*
 * THE SECURITY EVENTS SEARCH, COMPILED: the search bar's text and the facet
 * sidebar's chips, as the query a read of the SecurityEvent table sends.
 *
 * One compile for every reader: the Events page lists, charts and counts
 * with it, and a saved hunt's scheduled run (SecurityHuntScheduler) counts
 * with it on the server, so a hunt finds on its schedule exactly what its
 * page shows. Pure and React-free.
 *
 * The search speaks the shared telemetry grammar
 * (Types/Telemetry/TelemetrySearchQuery), so `severity:High`,
 * `-@threat.matched:true`, `user:(alice OR bob)` and `@device.hostname:web-*`
 * mean here exactly what their counterparts mean in the logs, traces and
 * exceptions explorers. This module only supplies the three things the
 * grammar cannot know - which field names this signal has, which of its
 * columns are numeric, and how a parsed token lands on a SecurityEvent
 * query - and how a chip compiles.
 */

/*
 * What a user may type on the left of the colon -> the column it filters.
 *
 * Both the friendly name and the column's own name are accepted: `severity:`
 * is what somebody types, `severityName:` is what they see in the detail
 * panel and copy. Looked up lowercased by the shared parser.
 */
export const SECURITY_EVENT_FIELD_ALIASES: Readonly<Record<string, string>> = {
  severity: "severityName",
  severityname: "severityName",
  severityid: "severityId",
  class: "className",
  eventclass: "className",
  classname: "className",
  classuid: "classUid",
  category: "categoryName",
  categoryname: "categoryName",
  categoryuid: "categoryUid",
  activity: "activityName",
  activityname: "activityName",
  status: "statusName",
  outcome: "statusName",
  statusname: "statusName",
  message: "message",
  vendor: "vendorName",
  vendorname: "vendorName",
  product: "productName",
  productname: "productName",
  rule: "ruleName",
  rulename: "ruleName",
  ruleid: "ruleId",
  user: "principalUser",
  principaluser: "principalUser",
  host: "principalHost",
  principalhost: "principalHost",
  ip: "principalIp",
  principalip: "principalIp",
  process: "principalProcess",
  principalprocess: "principalProcess",
  /*
   * The process the event is about and its parent, by their own names and
   * by Sigma's: `image:` is the executable's path and `commandline:` its
   * command line, as in a detection rule. `process:` stays the acting
   * process (principalProcess) the searches written before read.
   */
  processname: "processName",
  image: "processPath",
  processpath: "processPath",
  commandline: "processCommandLine",
  cmdline: "processCommandLine",
  processcommandline: "processCommandLine",
  parentprocessname: "parentProcessName",
  parentimage: "parentProcessPath",
  parentprocesspath: "parentProcessPath",
  parentcommandline: "parentProcessCommandLine",
  parentprocesscommandline: "parentProcessCommandLine",
  targetuser: "targetUser",
  targethost: "targetHost",
  targetip: "targetIp",
  targetport: "targetPort",
  resource: "targetResource",
  targetresource: "targetResource",
  observable: "observables",
  observables: "observables",
  tactic: "mitreTactics",
  mitretactics: "mitreTactics",
  technique: "mitreTechniques",
  mitretechniques: "mitreTechniques",
  uid: "eventUid",
  eventuid: "eventUid",
  /*
   * The request an event happened in, and how far it got. `trace:` and
   * `session:` are what a person pastes from the trace or session they came
   * from; `outcome:` stays the OCSF status it always was.
   */
  trace: "traceId",
  traceid: "traceId",
  span: "spanId",
  spanid: "spanId",
  session: "sessionId",
  sessionid: "sessionId",
  requestoutcome: "requestOutcome",
};

/*
 * The field names the parser will glue back together across a space — the
 * difference between `severity: High` being a filter and `note: check this`
 * staying prose. Every alias key is one; nothing else is.
 */
export const SECURITY_EVENT_SEARCH_FIELD_KEYS: Set<string> = new Set<string>(
  Object.keys(SECURITY_EVENT_FIELD_ALIASES),
);

/*
 * Columns stored as numbers. An equality typed against one of these has to
 * reach ClickHouse as a number: the column is UInt/Int, and comparing it to
 * the string "443" is a type error rather than a miss.
 *
 * Only equality needs the coercion — every comparison operator
 * (`>`, `<=`, ...) is already parsed numerically by the shared grammar.
 */
export const SECURITY_EVENT_NUMERIC_FIELDS: ReadonlySet<string> =
  new Set<string>(["severityId", "categoryUid", "classUid", "targetPort"]);

/*
 * Columns whose free-text-ish nature makes an exact match almost always the
 * wrong reading of what the user typed.
 *
 * `message` is a sentence — `message:refused` means "mentions refused".
 * `observables`, `mitreTactics` and `mitreTechniques` are arrays, where the
 * analytics compiler's substring match over the joined array is how "this
 * event mentions X" is asked (the same predicate the Correlate page pivots
 * on). A command line or a path is searched for a part of it:
 * `commandline:-enc`, `image:powershell.exe`. An explicit operator the user
 * typed (`!`, `~`, `>`, a glob, a list) always wins over this default.
 */
export const SECURITY_EVENT_CONTAINS_FIELDS: ReadonlySet<string> =
  new Set<string>([
    "message",
    "observables",
    "mitreTactics",
    "mitreTechniques",
    "principalProcess",
    "processPath",
    "processCommandLine",
    "parentProcessPath",
    "parentProcessCommandLine",
    "targetResource",
  ]);

export interface SecurityEventSearchFilters {
  /*
   * The words that were not part of a filter, joined. Compiled into a
   * substring match on `message`; null when the user typed no prose.
   */
  freeText: string | null;
  /** Column -> compiled predicate. */
  fields: Record<string, SearchQueryValue | number>;
  /** Source attribute key -> compiled predicate. */
  attributes: Record<string, SearchQueryValue>;
}

export const EMPTY_SECURITY_EVENT_SEARCH_FILTERS: SecurityEventSearchFilters = {
  freeText: null,
  fields: {},
  attributes: {},
};

function compileFieldValue(
  column: string,
  token: SearchToken,
): SearchQueryValue | number {
  const compiled: SearchQueryValue = predicateToQueryValue(token.predicate);

  /*
   * Only a bare equality is re-read here; every other operator already
   * carries its own type decision out of the shared grammar.
   */
  if (typeof compiled !== "string") {
    return compiled;
  }

  if (SECURITY_EVENT_NUMERIC_FIELDS.has(column)) {
    const numeric: number = Number(compiled);

    return Number.isFinite(numeric) ? numeric : compiled;
  }

  if (
    SECURITY_EVENT_CONTAINS_FIELDS.has(column) &&
    token.predicate.operator === SearchValueOperator.Equals &&
    !token.negated
  ) {
    return new Search(compiled);
  }

  return compiled;
}

/**
 * Parse a search string into the predicates it stands for.
 *
 * Later tokens on the same key win — a user editing `severity:Low` into
 * `severity:Low severity:High` means the second one.
 */
export function parseSecurityEventSearch(
  raw: string,
): SecurityEventSearchFilters {
  const tokens: Array<SearchToken> = parseSearchQuery(raw || "", {
    knownFieldKeys: SECURITY_EVENT_SEARCH_FIELD_KEYS,
    fieldAliases: SECURITY_EVENT_FIELD_ALIASES,
  });

  const fields: Record<string, SearchQueryValue | number> = {};
  const attributes: Record<string, SearchQueryValue> = {};
  const freeTextParts: Array<string> = [];

  for (const token of tokens) {
    if (token.type === SearchTokenType.FreeText) {
      const text: string = token.predicate.value.trim();

      if (text.length > 0) {
        freeTextParts.push(text);
      }

      continue;
    }

    if (token.type === SearchTokenType.Attribute) {
      if (token.key.length === 0) {
        continue;
      }

      attributes[token.key] = predicateToQueryValue(token.predicate);
      continue;
    }

    /*
     * A field the parser did not recognise is not a column of this table.
     * Dropping it would silently widen the list; treating it as an attribute
     * is what the user almost certainly meant, since every un-typed source
     * field lands in the attributes map.
     */
    const column: string | undefined =
      SECURITY_EVENT_FIELD_ALIASES[token.key.toLowerCase()];

    if (!column) {
      attributes[token.key] = predicateToQueryValue(token.predicate);
      continue;
    }

    fields[column] = compileFieldValue(column, token);
  }

  return {
    freeText: freeTextParts.length > 0 ? freeTextParts.join(" ") : null,
    fields: fields,
    attributes: attributes,
  };
}

/**
 * Lay the parsed search over a query.
 *
 * Returns a new object: the caller's base query (project + window + the
 * page's own scope) is never mutated. Attribute predicates MERGE into any
 * attributes already on the query rather than replacing the map, so a
 * chip and a typed `@key:value` can coexist.
 */
export function applySecurityEventSearchToQuery(data: {
  query: Query<SecurityEvent>;
  filters: SecurityEventSearchFilters;
}): Query<SecurityEvent> {
  const query: Query<SecurityEvent> = { ...data.query };

  if (data.filters.freeText) {
    (query as Record<string, unknown>)["message"] = new Search(
      data.filters.freeText,
    );
  }

  for (const column of Object.keys(data.filters.fields)) {
    (query as Record<string, unknown>)[column] = data.filters.fields[column];
  }

  const attributeKeys: Array<string> = Object.keys(data.filters.attributes);

  if (attributeKeys.length > 0) {
    const attributes: Record<string, unknown> = {
      ...(((query as Record<string, unknown>)["attributes"] as Record<
        string,
        unknown
      >) || {}),
    };

    for (const key of attributeKeys) {
      attributes[key] = data.filters.attributes[key];
    }

    (query as Record<string, unknown>)["attributes"] = attributes;
  }

  return query;
}

/** True when the string holds anything the parser would turn into a filter. */
export function hasSecurityEventSearch(raw: string): boolean {
  const filters: SecurityEventSearchFilters = parseSecurityEventSearch(raw);

  return (
    filters.freeText !== null ||
    Object.keys(filters.fields).length > 0 ||
    Object.keys(filters.attributes).length > 0
  );
}

/*
 * THE CHIPS.
 *
 * Chips for arbitrary source attributes are keyed `attributes.<key>`, the
 * same grammar the logs, traces and exceptions explorers use, so the shared
 * sidebar and chip row need no special case for them.
 */
export const SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX: string = "attributes.";

/*
 * A chip the sidebar's "exclude" action created, marked on the KEY rather
 * than the value: `!severityName` / `!attributes.threat.matched`.
 *
 * On the key because a value is data — a hostname, a rule name, a flattened
 * attribute — and any marker put on it could be part of a real value. No
 * column name or attribute key starts with `!`, so the marker is
 * unambiguous, and it survives the `[[key, value], ...]` URL grammar the
 * other explorers already use without a second param. It is the shared facet
 * sidebar's marker (FacetSelection's FACET_EXCLUDE_KEY_PREFIX), which a test
 * holds this one to.
 */
export const SECURITY_EVENT_EXCLUDE_FACET_PREFIX: string = "!";

export function isSecurityEventExcludeFacetKey(facetKey: string): boolean {
  return facetKey.startsWith(SECURITY_EVENT_EXCLUDE_FACET_PREFIX);
}

export function toSecurityEventExcludeFacetKey(facetKey: string): string {
  return isSecurityEventExcludeFacetKey(facetKey)
    ? facetKey
    : `${SECURITY_EVENT_EXCLUDE_FACET_PREFIX}${facetKey}`;
}

/** The plain facet key an include-or-exclude key stands for. */
export function getSecurityEventBaseFacetKey(facetKey: string): string {
  return isSecurityEventExcludeFacetKey(facetKey)
    ? facetKey.substring(SECURITY_EVENT_EXCLUDE_FACET_PREFIX.length)
    : facetKey;
}

export function isSecurityEventAttributeFacetKey(facetKey: string): boolean {
  return getSecurityEventBaseFacetKey(facetKey).startsWith(
    SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX,
  );
}

export function getSecurityEventAttributeKey(facetKey: string): string {
  return getSecurityEventBaseFacetKey(facetKey).substring(
    SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX.length,
  );
}

/*
 * Which OneUptime source the event was attributed to — a Telemetry Service
 * standing for the SIEM or connector it arrived from. It is also the column
 * @OwnedThrough narrows on.
 */
export const SECURITY_EVENT_SOURCE_FACET_KEY: string = "primaryEntityId";

/*
 * The columns the facet sidebar offers, in its order (the Dashboard's
 * SECURITY_EVENT_FACETS gives each its title). A chip names one of them, or
 * a source attribute.
 */
export const SECURITY_EVENT_FACET_COLUMNS: ReadonlyArray<string> = [
  SECURITY_EVENT_SOURCE_FACET_KEY,
  "severityName",
  "requestOutcome",
  "className",
  "categoryName",
  "activityName",
  "statusName",
  "vendorName",
  "productName",
  "ruleName",
  "principalUser",
  "principalHost",
  "processName",
  "parentProcessName",
];

/*
 * Whether a chip's key is one the sidebar can make: a facet column or a
 * source attribute with a key, either one included or excluded.
 */
export function isSecurityEventChipKey(facetKey: string): boolean {
  const baseKey: string = getSecurityEventBaseFacetKey(facetKey);

  if (isSecurityEventAttributeFacetKey(baseKey)) {
    return getSecurityEventAttributeKey(baseKey).length > 0;
  }

  return SECURITY_EVENT_FACET_COLUMNS.includes(baseKey);
}

function compileFacetSelection(
  values: Array<string>,
  isExcluded: boolean,
): unknown {
  if (isExcluded) {
    return values.length === 1
      ? new NotEqual(values[0]!)
      : new IncludesNone(values);
  }

  /*
   * A single value compiles to a bare string so ClickHouse gets the plain
   * equality — and with it the column's Set / bloom skip index. More than
   * one becomes an `Includes`, which is an `IN`.
   */
  return values.length === 1 ? values[0]! : new Includes(values);
}

/*
 * Compile the sidebar's selections into the list query.
 *
 * Attribute chips land in `attributes[<key>]`. Their values come from the
 * data — an attribute copied off a row, a facet value clicked — so they are
 * compiled as equality, which is both exact and the fast
 * `attributes['k'] = 'v'` map-subscript path.
 *
 * Exclusions are written FIRST so that an include on the same column wins:
 * holding both is a transient state the sidebar cannot reach on purpose,
 * and a list narrowed to a value is a more useful reading of the two chips
 * than one that excludes what it also requires and returns nothing.
 */
export function applySecurityEventFacetFiltersToQuery(data: {
  query: Query<SecurityEvent>;
  filters: Map<string, Set<string>>;
}): Query<SecurityEvent> {
  const query: Query<SecurityEvent> = { ...data.query };
  const attributes: Record<string, unknown> = {
    ...(((query as Record<string, unknown>)["attributes"] as Record<
      string,
      unknown
    >) || {}),
  };

  const entries: Array<[string, Set<string>]> = Array.from(
    data.filters.entries(),
  ).sort((a: [string, Set<string>], b: [string, Set<string>]): number => {
    const aExcluded: number = isSecurityEventExcludeFacetKey(a[0]) ? 0 : 1;
    const bExcluded: number = isSecurityEventExcludeFacetKey(b[0]) ? 0 : 1;

    return aExcluded - bExcluded;
  });

  for (const [facetKey, valueSet] of entries) {
    const values: Array<string> = Array.from(valueSet).filter(
      (value: string): boolean => {
        return value.length > 0;
      },
    );

    if (values.length === 0) {
      continue;
    }

    const isExcluded: boolean = isSecurityEventExcludeFacetKey(facetKey);
    const compiled: unknown = compileFacetSelection(values, isExcluded);

    if (isSecurityEventAttributeFacetKey(facetKey)) {
      const attributeKey: string = getSecurityEventAttributeKey(facetKey);

      if (attributeKey.length === 0) {
        continue;
      }

      attributes[attributeKey] = compiled;
      continue;
    }

    (query as Record<string, unknown>)[getSecurityEventBaseFacetKey(facetKey)] =
      compiled;
  }

  if (Object.keys(attributes).length > 0) {
    (query as Record<string, unknown>)["attributes"] = attributes;
  }

  return query;
}

/*
 * The search and the chips over a base query (the project and the window),
 * in the order the Events page lays them: the search first, the chips
 * second - a chip is an explicit click on a value the person can see and
 * take off, so when both name the same column the chip is the one they are
 * steering with.
 */
export function buildSecurityEventSearchQuery(data: {
  base: Query<SecurityEvent>;
  search: string;
  filters: Map<string, Set<string>>;
}): Query<SecurityEvent> {
  return applySecurityEventFacetFiltersToQuery({
    query: applySecurityEventSearchToQuery({
      query: data.base,
      filters: parseSecurityEventSearch(data.search),
    }),
    filters: data.filters,
  });
}
