import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of watchlists in the Dashboard: Security Events > Detections >
 * Watchlists, a watchlist's page, its Import Values dialog, the line under
 * a detection rule's YAML that says which lists the rule reads, and a
 * Security Events monitor's Filter by Watchlists. Each is an en.json key,
 * looked up where it is drawn. What is wrong with a list
 * or a value is the shared rules' own words
 * (Common/Types/SecurityEvent/SecurityWatchlist), keys too.
 *
 * A watchlist is named the way rules write it (vip_users), so a name is
 * always shown as written, in the mono type, never looked up as words.
 *
 * React-free, so the words are pinned in a plain test.
 */

// ---------- Security Events > Detections > Watchlists ----------

export const WATCHLISTS_TABLE_TITLE: string = translationKey("Watchlists");

export const WATCHLISTS_TABLE_DESCRIPTION: string = translationKey(
  "Values your rules match against: VIP users, critical hosts, known-bad file hashes, allowed admin addresses. A rule reads a list by its name.",
);

export const WATCHLISTS_EMPTY_TITLE: string =
  translationKey("No watchlists yet");

export const WATCHLISTS_EMPTY_DESCRIPTION: string = translationKey(
  "Keep a list once, and match it in any rule. Start with a common one, or create your own.",
);

// One row of the list: "Create Watchlist", "Showing 1-3 of 3 watchlists".
export const WATCHLIST_SINGULAR: string = translationKey("Watchlist");
export const WATCHLIST_PLURAL: string = translationKey("Watchlists");

// The list's columns.
export const NAME_COLUMN_TITLE: string = translationKey("Watchlist");
export const HOLDS_COLUMN_TITLE: string = translationKey("Holds");
export const VALUES_COLUMN_TITLE: string = translationKey("Values");
export const READ_BY_COLUMN_TITLE: string = translationKey("Read By");

// How many values a list keeps.
export const VALUE_COUNT: PluralTemplate = {
  one: "{{count}} value",
  other: "{{count}} values",
};

export const NO_VALUES_YET: string = translationKey("No values yet");

// A list that follows a feed, in place of its count: "Follows Tor exit nodes".
export const FOLLOWS_FEED: string = translationKey("Follows {{feed}}");
export const FOLLOWS_A_FEED: string = translationKey(
  "Follows a threat intel feed",
);
export const FEED_GONE: string = translationKey(
  "Its threat intel feed was deleted",
);

/*
 * What reads a list - its detection rules, Security Events monitors and
 * hunts: the first two names, then how many more. A monitor or a hunt says
 * what it is after its name; a rule, the usual reader, needs no word.
 */
export const READ_BY_NO_RULE: string = translationKey("Nothing reads it yet");
export const READ_BY_MORE: PluralTemplate = {
  one: "and {{count}} more",
  other: "and {{count}} more",
};
export const READER_KIND_MONITOR: string = translationKey("Monitor");
export const READER_KIND_HUNT: string = translationKey("Hunt");
// When what reads it could not be read: the list still shows, without them.
export const READ_BY_UNKNOWN: string = translationKey(
  "Couldn't load what reads it",
);

// ---------- What a list holds ----------

export const HOLDS_USERS: string = translationKey("Users");
export const HOLDS_HOSTS: string = translationKey("Hosts");
export const HOLDS_IP_ADDRESSES: string = translationKey("IP addresses");
export const HOLDS_FILE_HASHES: string = translationKey("File hashes");
export const HOLDS_DOMAINS: string = translationKey("Domains");
export const HOLDS_URLS: string = translationKey("URLs");
export const HOLDS_PROCESSES: string = translationKey("Processes");
export const HOLDS_OTHER: string = translationKey("Other values");

// ---------- Start with a common list ----------

export const STARTERS_TITLE: string = translationKey(
  "Start with a common list",
);
export const STARTERS_DESCRIPTION: string = translationKey(
  "Each one is created empty, ready for its values.",
);
export const STARTER_ADD: string = translationKey("Add");
export const STARTER_ADDED: string = translationKey("Added");

export const STARTER_VIP_USERS_TITLE: string = translationKey("VIP users");
export const STARTER_VIP_USERS_DESCRIPTION: string = translationKey(
  "Accounts that matter most: executives, finance and their assistants.",
);
export const STARTER_CRITICAL_HOSTS_TITLE: string =
  translationKey("Critical hosts");
export const STARTER_CRITICAL_HOSTS_DESCRIPTION: string = translationKey(
  "Servers that must never be compromised: domain controllers, payment and database servers.",
);
export const STARTER_KNOWN_BAD_HASHES_TITLE: string = translationKey(
  "Known-bad file hashes",
);
export const STARTER_KNOWN_BAD_HASHES_DESCRIPTION: string = translationKey(
  "Hashes of malware and tools you never want to see run.",
);
export const STARTER_ADMIN_ADDRESSES_TITLE: string = translationKey(
  "Allowed admin addresses",
);
export const STARTER_ADMIN_ADDRESSES_DESCRIPTION: string = translationKey(
  "Where administrators may sign in from: offices, the VPN and bastion hosts.",
);

// ---------- The form: Create Watchlist / Edit ----------

export const NAME_FIELD_TITLE: string = translationKey("Name");
export const NAME_FIELD_DESCRIPTION: string = translationKey(
  "What rules call it, between % signs: '%vip_users%'. Letters, digits and underscores.",
);
export const NAME_FIELD_PLACEHOLDER: string = translationKey("vip_users");

export const HOLDS_FIELD_TITLE: string = translationKey("Holds");
export const HOLDS_FIELD_DESCRIPTION: string = translationKey(
  "What is on the list. It cannot change once the list is created.",
);
// An empty dropdown asks for its choice rather than looking unfinished.
export const HOLDS_FIELD_PLACEHOLDER: string = translationKey(
  "Choose what the list holds",
);

export const DESCRIPTION_FIELD_TITLE: string = translationKey("Description");
export const DESCRIPTION_FIELD_DESCRIPTION: string = translationKey(
  "What the list is for, for whoever reads it later.",
);
export const DESCRIPTION_FIELD_PLACEHOLDER: string = translationKey(
  "e.g. Executives and their assistants.",
);

export const SOURCE_FIELD_TITLE: string = translationKey("Values come from");
export const SOURCE_VALUES_TITLE: string = translationKey("Values you keep");
export const SOURCE_VALUES_DESCRIPTION: string = translationKey(
  "Add them by hand or import a file.",
);
export const SOURCE_FEED_TITLE: string = translationKey("A threat intel feed");
export const SOURCE_FEED_DESCRIPTION: string = translationKey(
  "The feed's indicators of this kind, kept up to date by the feed.",
);
export const SOURCE_URL_TITLE: string = translationKey("A file at an address");
export const SOURCE_URL_DESCRIPTION: string = translationKey(
  "Read again on a schedule from an https address: a text or CSV file, one value a line.",
);

// A list read from an address: where, and how often.
export const IMPORT_URL_FIELD_TITLE: string = translationKey("URL");
export const IMPORT_URL_FIELD_DESCRIPTION: string = translationKey(
  "The https address of a text or CSV file: one value a line, with an optional note after a comma. The list is what the file holds at its last read.",
);
export const IMPORT_URL_FIELD_PLACEHOLDER: string = translationKey(
  "https://example.com/vip-users.csv",
);
export const IMPORT_SCHEDULE_FIELD_TITLE: string = translationKey("Schedule");
export const IMPORT_SCHEDULE_FIELD_DESCRIPTION: string = translationKey(
  "How often OneUptime reads the file again.",
);

export const FEED_FIELD_TITLE: string = translationKey("Threat Intel Feed");
export const FEED_FIELD_DESCRIPTION: string = translationKey(
  "The feed whose active indicators are the list's values.",
);
export const FEED_FIELD_PLACEHOLDER: string = translationKey("Choose a feed");

// ---------- A watchlist's page ----------

export const WATCHLIST_DETAIL_TITLE: string = translationKey("About This List");
export const WATCHLIST_DETAIL_DESCRIPTION: string = translationKey(
  "What the list holds and where its values come from.",
);
export const WATCHLIST_NOT_FOUND: string = translationKey(
  "This watchlist was deleted, or you cannot read it.",
);

/*
 * Use this list: in a rule's detection, and in a search - on Events or in
 * a hunt. A Security Events monitor picks the list from its own filters.
 */
export const USE_IN_RULE_TITLE: string = translationKey("Use This List");
export const USE_IN_RULE_DESCRIPTION: string = translationKey(
  "Match a field against this list in a detection or correlation rule, a search on Events or a hunt, or a Security Events monitor's Filter by Watchlists.",
);
export const USE_IN_RULE_LABEL: string = translationKey(
  "In a rule's detection",
);
export const USE_IN_SEARCH_LABEL: string = translationKey(
  "In a search on Events or a hunt",
);
export const READ_BY_LABEL: string = translationKey("Read by");
export const OPEN_DETECTION_RULES: string = translationKey(
  "Open Detection Rules",
);

// The values a team keeps.
export const VALUES_TABLE_TITLE: string = translationKey("Values");
export const VALUES_TABLE_DESCRIPTION: string = translationKey(
  "Matched whatever the case. * stands for any run of characters: svc-* matches every service account.",
);
export const VALUES_TABLE_DESCRIPTION_IP: string = translationKey(
  "Matched whatever the case. A value can be a range such as 10.20.0.0/16, or a pattern with *.",
);
// A file hash list takes digests only: no pattern, so no word of *.
export const VALUES_TABLE_DESCRIPTION_HASH: string = translationKey(
  "MD5, SHA-1, SHA-256 and SHA-512 hashes, matched whatever the case.",
);
export const VALUES_EMPTY_TITLE: string = translationKey(
  "No values on this list yet",
);
export const VALUES_EMPTY_DESCRIPTION: string = translationKey(
  "Add values one by one, or import a file of them.",
);
export const VALUE_SINGULAR: string = translationKey("Value");
export const VALUE_PLURAL: string = translationKey("Values");
export const VALUE_COLUMN_TITLE: string = translationKey("Value");
export const NOTE_COLUMN_TITLE: string = translationKey("Note");
export const ADDED_COLUMN_TITLE: string = translationKey("Added");

export const VALUE_FIELD_TITLE: string = translationKey("Value");
export const VALUE_FIELD_DESCRIPTION: string = translationKey(
  "Matched whatever the case. * stands for any run of characters.",
);
export const NOTE_FIELD_TITLE: string = translationKey("Note");
export const NOTE_FIELD_DESCRIPTION: string = translationKey(
  "Why it is on the list.",
);

/*
 * A value kept for a while: the moment it leaves the list, as a rule
 * exception's expiry is written ({{time}}: "in 30 days").
 */
export const EXPIRES_FIELD_TITLE: string = translationKey("Expires At");
export const EXPIRES_FIELD_DESCRIPTION: string = translationKey(
  "When the value leaves the list. Leave it empty to keep it until someone removes it.",
);
export const VALUE_EXPIRES: string = translationKey("Expires {{time}}");

// A list's values to a file an import reads back.
export const EXPORT_VALUES: string = translationKey("Export Values");

// A list that follows a feed keeps no values of its own.
export const FEED_VALUES_TITLE: string = translationKey("Values");
export const FEED_VALUES_DESCRIPTION: string = translationKey(
  "This list follows {{feed}}: the feed's active indicators of the list's kind are its values, kept up to date as the feed is read.",
);
export const FEED_VALUES_GONE: string = translationKey(
  "The threat intel feed this list followed was deleted, so the list holds nothing. Choose another feed in Edit.",
);
export const OPEN_THREAT_INTEL: string = translationKey("Open Threat Intel");

// ---------- A list read from an address ----------

export const URL_CARD_TITLE: string = translationKey("Read From an Address");
export const URL_CARD_DESCRIPTION: string = translationKey(
  "The list is what the file at this address holds at its last read. A read that fails changes no value.",
);
export const URL_LAST_READ: string = translationKey("Last read {{time}}");
export const URL_LINES_LEFT_OUT: PluralTemplate = {
  one: "{{count}} line of the file was left out.",
  other: "{{count}} lines of the file were left out.",
};
export const URL_WAITING: string = translationKey("Waiting for its first read");
export const URL_WAITING_DESCRIPTION: string = translationKey(
  "OneUptime reads the file within a minute of the list being saved, or now with Read Now.",
);
export const URL_LAST_READ_FAILED: string = translationKey(
  "The last read failed {{time}}",
);
export const URL_KEEPS_VALUES_FROM: string = translationKey(
  "The list keeps the values it read {{time}}.",
);
export const URL_NO_GOOD_READ: string = translationKey(
  "The list holds no values until a read works.",
);
export const URL_READ_NOW: string = translationKey("Read Now");
export const URL_READ_NOW_DONE: string = translationKey("Read just now");
// A row's values: how many, and from where.
export const URL_VALUES_FROM: PluralTemplate = {
  one: "{{count}} value from {{host}}",
  other: "{{count}} values from {{host}}",
};
export const URL_READ_FAILED_SHORT: string = translationKey(
  "Its last read failed",
);
// Who put a value there: the list's reads.
export const READ_FROM_ADDRESS: string = translationKey(
  "Read from its address {{time}}",
);
export const URL_VALUES_EMPTY_TITLE: string =
  translationKey("No values read yet");
export const URL_VALUES_EMPTY_DESCRIPTION: string = translationKey(
  "The file's values show here after a read that works.",
);

// ---------- A Security Events monitor's Filter by Watchlists ----------

export const WATCHLIST_FILTERS_TITLE: string = translationKey(
  "Filter by Watchlists",
);
export const WATCHLIST_FILTERS_DESCRIPTION: string = translationKey(
  "Only events whose field is, or is not, on one of your watchlists, matched as a detection rule matches it.",
);
export const WATCHLIST_FILTER_FIELD: string = translationKey("Field");
export const WATCHLIST_FILTER_FIELD_PLACEHOLDER: string =
  translationKey("Choose a field");
export const WATCHLIST_FILTER_MATCH: string = translationKey("Match");
export const WATCHLIST_FILTER_IS_ON: string = translationKey("Is on the list");
export const WATCHLIST_FILTER_IS_NOT_ON: string =
  translationKey("Is not on the list");
export const WATCHLIST_FILTER_WATCHLIST: string = translationKey("Watchlist");
export const WATCHLIST_FILTER_WATCHLIST_PLACEHOLDER: string =
  translationKey("Choose a watchlist");
export const WATCHLIST_FILTER_ADD: string = translationKey(
  "Add a Watchlist Filter",
);
export const WATCHLIST_FILTER_REMOVE: string =
  translationKey("Remove this filter");
export const WATCHLIST_FILTER_NO_LISTS: string = translationKey(
  "No watchlists yet. Create one under Security Events > Detections > Watchlists.",
);
export const WATCHLIST_FILTER_LISTS_FAILED: string = translationKey(
  "Couldn't load the watchlists.",
);
export const WATCHLIST_FILTER_OPEN_WATCHLISTS: string =
  translationKey("Open Watchlists");
// The step's summary on a monitor's page.
export const WATCHLIST_FILTERS_SUMMARY_DESCRIPTION: string = translationKey(
  "Only events whose field is, or is not, on these watchlists.",
);

// ---------- Import Values ----------

export const IMPORT_VALUES: string = translationKey("Import Values");
export const IMPORT_DESCRIPTION: string = translationKey(
  "Paste values, one a line, or choose a .txt or .csv file. A note can follow a comma: alice@example.com, CFO.",
);
export const IMPORT_TEXT_LABEL: string = translationKey("Values to import");
export const IMPORT_CHOOSE_FILE: string = translationKey("Choose a File");
export const IMPORT_FILE_UNREADABLE: string = translationKey(
  "The file could not be read. Choose a text or CSV file.",
);
export const IMPORT_FILE_TOO_LARGE: string = translationKey(
  "The file is larger than 4 MB. Split it, and import it in parts.",
);
export const IMPORT_MODE_LABEL: string = translationKey("How to import");
export const IMPORT_MODE_ADD_TITLE: string = translationKey("Add to the list");
export const IMPORT_MODE_ADD_DESCRIPTION: string = translationKey(
  "Values already on it stay.",
);
export const IMPORT_MODE_REPLACE_TITLE: string =
  translationKey("Replace the list");
export const IMPORT_MODE_REPLACE_DESCRIPTION: string = translationKey(
  "Values not in the import are removed.",
);

// The preview, as it is typed.
export const IMPORT_PREVIEW_VALUES: PluralTemplate = {
  one: "{{count}} value to import",
  other: "{{count}} values to import",
};
export const IMPORT_PREVIEW_DUPLICATES: PluralTemplate = {
  one: "{{count}} repeated line skipped",
  other: "{{count}} repeated lines skipped",
};
export const IMPORT_PREVIEW_PROBLEMS: PluralTemplate = {
  one: "{{count}} line left out",
  other: "{{count}} lines left out",
};
export const IMPORT_PROBLEM_LINE: string = translationKey("Line {{line}}");
export const IMPORT_PROBLEMS_MORE: PluralTemplate = {
  one: "and {{count}} more line",
  other: "and {{count}} more lines",
};

export const IMPORT_SUBMIT: PluralTemplate = {
  one: "Import {{count}} Value",
  other: "Import {{count}} Values",
};
export const IMPORT_NOTHING: string = translationKey("Nothing to import yet");

// What an import did.
export const IMPORT_DONE_TITLE: string = translationKey("Import finished");
export const IMPORT_DONE_ADDED: PluralTemplate = {
  one: "{{count}} value added",
  other: "{{count}} values added",
};
export const IMPORT_DONE_REMOVED: PluralTemplate = {
  one: "{{count}} value removed",
  other: "{{count}} values removed",
};
export const IMPORT_DONE_UNCHANGED: PluralTemplate = {
  one: "{{count}} was already on the list",
  other: "{{count}} were already on the list",
};
export const IMPORT_DONE_NOW_HOLDS: PluralTemplate = {
  one: "The list now holds {{count}} value.",
  other: "The list now holds {{count}} values.",
};
export const IMPORT_DONE: string = translationKey("Done");

// ---------- The line under a rule's YAML ----------

export const RULE_READS_WATCHLISTS: string = translationKey("Reads watchlists");
export const RULE_WATCHLIST_MISSING: string = translationKey(
  "No watchlist named {{name}}",
);
export const CREATE_WATCHLIST_LINK: string = translationKey(
  "Create it in Watchlists",
);

// ---------- Test ids ----------

export const WATCHLISTS_TEST_IDS: {
  table: string;
  nameCell: string;
  nameFacts: string;
  nameReadBy: string;
  holdsCell: string;
  valuesCell: string;
  readByCell: string;
  starters: string;
  startersError: string;
  starter: string;
  ruleSnippet: string;
  readByLine: string;
  valuesTable: string;
  noteCell: string;
  addedLine: string;
  feedValues: string;
  importModal: string;
  importEmpty: string;
  importText: string;
  importFile: string;
  importPreview: string;
  importProblems: string;
  importSummary: string;
  ruleWatchlists: string;
  ruleWatchlist: string;
  searchSnippet: string;
  exportValues: string;
  urlCard: string;
  urlAddress: string;
  urlStatus: string;
  urlReadNow: string;
  urlReadNowResult: string;
  expiresLine: string;
  readerKind: string;
  monitorFilters: string;
  monitorFilter: string;
  monitorFilterAdd: string;
  monitorFilterRemove: string;
} = {
  table: "security-watchlists-table",
  nameCell: "watchlist-name-cell",
  nameFacts: "watchlist-name-facts",
  nameReadBy: "watchlist-name-read-by",
  holdsCell: "watchlist-holds-cell",
  valuesCell: "watchlist-values-cell",
  readByCell: "watchlist-read-by-cell",
  starters: "watchlist-starters",
  startersError: "watchlist-starters-error",
  starter: "watchlist-starter",
  ruleSnippet: "watchlist-rule-snippet",
  readByLine: "watchlist-read-by",
  valuesTable: "security-watchlist-values-table",
  noteCell: "watchlist-value-note",
  addedLine: "watchlist-value-added",
  feedValues: "watchlist-feed-values",
  importModal: "watchlist-import-modal",
  importEmpty: "watchlist-import-empty",
  importText: "watchlist-import-text",
  importFile: "watchlist-import-file",
  importPreview: "watchlist-import-preview",
  importProblems: "watchlist-import-problems",
  importSummary: "watchlist-import-summary",
  ruleWatchlists: "detection-rule-watchlists",
  ruleWatchlist: "detection-rule-watchlist",
  searchSnippet: "watchlist-search-snippet",
  exportValues: "watchlist-export-values",
  urlCard: "watchlist-url-card",
  urlAddress: "watchlist-url-address",
  urlStatus: "watchlist-url-status",
  urlReadNow: "watchlist-url-read-now",
  urlReadNowResult: "watchlist-url-read-now-result",
  expiresLine: "watchlist-value-expires",
  readerKind: "watchlist-reader-kind",
  monitorFilters: "security-events-watchlist-filters",
  monitorFilter: "security-events-watchlist-filter",
  monitorFilterAdd: "security-events-watchlist-filter-add",
  monitorFilterRemove: "security-events-watchlist-filter-remove",
};
