import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import NotOnWatchlist from "../BaseDatabase/NotOnWatchlist";
import OnWatchlist from "../BaseDatabase/OnWatchlist";
import Query from "../BaseDatabase/Query";
import QueryOperator from "../BaseDatabase/QueryOperator";
import { JSONObject } from "../JSON";
import {
  getSecurityWatchlistNameKey,
  getSecurityWatchlistSnippetField,
  isSecurityWatchlistName,
  normalizeSecurityWatchlistName,
} from "./SecurityWatchlist";

/*
 * READING A WATCHLIST OUTSIDE A RULE.
 *
 * A detection rule reads a list in its YAML (`principalUser|expand:
 * '%vip_users%'`). A Security Events monitor, a hunt and the Events search
 * read one too, as their filters: only the events whose field is - or is
 * not - on one of the project's watchlists. Each puts the list's name in
 * its query as an operator (OnWatchlist, NotOnWatchlist on the field), and
 * the server reads the list and matches it exactly as a rule's read does
 * (SecurityWatchlistQueryBinder, then SecurityWatchlistMatch): whatever the
 * case, * for any run of characters, an IP address list's ranges as ranges,
 * a list that follows a feed as the feed's active indicators.
 *
 *   - A monitor keeps its filters as rows - a field, a list, on or not on
 *     (SecurityWatchlistFilter) - and adds them to the query it counts.
 *   - A hunt and the Events search write `user:%vip_users%`, and
 *     `-ip:%admin_addresses%` for "not on" (SecurityEventSearch).
 *
 * Whatever reads a list keeps it by its name, as a rule does: a list read
 * this way is neither renamed nor deleted while something reads it
 * (SecurityWatchlists.findReaders).
 *
 * React-free and server-free: the monitor form, the Dashboard's Events page
 * and the server read the same rows the same way.
 */

/*
 * The event fields a monitor's watchlist filter reads, in the order its
 * form offers them: who acted, what they acted on, the process, and every
 * address, domain, URL and hash the event names.
 */
export const SECURITY_WATCHLIST_FILTER_FIELDS: ReadonlyArray<string> = [
  "principalUser",
  "principalHost",
  "principalIp",
  "targetUser",
  "targetHost",
  "targetIp",
  "processName",
  "observables",
];

// The most watchlist filters one monitor keeps: a monitor counts one thing.
export const SECURITY_WATCHLIST_FILTERS_MAX: number = 10;

export interface SecurityWatchlistFilter {
  // The event field, one of SECURITY_WATCHLIST_FILTER_FIELDS.
  field: string;
  // The list's name, as rules write it.
  watchlist: string;
  // The field is not on the list: an allow list.
  isNotOnList?: boolean | undefined;
}

/*
 * What is wrong with a monitor's watchlist filters, each in the words the
 * form and the API both say. Kept as `{ message }` objects so the
 * Dashboard's string extractor reads each as a translation key.
 */
export const SECURITY_WATCHLIST_FILTER_MESSAGES: {
  chooseWatchlist: { message: string };
  chooseField: { message: string };
  tooManyFilters: { message: string };
} = {
  chooseWatchlist: { message: "Choose the watchlist each filter reads." },
  chooseField: { message: "Choose the field each filter reads a list in." },
  tooManyFilters: {
    message: "A monitor reads at most 10 watchlist filters.",
  },
};

export function isSecurityWatchlistFilterField(value: unknown): boolean {
  return (
    typeof value === "string" &&
    SECURITY_WATCHLIST_FILTER_FIELDS.includes(value)
  );
}

/*
 * The field a new filter of a list of this kind starts on: the field a
 * list of its kind is usually in, as Use This List's snippets start
 * (User: principalUser; a kind with no field of its own: observables).
 */
export function getDefaultSecurityWatchlistFilterField(
  entityType: unknown,
): string {
  const field: string = getSecurityWatchlistSnippetField(entityType);

  return isSecurityWatchlistFilterField(field) ? field : "observables";
}

/*
 * A monitor's stored filters, as written: each row with a field and a
 * list's name. A row that is not one - JSON from an older version, a value
 * someone hand-edited - is left out, never read as a list.
 */
export function readSecurityWatchlistFilters(
  value: unknown,
): Array<SecurityWatchlistFilter> {
  if (!Array.isArray(value)) {
    return [];
  }

  const filters: Array<SecurityWatchlistFilter> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const row: JSONObject = item as JSONObject;
    const field: unknown = row["field"];
    const watchlist: unknown = row["watchlist"];

    filters.push({
      field: typeof field === "string" ? field.trim() : "",
      watchlist: normalizeSecurityWatchlistName(watchlist),
      isNotOnList: row["isNotOnList"] === true,
    });
  }

  return filters;
}

// The filters as JSON: what a monitor's step stores.
export function toSecurityWatchlistFiltersJSON(
  filters: ReadonlyArray<SecurityWatchlistFilter> | undefined,
): Array<JSONObject> {
  return (filters || []).map((filter: SecurityWatchlistFilter): JSONObject => {
    return {
      field: filter.field,
      watchlist: normalizeSecurityWatchlistName(filter.watchlist),
      isNotOnList: Boolean(filter.isNotOnList),
    };
  });
}

/*
 * What is wrong with a monitor's filters, or null: every row names a field
 * a list is read in and a list, and there are no more than the most a
 * monitor keeps. Whether the project has each list is the server's to say.
 */
export function getSecurityWatchlistFiltersProblem(
  filters: ReadonlyArray<SecurityWatchlistFilter> | undefined,
): string | null {
  const rows: ReadonlyArray<SecurityWatchlistFilter> = filters || [];

  if (rows.length > SECURITY_WATCHLIST_FILTERS_MAX) {
    return SECURITY_WATCHLIST_FILTER_MESSAGES.tooManyFilters.message;
  }

  for (const row of rows) {
    if (!isSecurityWatchlistName(row.watchlist)) {
      return SECURITY_WATCHLIST_FILTER_MESSAGES.chooseWatchlist.message;
    }

    if (!isSecurityWatchlistFilterField(row.field)) {
      return SECURITY_WATCHLIST_FILTER_MESSAGES.chooseField.message;
    }
  }

  return null;
}

// One operator added to what a query already says of a field: both hold.
function addOperator(
  query: Record<string, unknown>,
  field: string,
  operator: QueryOperator<string>,
): void {
  const existing: unknown = query[field];

  if (existing === undefined || existing === null) {
    query[field] = operator;
    return;
  }

  query[field] = Array.isArray(existing)
    ? [...existing, operator]
    : [existing, operator];
}

/*
 * A monitor's filters over its query: each row that names a field and a
 * list adds OnWatchlist (NotOnWatchlist for "not on") to that field, so a
 * field read against two lists must be on - or off - both. A row that does
 * not name both is left out, as the form shows it unfinished. A new query:
 * the one given is left as it was.
 */
export function applySecurityWatchlistFiltersToQuery(
  query: Query<SecurityEvent>,
  filters: ReadonlyArray<SecurityWatchlistFilter> | undefined,
): Query<SecurityEvent> {
  const result: Record<string, unknown> = { ...query };

  for (const filter of filters || []) {
    if (
      !isSecurityWatchlistFilterField(filter.field) ||
      !isSecurityWatchlistName(filter.watchlist)
    ) {
      continue;
    }

    const name: string = normalizeSecurityWatchlistName(filter.watchlist);

    addOperator(
      result,
      filter.field,
      filter.isNotOnList ? new NotOnWatchlist(name) : new OnWatchlist(name),
    );
  }

  return result as Query<SecurityEvent>;
}

/*
 * WHAT READS A LIST. Rules, Security Events monitors and hunts keep a list
 * by its name, so a list one of them reads keeps it: it is neither renamed
 * nor deleted while one names it, and its page says which do.
 */
export enum WatchlistReaderKind {
  DetectionRule = "Detection Rule",
  Monitor = "Monitor",
  Hunt = "Hunt",
}

export interface WatchlistReader {
  kind: WatchlistReaderKind;
  id: string;
  name: string;
}

// What a refusal calls each kind of reader, after its name.
const READER_KIND_WORDS: Readonly<Record<WatchlistReaderKind, string>> = {
  [WatchlistReaderKind.DetectionRule]: "rule",
  [WatchlistReaderKind.Monitor]: "monitor",
  [WatchlistReaderKind.Hunt]: "hunt",
};

/*
 * The readers of a list, named for a refusal: up to three, each with what
 * it is - "Admin sign-in (rule), VIP failures (monitor)" - then how many
 * more.
 */
export function describeWatchlistReaders(
  readers: ReadonlyArray<WatchlistReader>,
): string {
  const names: Array<string> = readers.map(
    (reader: WatchlistReader): string => {
      const kind: string = READER_KIND_WORDS[reader.kind] || "rule";
      return `${reader.name || `a ${kind} with no name`} (${kind})`;
    },
  );

  if (names.length <= 3) {
    return names.join(", ");
  }

  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/*
 * A monitor's filters as the Events search writes them, one each:
 * `principalUser:%vip_users%`, and `-principalIp:%admin_addresses%` for
 * "is not on". A row that does not name a field and a list is left out.
 */
export function describeSecurityWatchlistFilters(
  filters: ReadonlyArray<SecurityWatchlistFilter> | undefined,
): Array<string> {
  return (filters || [])
    .filter((filter: SecurityWatchlistFilter): boolean => {
      return (
        isSecurityWatchlistFilterField(filter.field) &&
        isSecurityWatchlistName(filter.watchlist)
      );
    })
    .map((filter: SecurityWatchlistFilter): string => {
      return `${filter.isNotOnList ? "-" : ""}${filter.field}:%${normalizeSecurityWatchlistName(
        filter.watchlist,
      )}%`;
    });
}

// Whether a value is an operator that reads a watchlist.
export function isWatchlistOperator(
  value: unknown,
): value is OnWatchlist | NotOnWatchlist {
  return value instanceof OnWatchlist || value instanceof NotOnWatchlist;
}

/*
 * The lists a query reads, each once in the order it names them, as it
 * wrote them: its fields', each element of a field's AND, and its source
 * attributes'. What the server reads before a query is compiled, and what
 * says which lists a monitor or a hunt reads.
 */
export function getWatchlistNamesInQuery(query: unknown): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set();

  const visit: (value: unknown) => void = (value: unknown): void => {
    if (isWatchlistOperator(value)) {
      const key: string = getSecurityWatchlistNameKey(value.value);

      if (key && !seen.has(key)) {
        seen.add(key);
        names.push(normalizeSecurityWatchlistName(value.value));
      }

      return;
    }

    if (Array.isArray(value)) {
      value.forEach(visit);
    }
  };

  if (!query || typeof query !== "object") {
    return names;
  }

  for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
    if (
      key === "attributes" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof QueryOperator)
    ) {
      Object.values(value as Record<string, unknown>).forEach(visit);
      continue;
    }

    visit(value);
  }

  return names;
}
