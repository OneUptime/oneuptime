import { AIChatCitationTargetType } from "Common/Types/AI/AIChatTypes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";

/*
 * Plain-language formatting for the "Evidence checked" list of an AI
 * investigation report. The server hands the panel each query the AI ran as a
 * tool name plus its (sanitised) arguments; responders should not have to read
 * `query_incidents {"state":"active","limit":20}` to know what was checked.
 *
 * Pure so App/Tests can pin every mapping. Everything returned is plain text:
 * the argument values come from the model's tool calls, so callers render them
 * as text and never as markup or links.
 */

export interface EvidenceToolDescription {
  // What the AI did, e.g. "Searched logs".
  description: string;
  icon: IconProp;
  // Coarse grouping, e.g. "Logs", "Incidents".
  category: string;
}

export interface FormattedEvidenceArgument {
  // The argument key it came from ("timeWindow" for a merged start/end pair).
  key: string;
  label: string;
  value: string;
}

const TOOL_DESCRIPTIONS: Map<string, EvidenceToolDescription> = new Map<
  string,
  EvidenceToolDescription
>([
  [
    "lookup_context",
    {
      description: "Looked up telemetry context",
      icon: IconProp.Search,
      category: "Context",
    },
  ],
  [
    "query_incidents",
    {
      description: "Searched incidents",
      icon: IconProp.Alert,
      category: "Incidents",
    },
  ],
  [
    "search_incidents",
    {
      description: "Searched past incidents",
      icon: IconProp.Alert,
      category: "Incidents",
    },
  ],
  [
    "get_incident_timeline",
    {
      description: "Read an incident timeline",
      icon: IconProp.List,
      category: "Incidents",
    },
  ],
  [
    "query_alerts",
    {
      description: "Searched alerts",
      icon: IconProp.Bell,
      category: "Alerts",
    },
  ],
  [
    "get_alert_timeline",
    {
      description: "Read an alert timeline",
      icon: IconProp.List,
      category: "Alerts",
    },
  ],
  [
    "query_monitors",
    {
      description: "Checked monitors",
      icon: IconProp.Cube,
      category: "Monitors",
    },
  ],
  [
    "query_scheduled_maintenance",
    {
      description: "Checked scheduled maintenance",
      icon: IconProp.Clock,
      category: "Scheduled maintenance",
    },
  ],
  [
    "query_on_call_policies",
    {
      description: "Checked on-call policies",
      icon: IconProp.Call,
      category: "On-call",
    },
  ],
  [
    "get_on_call_status",
    {
      description: "Checked who is on call",
      icon: IconProp.Call,
      category: "On-call",
    },
  ],
  [
    "query_on_call_pages",
    {
      description: "Checked on-call pages",
      icon: IconProp.Call,
      category: "On-call",
    },
  ],
  [
    "query_status_pages",
    {
      description: "Checked status pages",
      icon: IconProp.CheckCircle,
      category: "Status pages",
    },
  ],
  [
    "query_status_page_announcements",
    {
      description: "Checked status page announcements",
      icon: IconProp.CheckCircle,
      category: "Status pages",
    },
  ],
  [
    "query_slos",
    {
      description: "Checked SLOs",
      icon: IconProp.ArrowTrendingUp,
      category: "SLOs",
    },
  ],
  [
    "query_runbooks",
    {
      description: "Checked runbooks",
      icon: IconProp.Book,
      category: "Runbooks",
    },
  ],
  [
    "query_workflows",
    {
      description: "Checked workflows",
      icon: IconProp.Workflow,
      category: "Workflows",
    },
  ],
  [
    "query_probes",
    {
      description: "Checked probes",
      icon: IconProp.Signal,
      category: "Probes",
    },
  ],
  [
    "query_teams",
    {
      description: "Checked teams",
      icon: IconProp.Team,
      category: "Teams",
    },
  ],
  [
    "query_ai_insights",
    {
      description: "Checked AI insights",
      icon: IconProp.Sparkles,
      category: "AI insights",
    },
  ],
  [
    "top_exceptions",
    {
      description: "Listed top exceptions",
      icon: IconProp.Error,
      category: "Exceptions",
    },
  ],
  [
    "search_logs",
    {
      description: "Searched logs",
      icon: IconProp.Logs,
      category: "Logs",
    },
  ],
  [
    "log_histogram",
    {
      description: "Charted log volume",
      icon: IconProp.ChartBar,
      category: "Logs",
    },
  ],
  [
    "search_security_events",
    {
      description: "Searched security events",
      icon: IconProp.ShieldExclamation,
      category: "Security",
    },
  ],
  [
    "security_event_summary",
    {
      description: "Summarised security events",
      icon: IconProp.ShieldExclamation,
      category: "Security",
    },
  ],
  [
    "query_metrics",
    {
      description: "Queried a metric",
      icon: IconProp.ChartBar,
      category: "Metrics",
    },
  ],
  [
    "baseline_anomaly",
    {
      description: "Compared a metric with its baseline",
      icon: IconProp.ArrowTrendingUp,
      category: "Metrics",
    },
  ],
  [
    "query_traces",
    {
      description: "Analysed traces",
      icon: IconProp.Activity,
      category: "Traces",
    },
  ],
  [
    "get_trace",
    {
      description: "Opened a trace",
      icon: IconProp.Activity,
      category: "Traces",
    },
  ],
  [
    "recent_changes",
    {
      description: "Checked recent changes",
      icon: IconProp.Bolt,
      category: "Changes",
    },
  ],
  [
    "list_code_repositories",
    {
      description: "Listed code repositories",
      icon: IconProp.Code,
      category: "Code",
    },
  ],
  [
    "find_code_for_exception",
    {
      description: "Located the code behind an exception",
      icon: IconProp.Code,
      category: "Code",
    },
  ],
  [
    "search_code",
    {
      description: "Searched code",
      icon: IconProp.Code,
      category: "Code",
    },
  ],
  [
    "read_code_file",
    {
      description: "Read a code file",
      icon: IconProp.DocumentText,
      category: "Code",
    },
  ],
  [
    "get_ai_investigation",
    {
      description: "Read an AI investigation",
      icon: IconProp.Sparkles,
      category: "AI",
    },
  ],
  [
    "list_command_targets",
    {
      description: "Listed command targets",
      icon: IconProp.Terminal,
      category: "Remediation",
    },
  ],
  [
    "execute_remediation_command",
    {
      description: "Ran a remediation command",
      icon: IconProp.Terminal,
      category: "Remediation",
    },
  ],
  [
    "propose_remediation_commands",
    {
      description: "Proposed remediation commands",
      icon: IconProp.Terminal,
      category: "Remediation",
    },
  ],
  /*
   * Mutation tools are never offered to an investigation, but the same
   * formatter is cheap to keep honest for any run that recorded one.
   */
  [
    "create_incident",
    {
      description: "Declared an incident",
      icon: IconProp.Alert,
      category: "Incidents",
    },
  ],
  [
    "acknowledge_incident",
    {
      description: "Acknowledged an incident",
      icon: IconProp.Alert,
      category: "Incidents",
    },
  ],
  [
    "resolve_incident",
    {
      description: "Resolved an incident",
      icon: IconProp.Alert,
      category: "Incidents",
    },
  ],
  [
    "change_incident_severity",
    {
      description: "Changed an incident's severity",
      icon: IconProp.Alert,
      category: "Incidents",
    },
  ],
  [
    "create_incident_note",
    {
      description: "Added an incident note",
      icon: IconProp.DocumentText,
      category: "Incidents",
    },
  ],
  [
    "post_incident_status_update",
    {
      description: "Posted an incident status update",
      icon: IconProp.DocumentText,
      category: "Incidents",
    },
  ],
  [
    "acknowledge_alert",
    {
      description: "Acknowledged an alert",
      icon: IconProp.Bell,
      category: "Alerts",
    },
  ],
  [
    "resolve_alert",
    {
      description: "Resolved an alert",
      icon: IconProp.Bell,
      category: "Alerts",
    },
  ],
  [
    "create_alert_note",
    {
      description: "Added an alert note",
      icon: IconProp.DocumentText,
      category: "Alerts",
    },
  ],
  [
    "page_on_call_policy",
    {
      description: "Paged an on-call policy",
      icon: IconProp.Call,
      category: "On-call",
    },
  ],
  [
    "run_runbook",
    {
      description: "Ran a runbook",
      icon: IconProp.Book,
      category: "Runbooks",
    },
  ],
  [
    "commit_code_to_branch",
    {
      description: "Committed code to a branch",
      icon: IconProp.Code,
      category: "Code",
    },
  ],
  [
    "open_code_pull_request",
    {
      description: "Opened a pull request",
      icon: IconProp.Code,
      category: "Code",
    },
  ],
  [
    "start_investigation",
    {
      description: "Started an AI investigation",
      icon: IconProp.Sparkles,
      category: "AI",
    },
  ],
]);

const MAX_FALLBACK_TOOL_NAME_LENGTH: number = 60;

/*
 * Splits "query_on_call_pages" / "queryOnCallPages" into lower-case words.
 * Anything that is not a letter or digit separates words.
 */
function splitIntoWords(value: string): Array<string> {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    })
    .map((word: string): string => {
      return word.toLowerCase();
    });
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function describeEvidenceTool(
  toolName: string | null | undefined,
): EvidenceToolDescription {
  const name: string = typeof toolName === "string" ? toolName.trim() : "";
  const known: EvidenceToolDescription | undefined = TOOL_DESCRIPTIONS.get(
    name.toLowerCase(),
  );

  if (known) {
    return { ...known };
  }

  const words: Array<string> = splitIntoWords(
    name.slice(0, MAX_FALLBACK_TOOL_NAME_LENGTH),
  );

  return {
    description:
      words.length > 0 ? `Ran ${words.join(" ")}` : "Ran a telemetry query",
    icon: IconProp.Database,
    category: "Other",
  };
}

const TARGET_PAGE_NAMES: { [key in AIChatCitationTargetType]: string } = {
  [AIChatCitationTargetType.Logs]: "Logs",
  [AIChatCitationTargetType.Traces]: "Traces",
  [AIChatCitationTargetType.TraceView]: "Trace",
  [AIChatCitationTargetType.Metrics]: "Metrics",
  [AIChatCitationTargetType.Exceptions]: "Exceptions",
  [AIChatCitationTargetType.Incidents]: "Incidents",
  [AIChatCitationTargetType.IncidentView]: "Incident",
  [AIChatCitationTargetType.Alerts]: "Alerts",
  [AIChatCitationTargetType.AlertView]: "Alert",
  [AIChatCitationTargetType.Monitors]: "Monitors",
  [AIChatCitationTargetType.MonitorView]: "Monitor",
  [AIChatCitationTargetType.ScheduledMaintenanceEvents]:
    "Scheduled maintenance",
  [AIChatCitationTargetType.ScheduledMaintenanceView]:
    "Scheduled maintenance event",
  [AIChatCitationTargetType.OnCallPolicies]: "On-call policies",
  [AIChatCitationTargetType.OnCallPolicyView]: "On-call policy",
  [AIChatCitationTargetType.StatusPages]: "Status pages",
  [AIChatCitationTargetType.StatusPageView]: "Status page",
  [AIChatCitationTargetType.Slos]: "SLOs",
  [AIChatCitationTargetType.SloView]: "SLO",
  [AIChatCitationTargetType.Runbooks]: "Runbooks",
  [AIChatCitationTargetType.RunbookView]: "Runbook",
  [AIChatCitationTargetType.Workflows]: "Workflows",
  [AIChatCitationTargetType.WorkflowView]: "Workflow",
  [AIChatCitationTargetType.Probes]: "Probes",
  [AIChatCitationTargetType.Teams]: "Teams",
  [AIChatCitationTargetType.SecurityEvents]: "Security events",
};

// The page an evidence target opens, for "Open in <page>".
export function describeCitationTargetPage(
  targetType: AIChatCitationTargetType | string | null | undefined,
): string {
  if (
    typeof targetType === "string" &&
    Object.prototype.hasOwnProperty.call(TARGET_PAGE_NAMES, targetType)
  ) {
    return TARGET_PAGE_NAMES[targetType as AIChatCitationTargetType];
  }

  return "Dashboard";
}

export function formatRowCount(rowCount: number | null | undefined): string {
  if (
    typeof rowCount !== "number" ||
    !Number.isFinite(rowCount) ||
    rowCount <= 0
  ) {
    return "No rows";
  }

  const rounded: number = Math.floor(rowCount);

  if (rounded === 1) {
    return "1 row";
  }

  return `${formatInteger(rounded)} rows`;
}

/*
 * What the server serializes for a result that simply has no rows. These say
 * nothing beyond "No rows returned.", so they are never shown next to it.
 */
const EMPTY_ROWS_PLACEHOLDERS: ReadonlySet<string> = new Set<string>([
  "[]",
  "{}",
  "(no rows found)",
  "(no data found)",
]);

/*
 * The server's own explanation for a re-run that returned no rows — "No
 * monitor status matches …", "Incident … was not found in this project." —
 * so a responder can tell "nothing matches now" from "this query no longer
 * works". Null when there is no text or it is only an empty-result
 * placeholder.
 */
export function getEvidenceEmptyRowsMessage(
  text: string | null | undefined,
): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed: string = text.trim();

  if (!trimmed || EMPTY_ROWS_PLACEHOLDERS.has(trimmed.toLowerCase())) {
    return null;
  }

  return trimmed;
}

export function formatQueryCount(count: number): string {
  const safeCount: number =
    Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;

  return `${formatInteger(safeCount)} ${safeCount === 1 ? "query" : "queries"}`;
}

function formatInteger(value: number): string {
  // Fixed grouping so the same count reads the same for every viewer.
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// "340 ms", "1.2 s", "2 min 5 s". Undefined for a missing/invalid duration.
export function formatEvidenceDuration(
  durationInMs: number | null | undefined,
): string | undefined {
  if (
    typeof durationInMs !== "number" ||
    !Number.isFinite(durationInMs) ||
    durationInMs < 0
  ) {
    return undefined;
  }

  if (durationInMs < 1000) {
    return `${Math.round(durationInMs)} ms`;
  }

  if (durationInMs < 60_000) {
    const seconds: number = Math.round(durationInMs / 100) / 10;

    return seconds >= 60 ? "1 min" : `${seconds} s`;
  }

  const totalSeconds: number = Math.round(durationInMs / 1000);
  const minutes: number = Math.floor(totalSeconds / 60);
  const seconds: number = totalSeconds % 60;

  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

const ISO_DATE_PREFIX_REGEX: RegExp = /^\d{4}-\d{2}-\d{2}/;

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE_PREFIX_REGEX.test(value.trim())) {
    return null;
  }

  const time: number = Date.parse(value.trim());

  return Number.isFinite(time) ? new Date(time) : null;
}

/*
 * "Sep 14, 18:01 UTC" in the viewer's own timezone and clock preference.
 * Returns null when the value is not an ISO timestamp.
 */
export function formatEvidenceDateTime(value: unknown): string | null {
  const date: Date | null =
    value instanceof Date && Number.isFinite(value.getTime())
      ? value
      : parseIsoDate(value);

  if (!date) {
    return null;
  }

  return `${OneUptimeDate.getDateAsLocalShortDateTimeString(date)} ${OneUptimeDate.getLocalZoneAbbr(date)}`.trim();
}

/*
 * One compact window: "Sep 14, 17:20 – 18:20 UTC" on a single day, otherwise
 * both ends in full.
 */
export function formatEvidenceTimeWindow(start: Date, end: Date): string {
  const zone: string = OneUptimeDate.getLocalZoneAbbr(end);
  const startText: string =
    OneUptimeDate.getDateAsLocalShortDateTimeString(start);

  if (OneUptimeDate.areOnTheSameLocalDay(start, end)) {
    const endTime: string = OneUptimeDate.getLocalTimeString(end, {
      use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
    });

    return `${startText} – ${endTime} ${zone}`.trim();
  }

  return `${startText} – ${OneUptimeDate.getDateAsLocalShortDateTimeString(end)} ${zone}`.trim();
}

export interface EvidenceLabelFormatOptions {
  // Defaults to the viewer's own clock preference.
  use12HourFormat?: boolean | undefined;
}

/*
 * An ISO-8601 instant as the server writes one into a citation label
 * (`Date.toISOString()`): date, time, optional seconds and fraction, and an
 * explicit zone. A reading without a zone does not name one instant, so it is
 * left as written. Groups: year, month, day, hour, minute, second, fraction,
 * zone.
 */
const LABEL_TIMESTAMP_PATTERN: string =
  "(\\d{4})-(\\d{2})-(\\d{2})[Tt](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,9}))?)?([Zz]|[+-]\\d{2}:?\\d{2})";

// What may sit between the two ends of a window: "A – B", "A → B", "A to B".
const LABEL_RANGE_SEPARATOR_REGEX: RegExp =
  /^(?:\s*(?:–|—|→|->|-)\s*|\s+to\s+)$/i;

const WORD_CHARACTER_REGEX: RegExp = /[A-Za-z0-9]/;

interface LabelTimestampMatch {
  start: number;
  end: number;
  date: Date | null;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getDaysInMonth(year: number, month: number): number {
  const daysInMonth: Array<number> = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return daysInMonth[month - 1] ?? 0;
}

/*
 * The instant a matched timestamp names, or null when any part is out of
 * range ("2026-02-30", "25:00", "+24:00"). Validated field by field rather
 * than with Date.parse, which quietly rolls some impossible dates over.
 */
function toLabelTimestampDate(match: RegExpExecArray): Date | null {
  const year: number = Number(match[1]);
  const month: number = Number(match[2]);
  const day: number = Number(match[3]);
  const hour: number = Number(match[4]);
  const minute: number = Number(match[5]);
  const second: number = match[6] === undefined ? 0 : Number(match[6]);
  const milliseconds: number =
    match[7] === undefined ? 0 : Number(match[7].slice(0, 3).padEnd(3, "0"));
  const zone: string = match[8] || "Z";

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > getDaysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  let offsetInMinutes: number = 0;

  if (zone.toUpperCase() !== "Z") {
    const offsetDigits: string = zone.slice(1).replace(":", "");
    const offsetHours: number = Number(offsetDigits.slice(0, 2));
    const offsetMinutes: number = Number(offsetDigits.slice(2, 4));

    if (offsetHours > 23 || offsetMinutes > 59) {
      return null;
    }

    offsetInMinutes =
      (zone.startsWith("-") ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  }

  const date: Date = new Date(
    Date.UTC(2000, month - 1, day, hour, minute, second, milliseconds),
  );
  // Date.UTC reads years 0-99 as 1900-1999; set the year it was given.
  date.setUTCFullYear(year);
  date.setTime(date.getTime() - offsetInMinutes * 60 * 1000);

  return Number.isFinite(date.getTime()) ? date : null;
}

function findLabelTimestamps(label: string): Array<LabelTimestampMatch> {
  const regex: RegExp = new RegExp(LABEL_TIMESTAMP_PATTERN, "g");
  const matches: Array<LabelTimestampMatch> = [];
  let match: RegExpExecArray | null = regex.exec(label);

  while (match) {
    const start: number = match.index;
    const end: number = start + match[0].length;
    const before: string = start > 0 ? label.charAt(start - 1) : "";
    const after: string = label.charAt(end);

    // Part of a longer token ("v2026-09-14T…", "…00Zabc") is not a timestamp.
    if (
      !WORD_CHARACTER_REGEX.test(before) &&
      !WORD_CHARACTER_REGEX.test(after)
    ) {
      matches.push({ start, end, date: toLabelTimestampDate(match) });
    }

    match = regex.exec(label);
  }

  return matches;
}

/*
 * A citation label with its ISO timestamps rewritten as compact local times,
 * so "Logs 2026-09-14T17:45:00.000Z – 2026-09-14T18:20:00.000Z (50 shown)"
 * reads "Logs Sep 14, 17:45 – 18:20 (50 shown)". The second end of a window
 * on the same local day drops its date; the separator and every other
 * character are kept exactly as written, and a timestamp that is not a real
 * instant is left alone. The result is plain text for display; callers keep
 * the raw label for tooltips.
 */
export function formatEvidenceLabel(
  label: string,
  options?: EvidenceLabelFormatOptions,
): string {
  if (typeof label !== "string") {
    return "";
  }

  const matches: Array<LabelTimestampMatch> = findLabelTimestamps(label);

  if (matches.length === 0) {
    return label;
  }

  const use12HourFormat: boolean =
    options?.use12HourFormat ?? OneUptimeDate.getUserPrefers12HourFormat();
  let formatted: string = "";
  let cursor: number = 0;
  let previous: LabelTimestampMatch | null = null;
  let previousEndsRange: boolean = false;

  for (const current of matches) {
    const separator: string = label.slice(cursor, current.start);
    let text: string = label.slice(current.start, current.end);
    let endsRange: boolean = false;

    if (current.date) {
      const rangeStart: Date | null =
        previous &&
        previous.date &&
        !previousEndsRange &&
        LABEL_RANGE_SEPARATOR_REGEX.test(separator)
          ? previous.date
          : null;

      endsRange = rangeStart !== null;

      text =
        rangeStart &&
        OneUptimeDate.areOnTheSameLocalDay(rangeStart, current.date)
          ? OneUptimeDate.getLocalTimeString(current.date, { use12HourFormat })
          : OneUptimeDate.getDateAsLocalShortDateTimeString(current.date, {
              use12HourFormat,
            });
    }

    formatted += separator + text;
    cursor = current.end;
    previous = current;
    previousEndsRange = endsRange;
  }

  return formatted + label.slice(cursor);
}

const ID_LABELS: Map<string, string> = new Map<string, string>([
  ["incidentId", "Incident"],
  ["alertId", "Alert"],
  ["monitorId", "Monitor"],
  ["traceId", "Trace"],
  ["serviceId", "Service"],
  ["entityId", "Entity"],
  ["exceptionId", "Exception"],
  ["scheduledMaintenanceId", "Scheduled maintenance"],
  ["onCallPolicyId", "On-call policy"],
  ["onCallDutyPolicyId", "On-call policy"],
  ["scheduleId", "On-call schedule"],
  ["statusPageId", "Status page"],
  ["sloId", "SLO"],
  ["runbookId", "Runbook"],
  ["workflowId", "Workflow"],
  ["teamId", "Team"],
  ["repositoryId", "Repository"],
]);

const SEARCH_KEYS: Set<string> = new Set<string>([
  "searchText",
  "nameSearch",
  "bodySearchText",
  "messageSearchText",
  "nameSearchText",
]);

const LABELS: Map<string, string> = new Map<string, string>([
  ["state", "State"],
  ["metricName", "Metric"],
  ["aggregationType", "Aggregation"],
  ["limit", "Limit"],
  ["skip", "Skip"],
  ["runsLimit", "Recent runs"],
  ["limitPerSource", "Limit per source"],
  ["severityTexts", "Severity"],
  ["severityNames", "Severity"],
  ["classNames", "Event class"],
  ["telemetryType", "Telemetry type"],
  ["type", "Looked up"],
  ["monitorStatusName", "Monitor status"],
  ["problemsOnly", "Only monitors with problems"],
  ["includeResolved", "Include resolved"],
  ["includeGlobalProbes", "Include global probes"],
  ["hasException", "Only traces with exceptions"],
  ["rootOnly", "Root spans only"],
  ["groupBy", "Group by"],
  ["metric", "Measure"],
  ["sensitivity", "Sensitivity"],
  ["sloStatus", "SLO status"],
  ["status", "Status"],
  ["principalUser", "User"],
  ["principalHost", "Host"],
  ["observable", "Observable"],
  ["filePath", "File"],
  ["startLine", "Start line"],
  ["endLine", "End line"],
  ["aroundLine", "Around line"],
  ["query", "Search"],
  ["atTime", "At"],
  ["windowDays", "Baseline window"],
  ["lookbackDays", "Looking back"],
  ["withinDays", "Time window"],
  ["pastDays", "Past"],
  ["upcomingDays", "Upcoming"],
  ["createdWithinHours", "Time window"],
  ["lastSeenWithinHours", "Time window"],
]);

// Values that name a state or category read better capitalised.
const CAPITALIZED_VALUE_KEYS: Set<string> = new Set<string>([
  "state",
  "status",
  "sloStatus",
  "telemetryType",
  "type",
]);

const SHORTENED_ID_VISIBLE_LENGTH: number = 8;

export function shortenIdentifier(value: string): string {
  const trimmed: string = value.trim();

  if (trimmed.length <= SHORTENED_ID_VISIBLE_LENGTH + 4) {
    return trimmed;
  }

  return `${trimmed.slice(0, SHORTENED_ID_VISIBLE_LENGTH)}…`;
}

// "fooBarBaz" / "foo_bar_baz" → "Foo Bar Baz".
export function toTitleCaseLabel(key: string): string {
  const words: Array<string> = splitIntoWords(key);

  if (words.length === 0) {
    return key;
  }

  return words
    .map((word: string): string => {
      return capitalize(word);
    })
    .join(" ");
}

function pluralize(count: number, singular: string): string {
  return `${formatNumber(count)} ${singular}${count === 1 ? "" : "s"}`;
}

// "24 hours", but "90 days" rather than "2,160 hours" for whole days.
function formatHours(hours: number): string {
  if (hours >= 48 && Number.isInteger(hours) && hours % 24 === 0) {
    return pluralize(hours / 24, "day");
  }

  return pluralize(hours, "hour");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? formatInteger(value) : String(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed: number = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatScalar(value: unknown): string | null {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? formatNumber(value) : null;
  }

  if (typeof value === "string") {
    const trimmed: string = value.trim();
    return trimmed ? trimmed : null;
  }

  return null;
}

function formatGenericValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    const parts: Array<string> = value
      .map((item: unknown): string | null => {
        return formatScalar(item);
      })
      .filter((item: string | null): item is string => {
        return item !== null;
      });

    return parts.length > 0 ? parts.join(", ") : null;
  }

  return formatScalar(value);
}

/*
 * The arguments of one evidence query as friendly label/value rows, in the
 * order the query was written, with a start/end pair merged into a single
 * "Time window" row that leads the list.
 */
export function formatEvidenceArguments(
  toolName: string | null | undefined,
  args: JSONObject | null | undefined,
): Array<FormattedEvidenceArgument> {
  const rows: Array<FormattedEvidenceArgument> = [];

  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return rows;
  }

  const normalisedToolName: string =
    typeof toolName === "string" ? toolName : "";
  const startDate: Date | null = parseIsoDate(args["startTime"]);
  const endDate: Date | null = parseIsoDate(args["endTime"]);
  const mergesTimeWindow: boolean = Boolean(startDate && endDate);

  if (startDate && endDate) {
    rows.push({
      key: "timeWindow",
      label: "Time window",
      value: formatEvidenceTimeWindow(startDate, endDate),
    });
  }

  for (const key of Object.keys(args)) {
    const value: unknown = args[key];

    if (mergesTimeWindow && (key === "startTime" || key === "endTime")) {
      continue;
    }

    const row: FormattedEvidenceArgument | null = formatArgument(
      normalisedToolName,
      key,
      value,
    );

    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

function formatArgument(
  toolName: string,
  key: string,
  value: unknown,
): FormattedEvidenceArgument | null {
  if (key === "startTime" || key === "endTime" || key === "atTime") {
    const text: string | null =
      formatEvidenceDateTime(value) ?? formatScalar(value);

    if (text === null) {
      return null;
    }

    return {
      key,
      label: key === "startTime" ? "From" : key === "endTime" ? "Until" : "At",
      value: text,
    };
  }

  const idLabel: string | undefined = ID_LABELS.get(key);

  if (idLabel) {
    const text: string | null = formatScalar(value);
    return text === null
      ? null
      : { key, label: idLabel, value: shortenIdentifier(text) };
  }

  if (SEARCH_KEYS.has(key) || (key === "query" && toolName === "search_code")) {
    const text: string | null = formatScalar(value);
    return text === null ? null : { key, label: "Search", value: `“${text}”` };
  }

  const durationRow: FormattedEvidenceArgument | null = formatWindowArgument(
    key,
    value,
  );

  if (durationRow) {
    return durationRow;
  }

  const text: string | null = formatGenericValue(value);

  if (text === null) {
    return null;
  }

  return {
    key,
    label: LABELS.get(key) ?? toTitleCaseLabel(key),
    value:
      CAPITALIZED_VALUE_KEYS.has(key) && typeof value === "string"
        ? capitalize(text)
        : text,
  };
}

function formatWindowArgument(
  key: string,
  value: unknown,
): FormattedEvidenceArgument | null {
  const amount: number | null = toFiniteNumber(value);

  if (amount === null) {
    return null;
  }

  switch (key) {
    case "createdWithinHours":
      return {
        key,
        label: "Time window",
        value: `Created within the last ${formatHours(amount)}`,
      };
    case "lastSeenWithinHours":
      return {
        key,
        label: "Time window",
        value: `Last seen within the last ${formatHours(amount)}`,
      };
    case "withinDays":
      return {
        key,
        label: "Time window",
        value: `Within the last ${pluralize(amount, "day")}`,
      };
    case "lookbackDays":
      return {
        key,
        label: "Looking back",
        value: pluralize(amount, "day"),
      };
    case "pastDays":
      return { key, label: "Past", value: pluralize(amount, "day") };
    case "upcomingDays":
      return { key, label: "Upcoming", value: pluralize(amount, "day") };
    case "windowDays":
      return {
        key,
        label: "Baseline window",
        value: pluralize(amount, "day"),
      };
    default:
      return null;
  }
}
