import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import { SearchHelpRow } from "Common/UI/Components/TelemetryViewer/types";
import {
  SearchQueryValue,
  SearchToken,
  SearchTokenType,
  SearchValueOperator,
  parseSearchQuery,
  predicateToQueryValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";

/*
 * The Security Events search bar, compiled.
 *
 * It speaks the shared telemetry search grammar
 * (Common/Types/Telemetry/TelemetrySearchQuery) rather than a dialect of its
 * own, so `severity:High`, `-@threat.matched:true`, `user:(alice OR bob)` and
 * `@device.hostname:web-*` mean here exactly what their counterparts mean in
 * the logs, traces and exceptions explorers. This module only supplies the
 * three things the grammar cannot know: which field names this signal has,
 * which of its columns are numeric, and how a parsed token lands on a
 * SecurityEvent query.
 *
 * Pure and React-free: App/Tests pin every field name and operator here
 * without mounting the viewer.
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
 * event mentions X" is asked (the same predicate the Correlate tab pivots
 * on). An explicit operator the user typed (`!`, `~`, `>`, a glob, a list)
 * always wins over this default.
 */
export const SECURITY_EVENT_CONTAINS_FIELDS: ReadonlySet<string> =
  new Set<string>([
    "message",
    "observables",
    "mitreTactics",
    "mitreTechniques",
    "principalProcess",
    "targetResource",
  ]);

export const SECURITY_EVENT_SEARCH_SUGGESTIONS: ReadonlyArray<string> = [
  "severity",
  "class",
  "category",
  "activity",
  "status",
  "vendor",
  "product",
  "rule",
  "user",
  "host",
  "ip",
  "targetuser",
  "targethost",
  "targetip",
  "observable",
  "tactic",
  "technique",
];

export const SECURITY_EVENT_SEARCH_PLACEHOLDER: string =
  "Search security events — e.g. severity:Critical class:Authentication @threat.matched:true";

export const SECURITY_EVENT_SEARCH_COMBINED_EXAMPLE: string =
  "severity:(High OR Critical) -status:Success @threat.matched:true";

/*
 * Every row is honoured by the shared grammar and pinned by a test, so the
 * help cannot advertise syntax the parser does not have.
 */
export const SECURITY_EVENT_SEARCH_HELP_ROWS: ReadonlyArray<SearchHelpRow> = [
  {
    syntax: "free text",
    description: "Search event messages",
    example: "failed logon",
  },
  {
    syntax: '"quoted phrase"',
    description: "Keep spaces together",
    example: '"brute force"',
  },
  {
    syntax: "severity:<level>",
    description:
      "Filter by OCSF severity — Informational, Low, Medium, High, Critical, Fatal",
    example: "severity:Critical",
  },
  {
    syntax: "class:<class>",
    description: "Filter by OCSF event class",
    example: "class:Authentication",
  },
  {
    syntax: "status:<outcome>",
    description: "Filter by outcome — Success, Failure, Blocked, ...",
    example: "status:Failure",
  },
  {
    syntax: "user:<name>",
    description: "Filter by the acting principal",
    example: "user:svc-deploy",
  },
  {
    syntax: "host:<name>",
    description: "Filter by the acting host",
    example: "host:web-01",
  },
  {
    syntax: "observable:<value>",
    description: "Any event mentioning this user, host, IP, domain or hash",
    example: "observable:10.0.0.4",
  },
  {
    syntax: "technique:<id>",
    description: "Filter by MITRE ATT&CK technique or tactic id",
    example: "technique:T1110",
  },
  {
    syntax: "@<attr>:<value>",
    description: "Filter by a source attribute",
    example: "@threat.matched:true",
  },
  {
    syntax: "@<attr>:<value>*",
    description: "Wildcard — * is any text, ? is one character",
    example: "@device.hostname:web-*",
  },
  {
    syntax: "@<attr>:*",
    description: "Attribute is present",
    example: "@threat.indicator:*",
  },
  {
    syntax: "@<attr>:~<text>",
    description: "Attribute contains",
    example: "@finding_info.title:~ransom",
  },
  {
    syntax: "-<filter>",
    description: "Negate any filter",
    example: "-severity:Informational",
  },
  {
    syntax: "<field>:(a OR b)",
    description: "Any of these values",
    example: "severity:(High OR Critical)",
  },
];

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
