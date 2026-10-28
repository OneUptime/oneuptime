import {
  SecurityEntityType,
  isIpAddress,
} from "../SecurityCase/SecurityEntity";
import { isDetectionRuleExceptionCidr } from "./DetectionRuleException";
import { ThreatIntelIndicatorType } from "./ThreatIntelConstants";

/*
 * WATCHLISTS: LISTS A TEAM KEEPS THAT RULES MATCH AGAINST.
 *
 * VIP users, critical hosts, known-bad file hashes, the addresses admins
 * may sign in from: values a team knows about its own world, kept in one
 * list each so every detection and correlation rule can read them by name
 * rather than repeat them. A rule reads a watchlist the way Sigma writes a
 * value kept outside the rule - a placeholder, with the `expand` modifier:
 *
 *   detection:
 *     selection:
 *       principalUser|expand: '%vip_users%'
 *     condition: selection
 *
 * A watchlist holds one kind of thing (users, hosts, IP addresses...) and
 * its values come from one of two places:
 *
 *   - values the team keeps: added by hand or imported from a file, each
 *     with an optional note;
 *   - a threat intel feed: the feed's active indicators of the list's kind,
 *     kept up to date by the feed itself (an IP address list follows a
 *     feed's addresses).
 *
 * Values are matched as rule exceptions, protected entities and entity
 * criticality match theirs: whatever the case, with * for any run of
 * characters (svc-* is every service account), and an IP address list may
 * hold ranges (10.20.0.0/16).
 *
 * Kept free of anything server-side: the Dashboard's forms, the import and
 * the list read the same rules the API enforces. Each message below is a
 * Dashboard translation key, read from here by the string extractor, so a
 * form shows it in the reader's language and the API answers in the same
 * words.
 */

// Where a watchlist's values come from.
export enum SecurityWatchlistSource {
  // Values the team adds by hand or imports.
  Values = "Values",
  // A threat intel feed's active indicators of the list's kind.
  ThreatIntelFeed = "Threat Intel Feed",
}

export const SECURITY_WATCHLIST_SOURCES: ReadonlyArray<SecurityWatchlistSource> =
  [SecurityWatchlistSource.Values, SecurityWatchlistSource.ThreatIntelFeed];

/*
 * What a watchlist can hold, in the order the form offers them: the kinds
 * of entity a security event names, and Other for any value (an
 * application, a user agent, a country).
 */
export const SECURITY_WATCHLIST_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> =
  [
    SecurityEntityType.User,
    SecurityEntityType.Host,
    SecurityEntityType.IpAddress,
    SecurityEntityType.FileHash,
    SecurityEntityType.Domain,
    SecurityEntityType.Url,
    SecurityEntityType.Process,
    SecurityEntityType.Other,
  ];

/*
 * The indicator types a watchlist of each kind takes from a threat intel
 * feed. Users, hosts, processes and other values have no indicator type: a
 * list of them is kept by the team.
 */
export const SECURITY_WATCHLIST_FEED_INDICATOR_TYPES: Readonly<
  Partial<Record<SecurityEntityType, ReadonlyArray<ThreatIntelIndicatorType>>>
> = {
  [SecurityEntityType.IpAddress]: [
    ThreatIntelIndicatorType.Ipv4Address,
    ThreatIntelIndicatorType.Ipv6Address,
  ],
  [SecurityEntityType.FileHash]: [
    ThreatIntelIndicatorType.FileHashSha256,
    ThreatIntelIndicatorType.FileHashSha1,
    ThreatIntelIndicatorType.FileHashMd5,
  ],
  [SecurityEntityType.Domain]: [ThreatIntelIndicatorType.DomainName],
  [SecurityEntityType.Url]: [ThreatIntelIndicatorType.Url],
};

// The kinds a watchlist can take from a threat intel feed, in the form's order.
export const SECURITY_WATCHLIST_FEED_ENTITY_TYPES: ReadonlyArray<SecurityEntityType> =
  SECURITY_WATCHLIST_ENTITY_TYPES.filter(
    (type: SecurityEntityType): boolean => {
      return Boolean(SECURITY_WATCHLIST_FEED_INDICATOR_TYPES[type]);
    },
  );

/*
 * The event field a rule most often matches a watchlist of each kind
 * against: the snippet a watchlist's page offers starts with it. A kind
 * with no field of its own is looked for among the event's observables,
 * which hold every address, domain, URL and hash an event names.
 */
export const SECURITY_WATCHLIST_SNIPPET_FIELDS: Readonly<
  Record<string, string>
> = {
  [SecurityEntityType.User]: "principalUser",
  [SecurityEntityType.Host]: "principalHost",
  [SecurityEntityType.IpAddress]: "principalIp",
  [SecurityEntityType.Process]: "processName",
};

export const SECURITY_WATCHLIST_DEFAULT_SNIPPET_FIELD: string = "observables";

// The Sigma modifier a rule reads a watchlist with: `field|expand: '%name%'`.
export const SECURITY_WATCHLIST_MODIFIER: string = "expand";

// What wraps a watchlist's name in a rule: '%vip_users%'.
export const SECURITY_WATCHLIST_PLACEHOLDER_MARK: string = "%";

/*
 * Limits. A name is what rules write, so it is short and plain. A list's
 * values travel to the database with every run of a rule that reads it, so
 * a list stays a size one run can send; a pattern or a range costs a
 * comparison of its own for every event, so a list keeps few of them. A
 * list too long to keep by hand belongs in a threat intel feed, which a
 * watchlist can follow without a limit of its own.
 */
export const SECURITY_WATCHLIST_NAME_MAX_LENGTH: number = 50;
export const SECURITY_WATCHLIST_DESCRIPTION_MAX_LENGTH: number = 500;
export const SECURITY_WATCHLIST_VALUES_MAX: number = 5000;
export const SECURITY_WATCHLIST_PATTERN_VALUES_MAX: number = 100;
export const SECURITY_WATCHLIST_RANGE_VALUES_MAX: number = 100;
export const SECURITY_WATCHLIST_VALUE_MAX_LENGTH: number = 256;
export const SECURITY_WATCHLIST_NOTE_MAX_LENGTH: number = 500;
// The most watchlists one project keeps.
export const SECURITY_WATCHLISTS_PER_PROJECT_MAX: number = 200;
// The most text one import reads: 5,000 lines of a long value and a note.
export const SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS: number = 4 * 1024 * 1024;

export const SECURITY_WATCHLIST_WILDCARD: string = "*";

/*
 * A name: a letter, then letters, digits and underscores - the words a
 * Sigma placeholder is made of, so a rule written for another tool reads
 * the same list.
 */
const NAME_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9_]*$/;
// A file hash: the hex digest of MD5, SHA-1, SHA-256 or SHA-512.
const FILE_HASH_REGEX: RegExp =
  /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{128})$/i;

/*
 * Every problem the rules below answer with, as Dashboard translation keys:
 * the string extractor reads each `message`, so a form shows it in the
 * reader's language, and the API answers in the same words. The numbers
 * are written out, so a translator reads whole sentences; a test holds each
 * one to its constant.
 */
export const SECURITY_WATCHLIST_MESSAGES: {
  enterValue: { message: string };
  loneWildcard: { message: string };
  valueTooLong: { message: string };
  valueNotOneLine: { message: string };
  notAnAddress: { message: string };
  notAHash: { message: string };
  noteTooLong: { message: string };
  enterName: { message: string };
  nameTooLong: { message: string };
  nameCharacters: { message: string };
  tooManyValues: { message: string };
  tooManyPatterns: { message: string };
  tooManyRanges: { message: string };
} = {
  enterValue: { message: "Enter a value." },
  loneWildcard: { message: "A value of only * would match everything." },
  valueTooLong: { message: "A value is at most 256 characters." },
  valueNotOneLine: { message: "A value is one line, without tabs." },
  notAnAddress: {
    message:
      "Enter an IP address, a range such as 10.20.0.0/16, or a pattern with *.",
  },
  notAHash: { message: "Enter an MD5, SHA-1, SHA-256 or SHA-512 hash." },
  noteTooLong: { message: "A note is at most 500 characters." },
  enterName: { message: "Enter a name, such as vip_users." },
  nameTooLong: { message: "A name is at most 50 characters." },
  nameCharacters: {
    message:
      "Use letters, digits and underscores, starting with a letter, such as vip_users.",
  },
  tooManyValues: {
    message:
      "A watchlist holds at most 5,000 values. Follow a threat intel feed for a longer list.",
  },
  tooManyPatterns: { message: "A watchlist holds at most 100 values with *." },
  tooManyRanges: { message: "A watchlist holds at most 100 address ranges." },
};

// How a value matches: as written, as a pattern with *, or as an address range.
export enum SecurityWatchlistValueMatch {
  Exact = "exact",
  Pattern = "pattern",
  Range = "range",
}

/*
 * A watchlist as a rule's run reads it: its values split by how they
 * match, lowercased (ranges as written), or the feed whose active
 * indicators it follows. What the server binds to a rule before it is
 * compiled (SecurityWatchlists), and what the compiler turns into SQL.
 */
export interface SigmaWatchlist {
  // As the project wrote it.
  name: string;
  entityType: SecurityEntityType;
  exactValues: Array<string>;
  patterns: Array<string>;
  ranges: Array<string>;
  threatIntelFeed?:
    | {
        // The list's project: the feed's indicators are read in it alone.
        projectId: string;
        feedId: string;
        indicatorTypes: Array<string>;
      }
    | undefined;
}

// The watchlists a rule reads, by their name keys (getSecurityWatchlistNameKey).
export type SigmaWatchlists = Record<string, SigmaWatchlist>;

export function isSecurityWatchlistSource(
  value: unknown,
): value is SecurityWatchlistSource {
  return (
    typeof value === "string" &&
    (SECURITY_WATCHLIST_SOURCES as ReadonlyArray<string>).includes(value)
  );
}

export function isSecurityWatchlistEntityType(
  value: unknown,
): value is SecurityEntityType {
  return (
    typeof value === "string" &&
    (SECURITY_WATCHLIST_ENTITY_TYPES as ReadonlyArray<string>).includes(value)
  );
}

export function canSecurityWatchlistFollowFeed(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (SECURITY_WATCHLIST_FEED_ENTITY_TYPES as ReadonlyArray<string>).includes(
      value,
    )
  );
}

// The indicator types a list of this kind follows in a feed: empty for a kind no feed carries.
export function getSecurityWatchlistFeedIndicatorTypes(
  entityType: unknown,
): Array<string> {
  if (!canSecurityWatchlistFollowFeed(entityType)) {
    return [];
  }

  return [
    ...(SECURITY_WATCHLIST_FEED_INDICATOR_TYPES[
      entityType as SecurityEntityType
    ] || []),
  ];
}

// A name as stored: trimmed.
export function normalizeSecurityWatchlistName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * The key a name is found by: names are told apart whatever their case, so
 * VIP_Users and vip_users are one list, and a rule may write either.
 */
export function getSecurityWatchlistNameKey(value: unknown): string {
  return normalizeSecurityWatchlistName(value).toLowerCase();
}

export function isSecurityWatchlistName(value: unknown): boolean {
  const name: string = normalizeSecurityWatchlistName(value);

  return (
    name.length > 0 &&
    name.length <= SECURITY_WATCHLIST_NAME_MAX_LENGTH &&
    NAME_REGEX.test(name)
  );
}

// What a rule writes for a watchlist: '%vip_users%'.
export function getSecurityWatchlistPlaceholder(name: string): string {
  return `${SECURITY_WATCHLIST_PLACEHOLDER_MARK}${normalizeSecurityWatchlistName(
    name,
  )}${SECURITY_WATCHLIST_PLACEHOLDER_MARK}`;
}

/*
 * The watchlist a rule's value names, or null when the value is not a
 * placeholder: the whole value, a name between two % signs.
 */
export function readSecurityWatchlistPlaceholder(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();
  const mark: string = SECURITY_WATCHLIST_PLACEHOLDER_MARK;

  if (
    text.length < 3 ||
    !text.startsWith(mark) ||
    !text.endsWith(mark) ||
    text.slice(1, -1).includes(mark)
  ) {
    return null;
  }

  const name: string = text.slice(1, -1);

  return isSecurityWatchlistName(name) ? name : null;
}

/*
 * What a rule that names lists the project does not have is told: when it
 * is saved, and as its error should a list it reads be gone at a run.
 */
export function getMissingSecurityWatchlistsMessage(
  names: ReadonlyArray<string>,
): string {
  const list: string = names.join(", ");

  return names.length > 1
    ? `There are no watchlists named ${list} in this project. Create them under Security Events > Detections > Watchlists, or fix their names in the rule.`
    : `There is no watchlist named ${list} in this project. Create it under Security Events > Detections > Watchlists, or fix its name in the rule.`;
}

// The event field the snippet for a list of this kind matches.
export function getSecurityWatchlistSnippetField(entityType: unknown): string {
  return typeof entityType === "string" &&
    Object.prototype.hasOwnProperty.call(
      SECURITY_WATCHLIST_SNIPPET_FIELDS,
      entityType,
    )
    ? SECURITY_WATCHLIST_SNIPPET_FIELDS[entityType]!
    : SECURITY_WATCHLIST_DEFAULT_SNIPPET_FIELD;
}

/*
 * A rule that reads the watchlist, to copy into Detection Rules: the
 * selection matches the list's usual field, and the rule fires on it.
 */
export function getSecurityWatchlistRuleSnippet(data: {
  name: string;
  entityType: unknown;
}): string {
  const field: string = getSecurityWatchlistSnippetField(data.entityType);

  return [
    "detection:",
    "  selection:",
    `    ${field}|${SECURITY_WATCHLIST_MODIFIER}: '${getSecurityWatchlistPlaceholder(
      data.name,
    )}'`,
    "  condition: selection",
  ].join("\n");
}

// A value as stored: trimmed, with no run of wildcards.
export function normalizeSecurityWatchlistValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let text: string = value.trim();

  while (text.includes("**")) {
    text = text.split("**").join("*");
  }

  return text;
}

// The key a value is told apart by in its list: whatever the case.
export function getSecurityWatchlistValueKey(value: unknown): string {
  return normalizeSecurityWatchlistValue(value).toLowerCase();
}

// A note as stored: trimmed.
export function normalizeSecurityWatchlistNote(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/*
 * How a value matches events: an address range in an IP address list, a
 * pattern when it holds a *, or as written.
 */
export function getSecurityWatchlistValueMatch(data: {
  value: string;
  entityType: unknown;
}): SecurityWatchlistValueMatch {
  const value: string = normalizeSecurityWatchlistValue(data.value);

  if (
    data.entityType === SecurityEntityType.IpAddress &&
    isDetectionRuleExceptionCidr(value)
  ) {
    return SecurityWatchlistValueMatch.Range;
  }

  if (value.includes(SECURITY_WATCHLIST_WILDCARD)) {
    return SecurityWatchlistValueMatch.Pattern;
  }

  return SecurityWatchlistValueMatch.Exact;
}

// Whether the text holds a character no value carries: a tab, a line break, any control character.
function hasControlCharacter(text: string): boolean {
  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);

    if (code < 32 || code === 127) {
      return true;
    }
  }

  return false;
}

/*
 * What is wrong with one value for a list of this kind, or null when it can
 * be kept: missing, a lone * (which would match everything), too long, or
 * not what the list holds - an IP address list holds addresses, ranges and
 * patterns, and a file hash list hex digests.
 */
export function getSecurityWatchlistValueProblem(data: {
  value: unknown;
  entityType: unknown;
}): string | null {
  const value: string = normalizeSecurityWatchlistValue(data.value);

  if (!value) {
    return SECURITY_WATCHLIST_MESSAGES.enterValue.message;
  }

  if (value === SECURITY_WATCHLIST_WILDCARD) {
    return SECURITY_WATCHLIST_MESSAGES.loneWildcard.message;
  }

  if (value.length > SECURITY_WATCHLIST_VALUE_MAX_LENGTH) {
    return SECURITY_WATCHLIST_MESSAGES.valueTooLong.message;
  }

  if (hasControlCharacter(value)) {
    return SECURITY_WATCHLIST_MESSAGES.valueNotOneLine.message;
  }

  if (data.entityType === SecurityEntityType.IpAddress) {
    if (
      !isIpAddress(value) &&
      !isDetectionRuleExceptionCidr(value) &&
      !value.includes(SECURITY_WATCHLIST_WILDCARD)
    ) {
      return SECURITY_WATCHLIST_MESSAGES.notAnAddress.message;
    }
  }

  if (
    data.entityType === SecurityEntityType.FileHash &&
    !FILE_HASH_REGEX.test(value)
  ) {
    return SECURITY_WATCHLIST_MESSAGES.notAHash.message;
  }

  return null;
}

// What is wrong with a note, or null.
export function getSecurityWatchlistNoteProblem(value: unknown): string | null {
  if (
    normalizeSecurityWatchlistNote(value).length >
    SECURITY_WATCHLIST_NOTE_MAX_LENGTH
  ) {
    return SECURITY_WATCHLIST_MESSAGES.noteTooLong.message;
  }

  return null;
}

/*
 * WHAT IS WRONG WITH A WATCHLIST, field by field: the form shows each
 * problem under its own field, and the API answers a save with the first.
 */
export type SecurityWatchlistFormField =
  | "name"
  | "entityType"
  | "description"
  | "source"
  | "threatIntelFeedId";

export interface SecurityWatchlistProblem {
  field: SecurityWatchlistFormField;
  message: string;
}

// A watchlist as the rules here read it: the stored row, or a form's values.
export interface SecurityWatchlistShape {
  name?: string | null | undefined;
  entityType?: string | null | undefined;
  description?: string | null | undefined;
  source?: string | null | undefined;
  threatIntelFeedId?: unknown;
}

export function getSecurityWatchlistNameProblem(value: unknown): string | null {
  const name: string = normalizeSecurityWatchlistName(value);

  if (!name) {
    return SECURITY_WATCHLIST_MESSAGES.enterName.message;
  }

  if (name.length > SECURITY_WATCHLIST_NAME_MAX_LENGTH) {
    return SECURITY_WATCHLIST_MESSAGES.nameTooLong.message;
  }

  if (!NAME_REGEX.test(name)) {
    return SECURITY_WATCHLIST_MESSAGES.nameCharacters.message;
  }

  return null;
}

export function getSecurityWatchlistProblems(
  watchlist: SecurityWatchlistShape,
): Array<SecurityWatchlistProblem> {
  const problems: Array<SecurityWatchlistProblem> = [];

  const nameProblem: string | null = getSecurityWatchlistNameProblem(
    watchlist.name,
  );

  if (nameProblem) {
    problems.push({ field: "name", message: nameProblem });
  }

  if (!isSecurityWatchlistEntityType(watchlist.entityType)) {
    problems.push({
      field: "entityType",
      message: "Choose what the watchlist holds.",
    });
  }

  if (
    typeof watchlist.description === "string" &&
    watchlist.description.trim().length >
      SECURITY_WATCHLIST_DESCRIPTION_MAX_LENGTH
  ) {
    problems.push({
      field: "description",
      message: "A description is at most 500 characters.",
    });
  }

  // A list kept by hand unless it says otherwise.
  const source: string = watchlist.source || SecurityWatchlistSource.Values;

  if (!isSecurityWatchlistSource(source)) {
    problems.push({
      field: "source",
      message: "Choose where the values come from.",
    });

    return problems;
  }

  if (source === SecurityWatchlistSource.ThreatIntelFeed) {
    if (
      isSecurityWatchlistEntityType(watchlist.entityType) &&
      !canSecurityWatchlistFollowFeed(watchlist.entityType)
    ) {
      problems.push({
        field: "source",
        message:
          "A threat intel feed carries IP addresses, file hashes, domains and URLs. Keep a list of anything else by hand.",
      });
    }

    if (!watchlist.threatIntelFeedId) {
      problems.push({
        field: "threatIntelFeedId",
        message: "Choose the threat intel feed to follow.",
      });
    }
  }

  return problems;
}

// The first problem, or null when the watchlist can be saved: what the API answers.
export function getSecurityWatchlistProblem(
  watchlist: SecurityWatchlistShape,
): string | null {
  const problems: Array<SecurityWatchlistProblem> =
    getSecurityWatchlistProblems(watchlist);

  return problems.length > 0 ? problems[0]!.message : null;
}

/*
 * IMPORTING VALUES: a file or a paste, one value a line. A line may carry a
 * note after the value, past a comma or a tab, so a two-column CSV (value,
 * note) imports as it is; a value in double quotes may hold a comma. Empty
 * lines and lines that start with # are skipped, and so is a first line
 * that is a CSV header (value, or value and note).
 */
export interface SecurityWatchlistImportValue {
  value: string;
  note: string;
}

export interface SecurityWatchlistImportProblem {
  // 1-based, as an editor numbers lines.
  line: number;
  value: string;
  message: string;
}

export interface SecurityWatchlistImportResult {
  values: Array<SecurityWatchlistImportValue>;
  problems: Array<SecurityWatchlistImportProblem>;
  // Lines that repeat a value an earlier line had (whatever the case).
  duplicates: number;
}

export enum SecurityWatchlistImportMode {
  // Add the values the list does not hold yet.
  Add = "add",
  // Make the list exactly the imported values.
  Replace = "replace",
}

export function isSecurityWatchlistImportMode(
  value: unknown,
): value is SecurityWatchlistImportMode {
  return (
    value === SecurityWatchlistImportMode.Add ||
    value === SecurityWatchlistImportMode.Replace
  );
}

// A CSV header's first column, and its second: skipped on the first line.
const HEADER_VALUE_NAMES: ReadonlyArray<string> = ["value", "values"];
const HEADER_NOTE_NAMES: ReadonlyArray<string> = ["", "note", "notes"];

// Whether a line read from the top of an import is a CSV header rather than a value.
function isImportHeader(read: { value: string; note: string }): boolean {
  return (
    HEADER_VALUE_NAMES.includes(read.value.trim().toLowerCase()) &&
    HEADER_NOTE_NAMES.includes(read.note.trim().toLowerCase())
  );
}

/*
 * One line's first two fields, CSV-style: split at the first comma or tab
 * outside double quotes; a quoted field drops its quotes and reads "" as ".
 * Read in one pass, never with a regular expression.
 */
export function readSecurityWatchlistImportLine(line: string): {
  value: string;
  note: string;
} {
  const fields: Array<string> = [];
  let current: string = "";
  let inQuotes: boolean = false;
  let index: number = 0;

  while (index < line.length && fields.length < 1) {
    const char: string = line[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 2;
          continue;
        }

        inQuotes = false;
        index++;
        continue;
      }

      current += char;
      index++;
      continue;
    }

    if (char === '"' && current.trim() === "") {
      current = "";
      inQuotes = true;
      index++;
      continue;
    }

    if (char === "," || char === "\t") {
      fields.push(current);
      current = "";
      index++;
      continue;
    }

    current += char;
    index++;
  }

  if (fields.length === 0) {
    return { value: current.trim(), note: "" };
  }

  // The rest of the line is the note, its quotes dropped as a CSV's are.
  let note: string = line.slice(index).trim();

  if (note.length >= 2 && note.startsWith('"') && note.endsWith('"')) {
    note = note.slice(1, -1).split('""').join('"');
  }

  return { value: fields[0]!.trim(), note: note.trim() };
}

export function parseSecurityWatchlistImport(data: {
  text: string;
  entityType: unknown;
}): SecurityWatchlistImportResult {
  const values: Array<SecurityWatchlistImportValue> = [];
  const problems: Array<SecurityWatchlistImportProblem> = [];
  const seen: Set<string> = new Set();
  let duplicates: number = 0;
  let isFirstLine: boolean = true;

  const lines: Array<string> = (data.text || "").split("\n");

  lines.forEach((rawLine: string, index: number): void => {
    // A file written on Windows ends its lines with \r\n.
    const line: string = rawLine.endsWith("\r")
      ? rawLine.slice(0, -1)
      : rawLine;
    const trimmed: string = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const read: { value: string; note: string } =
      readSecurityWatchlistImportLine(trimmed);

    // A CSV's header ("value", or "value,note") is not a value.
    if (isFirstLine) {
      isFirstLine = false;

      if (isImportHeader(read)) {
        return;
      }
    }

    const value: string = normalizeSecurityWatchlistValue(read.value);
    const problem: string | null =
      getSecurityWatchlistValueProblem({
        value,
        entityType: data.entityType,
      }) || getSecurityWatchlistNoteProblem(read.note);

    if (problem) {
      problems.push({
        line: index + 1,
        value: read.value,
        message: problem,
      });
      return;
    }

    const key: string = getSecurityWatchlistValueKey(value);

    if (seen.has(key)) {
      duplicates++;
      return;
    }

    seen.add(key);
    values.push({ value, note: normalizeSecurityWatchlistNote(read.note) });
  });

  return { values, problems, duplicates };
}

/*
 * How many values of each match a list holds, and what is wrong with the
 * list as a whole: past the most values, patterns or ranges a list keeps.
 * The API checks a list after every write that adds to it.
 */
export interface SecurityWatchlistValueCounts {
  total: number;
  patterns: number;
  ranges: number;
}

export function countSecurityWatchlistValues(data: {
  values: ReadonlyArray<string>;
  entityType: unknown;
}): SecurityWatchlistValueCounts {
  const counts: SecurityWatchlistValueCounts = {
    total: 0,
    patterns: 0,
    ranges: 0,
  };

  for (const value of data.values) {
    counts.total++;

    const match: SecurityWatchlistValueMatch = getSecurityWatchlistValueMatch({
      value,
      entityType: data.entityType,
    });

    if (match === SecurityWatchlistValueMatch.Pattern) {
      counts.patterns++;
    } else if (match === SecurityWatchlistValueMatch.Range) {
      counts.ranges++;
    }
  }

  return counts;
}

export function getSecurityWatchlistSizeProblem(
  counts: SecurityWatchlistValueCounts,
): string | null {
  if (counts.total > SECURITY_WATCHLIST_VALUES_MAX) {
    return SECURITY_WATCHLIST_MESSAGES.tooManyValues.message;
  }

  if (counts.patterns > SECURITY_WATCHLIST_PATTERN_VALUES_MAX) {
    return SECURITY_WATCHLIST_MESSAGES.tooManyPatterns.message;
  }

  if (counts.ranges > SECURITY_WATCHLIST_RANGE_VALUES_MAX) {
    return SECURITY_WATCHLIST_MESSAGES.tooManyRanges.message;
  }

  return null;
}

/*
 * A list's values as a run reads them (SigmaWatchlist): split by how each
 * matches, lowercased - a range as written - each once.
 */
export function splitSecurityWatchlistValues(data: {
  values: ReadonlyArray<string>;
  entityType: unknown;
}): Pick<SigmaWatchlist, "exactValues" | "patterns" | "ranges"> {
  const exactValues: Array<string> = [];
  const patterns: Array<string> = [];
  const ranges: Array<string> = [];
  const seen: Set<string> = new Set();

  for (const raw of data.values) {
    const value: string = normalizeSecurityWatchlistValue(raw);
    const key: string = value.toLowerCase();

    if (!value || value === SECURITY_WATCHLIST_WILDCARD || seen.has(key)) {
      continue;
    }

    seen.add(key);

    switch (
      getSecurityWatchlistValueMatch({ value, entityType: data.entityType })
    ) {
      case SecurityWatchlistValueMatch.Range:
        ranges.push(value);
        break;
      case SecurityWatchlistValueMatch.Pattern:
        patterns.push(key);
        break;
      default:
        exactValues.push(key);
    }
  }

  return { exactValues, patterns, ranges };
}

/*
 * Whether a value is on a list, as a rule would match it: what the
 * Dashboard's lookup answers. Patterns are matched piece by piece, never
 * with a regular expression built from a value someone wrote.
 */
export function matchesSecurityWatchlistPattern(
  pattern: string,
  value: string,
): boolean {
  const wanted: string = normalizeSecurityWatchlistValue(pattern).toLowerCase();
  const text: string = (value || "").trim().toLowerCase();

  if (!wanted || !text) {
    return false;
  }

  if (!wanted.includes(SECURITY_WATCHLIST_WILDCARD)) {
    return wanted === text;
  }

  const pieces: Array<string> = wanted.split(SECURITY_WATCHLIST_WILDCARD);
  const first: string = pieces[0] || "";
  const last: string = pieces[pieces.length - 1] || "";

  if (!text.startsWith(first)) {
    return false;
  }

  let position: number = first.length;

  for (let index: number = 1; index < pieces.length - 1; index++) {
    const piece: string = pieces[index] || "";

    if (!piece) {
      continue;
    }

    const found: number = text.indexOf(piece, position);

    if (found < 0) {
      return false;
    }

    position = found + piece.length;
  }

  return text.length - last.length >= position && text.endsWith(last);
}
