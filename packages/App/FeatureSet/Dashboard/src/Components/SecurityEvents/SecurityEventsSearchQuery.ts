import { SearchHelpRow } from "Common/UI/Components/TelemetryViewer/types";

/*
 * The Security Events search bar: the names it suggests, its placeholder and
 * the rows of its help.
 *
 * What the search MEANS - the field names it knows, which columns are
 * numeric and how a token lands on the query - is compiled in Common
 * (Utils/SecurityEvent/SecurityEventSearch), where a hunt's scheduled run on
 * the server reads it too, so a hunt finds on its schedule exactly what its
 * page shows. It is re-exported here for the page and its tests.
 *
 * Pure and React-free: App/Tests pin every field name and operator here
 * without mounting the viewer.
 */
export {
  EMPTY_SECURITY_EVENT_SEARCH_FILTERS,
  SECURITY_EVENT_CONTAINS_FIELDS,
  SECURITY_EVENT_FIELD_ALIASES,
  SECURITY_EVENT_NUMERIC_FIELDS,
  SECURITY_EVENT_SEARCH_FIELD_KEYS,
  applySecurityEventSearchToQuery,
  hasSecurityEventSearch,
  parseSecurityEventSearch,
} from "Common/Utils/SecurityEvent/SecurityEventSearch";
export type { SecurityEventSearchFilters } from "Common/Utils/SecurityEvent/SecurityEventSearch";

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
  "processname",
  "commandline",
  "parentprocessname",
  "observable",
  "tactic",
  "technique",
  "requestoutcome",
  "trace",
  "session",
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
    syntax: "commandline:<text>",
    description: "Command lines that contain this text",
    example: "commandline:mimikatz",
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
