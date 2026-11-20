import { formatReaderFigure } from "../../Types/DateLanguage";
import {
  composedValue,
  formatList,
  TemplateValue,
  translationKey,
  Translator,
} from "../../Types/Translator";
import { recordNameInSentence } from "../DefaultRecordNames";
import { escapeRegExp } from "../RegExpEscape";
import { StateListType } from "../StateListType";

/*
 * WHY A STATUS OR A STATE CHANGED, WHEN ONEUPTIME CHANGED IT (#9592, #9752,
 * #9959).
 *
 * A status event's or a state change's root cause is usually what a person
 * typed, or the Markdown a criteria writes (MonitorRootCauseWording words
 * it). When OneUptime itself changes a monitor's status, or an incident's,
 * an alert's or an episode's state, it writes one note of its own instead,
 * in English, once, for everyone who reads it - the API, the feed, Slack and
 * the emails read that English as it is:
 *
 *   - a monitor's status: a person set it, an incident or a maintenance
 *     event changed it, no criteria matched, the monitor was created or
 *     updated, monitoring went off or on, an OpenStack project's dependency
 *     had an incident, its history was restored;
 *   - an incident's, an alert's or an episode's state: a person changed it,
 *     the record was updated, its episode changed state, an episode was
 *     acknowledged, resolved or reopened, an incident declared from an alert
 *     or linked to it moved on, a monitor's series or key recovered, the
 *     monitor's monitoring was turned off, a network site recovered, an SLO,
 *     its burn rate rule or its policy tier no longer holds it open, a
 *     budget's month ended, Data Security or Data Observability closed it,
 *     auto-remediation or OneUptime AI fixed it;
 *   - and an incident's or an alert's own root cause, when OneUptime opened
 *     it itself (#10125): a Sigma rule or a threat intel feed matched, a Data
 *     Security check failed, an incoming request matched a grouping key, an
 *     SLO's burn rate or error budget crossed its line, a network site rolled
 *     up, what cost the most of a cloud budget, a workflow or a chat paged
 *     people - and, on older records, who opened it. The record's Root Cause
 *     page and its What happened card read it (RecordRootCauseWording), and
 *     so does View Cause: IncidentService and AlertService copy it to the
 *     record's first state, and to every monitor status it changed.
 *
 * Each note is defined here once (StatusChangeNote): how OneUptime writes it,
 * its values as {{placeholders}}, how older rows wrote it, and the key the
 * reader's language words it by. View Cause and the monitor's hero read a
 * stored note back by those templates, its values with it, and say it in
 * the reader's language (wordStatusChangeNote): so a row of last year reads
 * worded too, and so does every place that reads the English as it is. A
 * value - who, which incident, the monitor's name - is kept as it was handed
 * in (plain words or Markdown) and set apart from the words round it; a
 * figure is written in the reader's digits; a default status name in their
 * words. Only a whole note is read: any other text, a note a person wrote
 * among them, reads as written.
 *
 * The server writes a note with no value from its constant here; a writer
 * that places values (with mdText) writes the same template, and
 * StatusChangeCauseWording.test.ts holds every writer to the note it reads.
 *
 * React-free, so the Dashboard's tests and Common's read it the same way.
 */

export interface StatusChangeNote {
  // As OneUptime writes it, in English, each value a {{placeholder}}.
  written: string;
  /*
   * What the reader reads: a key the Dashboard's locales word, its values
   * those of `written` (a value it leaves out is not said). The written
   * English, when it reads well as it is.
   */
  said?: string | undefined;
  // How older rows wrote it, with the same values.
  formerly?: ReadonlyArray<string> | undefined;
  // The values that are figures, written in the reader's digits.
  figures?: ReadonlyArray<string> | undefined;
  /*
   * The values that are a record's name: one of OneUptime's default names
   * of its list ("Operational") reads in the reader's words.
   */
  recordNames?: Readonly<Record<string, StateListType>> | undefined;
  /*
   * The values that are a person as OneUptime names one - their name linked
   * to their page, "[Jane Doe](https://...)", as mdText writes it. The note
   * is read only when the value is one: a root cause a person typed that
   * starts the same way ("Incident created by a bad deploy") reads as
   * written.
   */
  people?: ReadonlyArray<string> | undefined;
  // The values that are a chat handle with its "@", "@maya": read only so.
  handles?: ReadonlyArray<string> | undefined;
  /*
   * The values that are a percentage as a writer places it ("25%",
   * "12.35%"): read only so, and written in the reader's digits ("۲۵٪").
   */
  percents?: ReadonlyArray<string> | undefined;
  /*
   * The values that are a list of what cost what, as a budget writes it -
   * "Amazon EC2 ($437.87), Amazon S3 ($272.74) and AWS Lambda ($34.84)" -
   * each item kept as written, joined as the reader's language joins a
   * list ("... و AWS Lambda ($34.84)").
   */
  costs?: ReadonlyArray<string> | undefined;
}

// Each value: at most this long, on one line, so a match is linear in the text.
const MAX_VALUE_LENGTH: number = 500;
// A longer text is no note of OneUptime's.
const MAX_NOTE_LENGTH: number = 3000;

const PLACEHOLDER: RegExp = /\{\{(\w+)\}\}/g;

// A figure as a writer places it: digits only.
const WHOLE_NUMBER: RegExp = /^\d+$/;

/*
 * A value of a shape (people, handles, percents), as a pattern reads it:
 * bounded, on one line, so a match stays linear in the text. A person's
 * link is the one WhoOpenedItRootCause has always read: its text as mdText
 * escaped it, its address without a space or a bracket.
 */
const PERSON_LINK_PATTERN: string = String.raw`\[(?:\\.|[^\\\]\n]){1,${MAX_VALUE_LENGTH}}\]\([^()\s]{1,${MAX_VALUE_LENGTH}}\)`;
const HANDLE_PATTERN: string = `@[^\\n]{1,${MAX_VALUE_LENGTH}}?`;
const PERCENT_PATTERN: string = String.raw`\d{1,12}(?:\.\d{1,12})?%`;

// A percentage as a writer places it, its figure apart from its sign.
const PERCENT_VALUE: RegExp = /^(\d{1,12}(?:\.\d{1,12})?)%$/;

// The most decimals a percentage is written with: formatSloPolicyTierThreshold's.
const PERCENT_DECIMALS: number = 2;

/*
 * One item of a list of costs: what, then what it cost in brackets - an
 * amount, so it holds a digit ("Amazon EC2 ($437.87)").
 */
const COST_ITEM: RegExp = /^[^\n]+ \([^()\n]*\d[^()\n]*\)$/;

// Where one item of a list of costs ends and the next begins, as written.
const COST_SEPARATOR: RegExp = /\)(?:, | and )/g;

// The last two items of a list, as the reader's language joins them.
const ITEMS_AND_LAST: string = translationKey("{{items}} and {{last}}");

/*
 * ---------------------------------------------------------------------------
 * A monitor's status
 * ---------------------------------------------------------------------------
 */

export const STATUS_CHANGED_BY_USER: string = translationKey(
  "Changed by {{user}}",
);
export const STATUS_CHANGED_BY_NEW_INCIDENT: string = translationKey(
  "Changed because incident {{incident}} was created.",
);
export const STATUS_CHANGED_BY_UPDATED_INCIDENT: string = translationKey(
  "Changed because incident {{incident}} was updated.",
);
export const STATUS_CHANGED_BY_MAINTENANCE: string = translationKey(
  "Changed by a maintenance event.",
);
/*
 * Said better than the engine stores it ("No monitoring criteria met.
 * Change to default status."), in English too.
 */
export const STATUS_CHANGED_TO_DEFAULT: string = translationKey(
  "No criteria matched, so the monitor changed to its default status.",
);
export const STATUS_CREATED_WITH_MONITOR: string = translationKey(
  "This status was created when the monitor was created.",
);
export const STATUS_CHANGED_WITH_MONITOR: string = translationKey(
  "This status was changed when the monitor was updated.",
);
export const MONITORING_TURNED_OFF_BY_USER: string = translationKey(
  "{{user}} turned off monitoring. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
);
export const MONITORING_TURNED_OFF: string = translationKey(
  "Monitoring is off. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
);
export const MONITORING_TURNED_ON_BY_USER: string = translationKey(
  "{{user}} turned monitoring back on. Uptime, status pages and SLOs count the monitor's time again from here.",
);
export const MONITORING_TURNED_ON: string = translationKey(
  "Monitoring was turned back on. Uptime, status pages and SLOs count the monitor's time again from here.",
);
// OpenStackProjectPages writes these two, from here.
export const OPENSTACK_PROJECT_USES_INCIDENT: string = translationKey(
  "Something this project uses has an incident.",
);
export const OPENSTACK_PROJECT_USES_BACK: string = translationKey(
  "What this project uses is back.",
);
// MonitorStatusTimelineReconciler, when a monitor's status history was deleted.
export const STATUS_RESTORED: string = translationKey(
  "Restored by {{productName}}. This monitor's status history had been deleted, so its current status was recorded again, starting at its last recorded status change (or when the monitor was created).",
);

// What follows who turned monitoring off or on, as the service writes it.
const MONITORING_OFF_TAIL: string =
  " Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.";
const MONITORING_ON_TAIL: string =
  " Uptime, status pages and SLOs count the monitor's time again from here.";

const MONITOR_STATUS_NOTES: ReadonlyArray<StatusChangeNote> = [
  // MonitorStatusTimelineService, for a status a person set.
  {
    written: "Monitor status created by {{user}}",
    said: STATUS_CHANGED_BY_USER,
  },
  // IncidentService, for a monitor an incident changed.
  {
    written: "Status was changed because Incident {{incident}} was created.",
    said: STATUS_CHANGED_BY_NEW_INCIDENT,
  },
  {
    written: "Status was changed because Incident {{incident}} was updated.",
    said: STATUS_CHANGED_BY_UPDATED_INCIDENT,
  },
  // ScheduledMaintenanceService: the event's id is no word for a reader.
  {
    written: "Changed because of maintenance event: {{maintenanceEventId}}",
    said: STATUS_CHANGED_BY_MAINTENANCE,
  },
  // MonitorResource, the engine's own words.
  {
    written: "No monitoring criteria met. Change to default status.",
    said: STATUS_CHANGED_TO_DEFAULT,
  },
  // MonitorService.
  { written: STATUS_CREATED_WITH_MONITOR },
  { written: STATUS_CHANGED_WITH_MONITOR },
  // MonitorStatusTimelineService.getMonitoringSwitchRootCause.
  { written: MONITORING_TURNED_OFF },
  { written: MONITORING_TURNED_ON },
  {
    written: `{{user}} turned off monitoring.${MONITORING_OFF_TAIL}`,
    said: MONITORING_TURNED_OFF_BY_USER,
  },
  {
    written: `{{user}} turned monitoring back on.${MONITORING_ON_TAIL}`,
    said: MONITORING_TURNED_ON_BY_USER,
  },
  { written: OPENSTACK_PROJECT_USES_INCIDENT },
  { written: OPENSTACK_PROJECT_USES_BACK },
  {
    written: STATUS_RESTORED,
    formerly: [
      "Restored by {{productName}}. This monitor's status history had been deleted, so {{productName}} recorded its current status again, from the last status change it has a record of (or from when the monitor was created).",
    ],
  },
];

/*
 * ---------------------------------------------------------------------------
 * An incident's, an alert's and an episode's state
 * ---------------------------------------------------------------------------
 */

// The *StateTimelineService's own, for a state a person changed.
const STATE_CHANGED_BY_USER_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: "Incident state created by {{user}}",
    said: STATUS_CHANGED_BY_USER,
  },
  { written: "Alert state created by {{user}}", said: STATUS_CHANGED_BY_USER },
  {
    written: "Episode state created by {{user}}",
    said: STATUS_CHANGED_BY_USER,
  },
];

// A record's state written by an update of the record (the API, Terraform, a workflow).
export const STATE_CHANGED_WITH_INCIDENT: string = translationKey(
  "This status was changed when the incident was updated.",
);
export const STATE_CHANGED_WITH_ALERT: string = translationKey(
  "This status was changed when the alert was updated.",
);
export const STATE_CHANGED_WITH_EPISODE: string = translationKey(
  "State was changed when the episode was updated.",
);

/*
 * A member incident's or alert's state, moved with its episode's: stored as
 * it always was, said better.
 */
export const STATE_CHANGED_BY_EPISODE: string =
  "State changed by episode state cascade.";
export const STATE_CHANGED_WITH_ITS_EPISODE: string = translationKey(
  "Changed when its episode changed state.",
);

// An episode acknowledged, resolved or reopened by a person, or through the API.
export const EPISODE_ACKNOWLEDGED_BY_USER: string = translationKey(
  "Acknowledged by user.",
);
export const EPISODE_ACKNOWLEDGED_VIA_API: string = translationKey(
  "Acknowledged via API.",
);
export const EPISODE_RESOLVED_BY_USER: string =
  translationKey("Resolved by user.");
export const EPISODE_RESOLVED_VIA_API: string =
  translationKey("Resolved via API.");
export const EPISODE_REOPENED_BY_USER: string =
  translationKey("Reopened by user.");
export const EPISODE_REOPENED_VIA_API: string =
  translationKey("Reopened via API.");

/*
 * An episode OneUptime resolved or reopened itself, by its grouping rule
 * (the episodes' AutoResolve and ResolveInactiveEpisodes jobs, the grouping
 * engines): what used to say "Resolved via API." of an incident episode, and
 * nothing of an alert episode.
 */
export const EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED: string = translationKey(
  "Resolved because every incident in it is resolved.",
);
export const EPISODE_RESOLVED_ALL_ALERTS_RESOLVED: string = translationKey(
  "Resolved because every alert in it is resolved.",
);
export const EPISODE_RESOLVED_NO_NEW_INCIDENT: string = translationKey(
  "Resolved because no new incident joined it within its inactivity timeout.",
);
export const EPISODE_RESOLVED_NO_NEW_ALERT: string = translationKey(
  "Resolved because no new alert joined it within its inactivity timeout.",
);
export const EPISODE_REOPENED_BY_NEW_INCIDENT: string = translationKey(
  "Reopened because a new incident joined it within its reopen window.",
);
export const EPISODE_REOPENED_BY_NEW_ALERT: string = translationKey(
  "Reopened because a new alert joined it within its reopen window.",
);

const STATE_CHANGED_WITH_RECORD_NOTES: ReadonlyArray<StatusChangeNote> = [
  { written: STATE_CHANGED_WITH_INCIDENT },
  { written: STATE_CHANGED_WITH_ALERT },
  { written: STATE_CHANGED_WITH_EPISODE },
  { written: STATE_CHANGED_BY_EPISODE, said: STATE_CHANGED_WITH_ITS_EPISODE },
  { written: EPISODE_ACKNOWLEDGED_BY_USER },
  { written: EPISODE_ACKNOWLEDGED_VIA_API },
  { written: EPISODE_RESOLVED_BY_USER },
  { written: EPISODE_RESOLVED_VIA_API },
  { written: EPISODE_REOPENED_BY_USER },
  { written: EPISODE_REOPENED_VIA_API },
  { written: EPISODE_RESOLVED_ALL_INCIDENTS_RESOLVED },
  { written: EPISODE_RESOLVED_ALL_ALERTS_RESOLVED },
  { written: EPISODE_RESOLVED_NO_NEW_INCIDENT },
  { written: EPISODE_RESOLVED_NO_NEW_ALERT },
  { written: EPISODE_REOPENED_BY_NEW_INCIDENT },
  {
    written: EPISODE_REOPENED_BY_NEW_ALERT,
    // The alert grouping engine's reopen, before #9959.
    formerly: ["Episode reopened due to new alert added."],
  },
  // A chat's Change State on an episode, before it changed the state as the member.
  { written: translationKey("State changed via Slack.") },
  { written: translationKey("State changed via Microsoft Teams.") },
];

/*
 * An alert an incident was declared from, or one linked to an incident that
 * moved on (IncidentAlertService). The docs quote these as they are
 * (IncidentLinkedAlertsDocs).
 */
const LINKED_ALERT_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      "Acknowledged because a private incident was declared from this alert.",
    ),
  },
  {
    written: translationKey(
      "Acknowledged because Incident {{incident}} was declared from this alert.",
    ),
  },
  {
    written: translationKey(
      "Acknowledged because Incident was declared from this alert.",
    ),
  },
  {
    written: translationKey(
      "Resolved because linked Incident {{incident}} was resolved.",
    ),
  },
  {
    written: translationKey(
      "Acknowledged because linked Incident {{incident}} was resolved.",
    ),
  },
  {
    written: translationKey(
      "Acknowledged because linked Incident {{incident}} was acknowledged.",
    ),
  },
  {
    written: translationKey("Resolved because linked Incident was resolved."),
  },
  {
    written: translationKey(
      "Acknowledged because linked Incident was resolved.",
    ),
  },
  {
    written: translationKey(
      "Acknowledged because linked Incident was acknowledged.",
    ),
  },
];

/*
 * Why a monitor resolved one series' or one key's incident or alert, after
 * the auto-resolve sentence on the same line (MonitorIncident, MonitorAlert):
 * PerSeriesResolutionRootCause, MonitorResource, LogGroupCriteriaFanOut.
 */
const SERIES_RESOLVED_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      'The monitor no longer satisfies criteria "{{criteria}}".',
    ),
  },
  {
    written: translationKey(
      "The monitor no longer satisfies the criteria that raised it.",
    ),
  },
  {
    written: translationKey(
      'Series "{{series}}" no longer satisfies criteria "{{criteria}}".',
    ),
  },
  {
    written: translationKey(
      'Series "{{series}}" no longer satisfies the criteria that raised it.',
    ),
  },
  {
    written: translationKey(
      'This series no longer satisfies criteria "{{criteria}}".',
    ),
  },
  {
    written: translationKey(
      "This series no longer satisfies the criteria that raised it.",
    ),
  },
  {
    written: translationKey("Incoming request reported this key as resolved."),
  },
  {
    written: translationKey(
      "Incoming request with no value to group by reported recovered.",
    ),
  },
  { written: translationKey("A log that resolves this group arrived.") },
];

// MonitorTurnedOff: an incident or alert set to resolve on its own, resolved when monitoring went off.
const MONITORING_TURNED_OFF_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      "Monitoring is off for the monitor **{{monitor}}**. This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved when OneUptime was upgraded. If monitoring is turned back on while the problem is still there, a new incident is opened.",
    ),
  },
  {
    written: translationKey(
      "Monitoring is off for the monitor **{{monitor}}**. This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved when OneUptime was upgraded. If monitoring is turned back on while the problem is still there, a new alert is opened.",
    ),
  },
  {
    written: translationKey(
      "Monitoring was turned off for the monitor **{{monitor}}**. This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new incident is opened.",
    ),
  },
  {
    written: translationKey(
      "Monitoring was turned off for the monitor **{{monitor}}**. This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new alert is opened.",
    ),
  },
  {
    written: translationKey(
      "{{user}} turned off monitoring for the monitor **{{monitor}}**. This incident was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new incident is opened.",
    ),
  },
  {
    written: translationKey(
      "{{user}} turned off monitoring for the monitor **{{monitor}}**. This alert was set to resolve on its own once the monitor recovered, and nothing checks the monitor while its monitoring is off, so it was resolved now. If monitoring is turned back on while the problem is still there, a new alert is opened.",
    ),
  },
];

// NetworkSiteService: a site's alert, resolved.
const NETWORK_SITE_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      "No device at network site **{{site}}** reports a status any more: the monitors behind its devices have their monitoring turned off, are archived or were deleted. This alert was set to resolve on its own once the site recovered, and nothing checks the site now, so it was resolved now. If a device at the site reports a problem again, a new alert is opened.",
    ),
  },
  // The site's status had no name: read before the note that names one.
  {
    written: translationKey(
      "**Recovered:** Network site **{{site}}** rolled back up to an operational status.",
    ),
  },
  {
    written: translationKey(
      "**Recovered:** Network site **{{site}}** rolled back up to {{status}}.",
    ),
    recordNames: { status: StateListType.MonitorStatus },
  },
];

/*
 * An SLO's alert or incident, resolved (ServiceLevelObjectiveService, its
 * burn rate rules' and policy tiers' services, the EvaluateSlos job).
 */
const SLO_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      "Auto-resolved because the Service Level Objective was archived.",
    ),
  },
  {
    written: translationKey(
      "Auto-resolved because the Service Level Objective was disabled or deleted.",
    ),
    formerly: [
      "Alert auto-resolved because the Service Level Objective was disabled or deleted.",
    ],
  },
  {
    written: translationKey(
      "Auto-resolved because the SLO burn rate rule that created it was deleted.",
    ),
    formerly: [
      "Alert auto-resolved because the SLO burn rate rule that created it was deleted.",
    ],
  },
  {
    written: translationKey(
      "Alert auto-resolved because the SLO burn rate rule that created it was disabled.",
    ),
  },
  {
    written: translationKey(
      "Alert auto-resolved because the SLO burn rate rule that created it no longer raises alerts.",
    ),
  },
  {
    written: translationKey(
      "Incident auto-resolved because the SLO burn rate rule that declared it was disabled.",
    ),
  },
  {
    written: translationKey(
      "Incident auto-resolved because the SLO burn rate rule that declared it no longer declares incidents.",
    ),
  },
  {
    written: translationKey(
      "Alert auto-resolved because the SLO burn rate rule that created it is no longer active.",
    ),
  },
  {
    written: translationKey(
      "Incident auto-resolved because the SLO burn rate rule that declared it is no longer active.",
    ),
  },
  {
    written: translationKey(
      "Auto-resolved because the error budget policy tier that raised it was disabled.",
    ),
  },
  {
    written: translationKey(
      "Auto-resolved because the error budget policy tier that raised it was deleted.",
    ),
  },
  {
    written: translationKey(
      "Alert auto-resolved because the error budget policy tier that raised it no longer raises alerts.",
    ),
  },
  {
    written: translationKey(
      "Incident auto-resolved because the error budget policy tier that declared it no longer declares incidents.",
    ),
  },
  {
    written: translationKey(
      "Alert auto-resolved because the error budget policy tier that raised it no longer applies.",
    ),
  },
  {
    written: translationKey(
      "Incident auto-resolved because the error budget policy tier that declared it no longer applies.",
    ),
  },
  {
    written: translationKey(
      'Superseded: SLO "{{slo}}" entered the more severe "{{tier}}" tier of its error budget policy.',
    ),
  },
  {
    written: translationKey(
      'The error budget of SLO "{{slo}}" recovered out of the "{{tier}}" tier of its error budget policy.',
    ),
  },
  {
    written: translationKey(
      "Auto-resolved because this SLO burn rate rule no longer has a valid threshold and window configuration, so it can no longer justify staying open.",
    ),
  },
  { written: translationKey("Burn rate dropped below threshold.") },
  {
    written: translationKey(
      "The SLO no longer has {{minutes}} minutes of counted requests, so this burn rate rule can no longer justify an open alert or incident.",
    ),
    figures: ["minutes"],
  },
  {
    written: translationKey(
      "The SLO no longer has {{minutes}} minutes of monitoring history, so this burn rate rule can no longer justify an open alert or incident.",
    ),
    formerly: [
      "The SLO no longer has {{minutes}} minutes of monitoring history, so this burn rate rule can no longer justify an open alert.",
    ],
    figures: ["minutes"],
  },
];

// The budgets' alerts, resolved when their month ends.
const BUDGET_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      "Resolved by OneUptime: the month this cloud budget alert was raised in is over.",
    ),
  },
  {
    written: translationKey(
      "Resolved by OneUptime: the month this OpenStack budget alert was raised in is over.",
    ),
  },
];

/*
 * Data Security's alert, resolved with its issue (DataSecurityIssueAlerts),
 * each why its issue is no longer open; Data Observability's, by a person's
 * feedback (DataAlertFeedbackRecorder).
 */
const DATA_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      "Resolved by Data Security, as the issue it was raised for is no longer open: its check passes now.",
    ),
  },
  {
    written: translationKey(
      "Resolved by Data Security, as the issue it was raised for is no longer open: its check no longer runs on the store.",
    ),
  },
  {
    written: translationKey(
      "Resolved by Data Security, as the issue it was raised for is no longer open: its store was archived.",
    ),
  },
  {
    written: translationKey(
      "Resolved by Data Security, as the issue it was raised for is no longer open: its store was deleted.",
    ),
  },
  {
    written: translationKey(
      "Resolved by Data Security, as the issue it was raised for is no longer open: it was marked resolved.",
    ),
  },
  {
    written: translationKey(
      "Resolved by Data Security, as the issue it was raised for is no longer open: its risk was accepted.",
    ),
  },
  {
    written: translationKey(
      "Resolved by Data Security, as the issue it was raised for is no longer open: it was marked not an issue.",
    ),
  },
  { written: translationKey("Marked expected in Data Observability.") },
  { written: translationKey("Marked not an issue in Data Observability.") },
];

// An incident or alert a fix closed: auto-remediation's (RemediationVerifier) and OneUptime AI's (AiFirstResponder).
const FIXED_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: translationKey(
      'Auto-resolved by auto-remediation: the AI command remediation (rule "{{rule}}") completed and the monitor(s) recovered within the verification window.',
    ),
  },
  {
    written: translationKey(
      'Auto-resolved by auto-remediation: the fix through MCP servers (rule "{{rule}}") completed and the monitor(s) recovered within the verification window.',
    ),
  },
  {
    written: translationKey(
      'Auto-resolved by auto-remediation: runbook "{{runbook}}" (rule "{{rule}}") completed and the monitor(s) recovered within the verification window.',
    ),
  },
  {
    written: translationKey(
      "Resolved by OneUptime AI: its fix was verified - every affected monitor is operational again - so nobody was paged.",
    ),
  },
];

/*
 * ---------------------------------------------------------------------------
 * An incident's or an alert's own root cause, when OneUptime opened it
 * ---------------------------------------------------------------------------
 */

/*
 * Who opened the record, as OneUptime wrote it into an empty root cause
 * until e1318450be7: still on older records, their first state and the
 * monitor statuses they changed. It says who, not why, so the What
 * happened card reads it as no root cause yet (WhoOpenedItRootCause); the
 * Root Cause page and View Cause say who declared or created it, as a state
 * a person changed says "Changed by".
 */
export const WHO_OPENED_IT_NOTES: ReadonlyArray<StatusChangeNote> = [
  {
    written: "Incident created by {{user}}",
    said: translationKey("Declared by {{user}}"),
    people: ["user"],
  },
  {
    written: "Alert created by {{user}}",
    said: translationKey("Created by {{user}}"),
    people: ["user"],
  },
  // Slack's Declare Incident: the member's handle, "@maya", as Slack sent it.
  {
    written: "Incident created by {{handle}} on Slack.",
    said: translationKey("Declared by {{handle}} in Slack."),
    handles: ["handle"],
  },
  // Microsoft Teams' Declare Incident, and the OneUptime AI copilot's tool.
  {
    written: "Incident created via Microsoft Teams",
    said: translationKey("Declared from Microsoft Teams."),
  },
  {
    written: "Incident created via the OneUptime AI copilot.",
    said: translationKey("Declared by OneUptime AI."),
  },
];

/*
 * Why OneUptime opened the record (#10125): a security detection, an
 * incoming request's grouping key, an SLO, a network site, a cloud budget,
 * a page. Each writer places its values with mdText, and
 * StateChangeNotesInReadersLanguage.test.ts holds it to its template here.
 */
const RECORD_ROOT_CAUSE_NOTES: ReadonlyArray<StatusChangeNote> = [
  /*
   * IncomingRequestIncidentGrouping: the key as code, the span mdText
   * writes around it part of the value ("`checkout-42`").
   */
  {
    written: translationKey("Incoming request matched grouping key {{key}}."),
  },
  // DetectionRuleEvaluator and ThreatIntelMatcher, an alert's or an incident's.
  {
    written: translationKey(
      'Sigma detection rule "{{rule}}" matched security events.',
    ),
  },
  {
    written: translationKey(
      'Threat intel feed "{{feed}}" indicator matched security events.',
    ),
  },
  // DataSecurityIntegrations: the check's id and the store's name, as written.
  {
    written: translationKey(
      'The Data Security check "{{check}}" failed on {{store}}.',
    ),
  },
  // The EvaluateSlos job: a burn rate rule's breach, and a policy tier's.
  {
    written: translationKey(
      'Error budget burn rate breached the "{{rule}}" rule of SLO "{{slo}}".',
    ),
  },
  {
    written: translationKey(
      'The error budget left of SLO "{{slo}}" is at or below {{threshold}}, the "{{tier}}" tier of its error budget policy.',
    ),
    percents: ["threshold"],
  },
  // NetworkSiteService: the site's alert, the status it rolled up to.
  {
    written: translationKey(
      "Network site **{{site}}** rolled up to **{{status}}**.",
    ),
    recordNames: { status: StateListType.MonitorStatus },
  },
  // CloudBudgetEvaluator.describeTopServices: where the month's money went.
  {
    written: translationKey("What cost the most this month: {{services}}."),
    costs: ["services"],
  },
  /*
   * An alert opened to page people (OnCallPageService for a workflow,
   * WorkspacePage for Slack and Microsoft Teams, its name as written).
   */
  {
    written: translationKey(
      "Created by workflow **{{workflow}}** to page people.",
    ),
  },
  {
    written: translationKey(
      "Created by **{{pager}}** from {{workspace}} to page people.",
    ),
  },
  {
    written: translationKey("Created from {{workspace}} to page people."),
  },
  ...WHO_OPENED_IT_NOTES,
];

/*
 * Every note OneUptime writes, in the order they are read: a note's
 * template is literal enough that no two match the same text.
 */
export const STATUS_CHANGE_NOTES: ReadonlyArray<StatusChangeNote> = [
  ...MONITOR_STATUS_NOTES,
  ...STATE_CHANGED_BY_USER_NOTES,
  ...STATE_CHANGED_WITH_RECORD_NOTES,
  ...LINKED_ALERT_NOTES,
  ...SERIES_RESOLVED_NOTES,
  ...MONITORING_TURNED_OFF_NOTES,
  ...NETWORK_SITE_NOTES,
  ...SLO_NOTES,
  ...BUDGET_NOTES,
  ...DATA_NOTES,
  ...FIXED_NOTES,
  ...RECORD_ROOT_CAUSE_NOTES,
];

// A note's placeholders, in the order its template names them, each once.
export function getStatusChangeNotePlaceholders(
  template: string,
): Array<string> {
  const names: Array<string> = [];

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name: string = match[1] as string;

    if (!names.includes(name)) {
      names.push(name);
    }
  }

  return names;
}

// What a value of the note may be, as a pattern: its shape's, else any line.
function getValuePattern(note: StatusChangeNote, name: string): string {
  if (note.people?.includes(name)) {
    return PERSON_LINK_PATTERN;
  }

  if (note.handles?.includes(name)) {
    return HANDLE_PATTERN;
  }

  if (note.percents?.includes(name)) {
    return PERCENT_PATTERN;
  }

  return `[^\\n]{1,${MAX_VALUE_LENGTH}}?`;
}

/*
 * A template as a pattern that reads a stored note whole: its words as
 * written, each value lazy and bounded (or of its shape), a value named
 * twice the same twice.
 */
function toPattern(template: string, note: StatusChangeNote): RegExp {
  let pattern: string = "^";
  let index: number = 0;
  const seen: Set<string> = new Set<string>();

  for (const match of template.matchAll(PLACEHOLDER)) {
    const name: string = match[1] as string;

    pattern += escapeRegExp(template.slice(index, match.index));
    pattern += seen.has(name)
      ? `\\k<${name}>`
      : `(?<${name}>${getValuePattern(note, name)})`;
    seen.add(name);
    index = (match.index as number) + match[0].length;
  }

  return new RegExp(`${pattern}${escapeRegExp(template.slice(index))}$`);
}

interface ReadableNote {
  note: StatusChangeNote;
  patterns: Array<RegExp>;
}

const READABLE_NOTES: ReadonlyArray<ReadableNote> = STATUS_CHANGE_NOTES.map(
  (note: StatusChangeNote): ReadableNote => {
    return {
      note: note,
      patterns: [note.written, ...(note.formerly || [])].map(
        (template: string): RegExp => {
          return toPattern(template, note);
        },
      ),
    };
  },
);

// A stored note's values, by the note's templates; null when it is no such note.
export function readStatusChangeNote(text: string): {
  note: StatusChangeNote;
  values: Record<string, string>;
} | null {
  const stored: string = text.trim();

  if (!stored || stored.length > MAX_NOTE_LENGTH) {
    return null;
  }

  for (const readable of READABLE_NOTES) {
    for (const pattern of readable.patterns) {
      const match: RegExpExecArray | null = pattern.exec(stored);

      if (match) {
        return { note: readable.note, values: { ...(match.groups || {}) } };
      }
    }
  }

  return null;
}

/*
 * The items of a list of costs as a budget wrote it ("A ($1), B ($2) and C
 * ($3)"), each as written; null when it is not one, item by item - a name
 * with a ", " of its own in brackets is read as no list, and kept whole.
 */
export function readCostItems(list: string): Array<string> | null {
  const items: Array<string> = [];
  let start: number = 0;

  for (const separator of list.matchAll(COST_SEPARATOR)) {
    // The bracket that ends an item is the item's.
    items.push(list.slice(start, (separator.index as number) + 1));
    start = (separator.index as number) + separator[0].length;
  }

  items.push(list.slice(start));

  return items.every((item: string): boolean => {
    return COST_ITEM.test(item);
  })
    ? items
    : null;
}

/*
 * A note's value as the sentence takes it: a figure or a percentage in the
 * reader's digits, a default name in their words, a list of costs joined
 * as their language joins a list. A list and a percentage are written with
 * the sentence's translator (composedValue): an English sentence of a
 * language that does not word it yet reads "and", and English digits.
 */
function toTemplateValue(data: {
  note: StatusChangeNote;
  name: string;
  value: string;
  translator: Translator;
}): TemplateValue {
  if (data.note.figures?.includes(data.name)) {
    const figure: number = Number(data.value);

    if (Number.isFinite(figure) && WHOLE_NUMBER.test(data.value)) {
      return data.translator.formatNumber(figure);
    }
  }

  if (data.note.percents?.includes(data.name)) {
    const percent: RegExpExecArray | null = PERCENT_VALUE.exec(data.value);
    const figure: number = percent ? Number(percent[1]) : Number.NaN;

    if (Number.isFinite(figure)) {
      return composedValue((sentence: Translator): string => {
        return formatReaderFigure(figure, {
          decimals: PERCENT_DECIMALS,
          dropTrailingZeros: true,
          isPercent: true,
          language: sentence.language,
        });
      });
    }
  }

  if (data.note.costs?.includes(data.name)) {
    const items: Array<string> | null = readCostItems(data.value);

    if (items && items.length > 1) {
      return composedValue((sentence: Translator): string => {
        return sentence.translateTemplate(
          ITEMS_AND_LAST,
          {
            items: formatList(items.slice(0, -1), sentence),
            last: items[items.length - 1] as string,
          },
          { setsValuesApart: true },
        );
      });
    }
  }

  const list: StateListType | undefined = data.note.recordNames?.[data.name];

  if (list) {
    // As its badge names it: "Operational", in English as stored.
    return recordNameInSentence(list, data.value);
  }

  return data.value;
}

/*
 * One of OneUptime's own status- or state-change notes, in the reader's
 * words; null for any other text. `text` is the whole root cause: plain
 * words for the monitor's hero, Markdown for View Cause - a value is kept
 * as handed in.
 */
export function wordStatusChangeNote(
  text: string,
  translator: Translator,
): string | null {
  const read: {
    note: StatusChangeNote;
    values: Record<string, string>;
  } | null = readStatusChangeNote(text);

  if (!read) {
    return null;
  }

  const said: string = read.note.said || read.note.written;
  const names: Array<string> = getStatusChangeNotePlaceholders(said);

  if (names.length === 0) {
    return translator.translateText(said) || said;
  }

  const values: Record<string, TemplateValue> = {};

  for (const name of names) {
    values[name] = toTemplateValue({
      note: read.note,
      name: name,
      value: read.values[name] || "",
      translator: translator,
    });
  }

  return translator.translateTemplate(said, values, {
    setsValuesApart: true,
  });
}

/*
 * A note with its values in place, as OneUptime writes it: for a writer
 * whose values are text already in place (a number, a name it escaped).
 */
export function writeStatusChangeNote(
  note: string,
  values?: Record<string, string> | undefined,
): string {
  return note.replace(PLACEHOLDER, (whole: string, name: string): string => {
    return values && values[name] !== undefined ? values[name] : whole;
  });
}
