import { PluralTemplate, translationKey } from "../Translator";
import AIInsightSeverity from "./AIInsightSeverity";
import AIInsightStatus from "./AIInsightStatus";
import AIRunStatus from "./AIRunStatus";
import ErrorClass from "../Telemetry/ErrorClass";
import RunbookStepType from "../Runbook/RunbookStepType";

/*
 * WHAT ASK AI'S TABLES AND SOURCES SAY, BESIDE THEIR DATA, IN EVERY
 * READER'S LANGUAGE (issues #7977, #7979 and #7980).
 *
 * A read that lists records leaves a table under the answer, and every
 * read leaves a chip under Sources that names what it read. Since #7394
 * the monitors table said its title and the line under it in the
 * reader's language ("Monitore (4)"), while every other table - who is on
 * call, the status pages, the SLOs, the logs and traces - kept the
 * server's English title ("On-call policies (3)", "Logs (25)") over
 * column names in German, and each chip under it said "Monitors (4
 * found)". These are their words, as sentences of Types/AI/AIActionWords
 * (which lists them among the sentences it trusts):
 *
 *   - a table's title - what it lists, and how many (a figure, written
 *     the reader's way) - and the line under it: what it holds, in what
 *     order, over which window;
 *   - the cells that are OneUptime's words, not data: a schedule's row in
 *     "who is on call", Yes and No, Public and Private, a timeline entry's
 *     kind, a container's or a probe's status;
 *   - a source's label: what a read looked at and how much it found.
 *
 * A name the project chose (a policy, a team, a status), a value the data
 * holds (a service, a host, a group-by attribute) and a number are values
 * inside the sentence, never translated. A window is two moments
 * (AIActionMoment): the server stores them as the ISO text it always
 * wrote, and the Dashboard writes them in the reader's language and time.
 * The English of each sentence is what the table or the chip stores - the
 * Markdown and PDF exports print it and the model reads it - so most of
 * them say exactly what the tools wrote before.
 *
 * The extractor reads this file for the Dashboard's keys; every sentence
 * is worded in every Dashboard language (AIActionCardsGuard).
 */

/*
 * ---------------------------------------------------------------------------
 * The record tables (#7977): on-call, status pages, maintenance, SLOs,
 * runbooks, teams, timelines, workflows, probes, AI, data and security.
 * ---------------------------------------------------------------------------
 */

export const AI_READ_RECORD_TABLE_TITLES: {
  onCallPolicies: string;
  onCallNowForPolicy: string;
  onCallNow: string;
  onCallPages: string;
  statusPages: string;
  statusPageAnnouncements: string;
  maintenanceEvent: string;
  scheduledMaintenance: string;
  slos: string;
  slosInStatus: string;
  runbook: string;
  runbooks: string;
  team: string;
  teams: string;
  incidentTimeline: string;
  alertTimeline: string;
  workflowRecentRuns: string;
  workflows: string;
  probes: string;
  incidentInvestigations: string;
  alertInvestigations: string;
  aiInsights: string;
  dataStores: string;
  dataSecurityIssues: string;
  principalCanReach: string;
  securityCases: string;
  threatIntel: string;
  entityActivity: string;
} = {
  onCallPolicies: translationKey("On-call policies ({{count}})"),
  // Who each rule of one policy pages now, by the policy's name.
  onCallNowForPolicy: translationKey("On-call now: {{policy}}"),
  onCallNow: translationKey("On-call now"),
  onCallPages: translationKey("On-call pages ({{count}})"),
  statusPages: translationKey("Status pages ({{count}})"),
  statusPageAnnouncements: translationKey(
    "Status page announcements ({{count}})",
  ),
  // One record is a maintenance event (#6817); {{number}} is "#7".
  maintenanceEvent: translationKey("Maintenance event {{number}}"),
  scheduledMaintenance: translationKey("Scheduled maintenance ({{count}})"),
  slos: translationKey("SLOs ({{count}})"),
  // {{status}} is the SLO status the list was filtered to, as the SLO list names it.
  slosInStatus: translationKey("{{status}} SLOs ({{count}})"),
  runbook: translationKey("Runbook: {{name}}"),
  runbooks: translationKey("Runbooks ({{count}})"),
  team: translationKey("Team: {{name}}"),
  teams: translationKey("Teams ({{count}})"),
  // {{incident}} and {{alert}} are the record's number ("#42"), or its ID.
  incidentTimeline: translationKey("Incident {{incident}} timeline"),
  alertTimeline: translationKey("Alert {{alert}} timeline"),
  workflowRecentRuns: translationKey('Workflow "{{name}}" — recent runs'),
  workflows: translationKey("Workflows ({{count}})"),
  probes: translationKey("Probes ({{count}})"),
  incidentInvestigations: translationKey(
    "AI investigations — Incident {{incident}}",
  ),
  alertInvestigations: translationKey("AI investigations — Alert {{alert}}"),
  aiInsights: translationKey("AI insights ({{count}})"),
  dataStores: translationKey("Data stores ({{count}})"),
  dataSecurityIssues: translationKey("Data security issues ({{count}})"),
  // {{principal}} is the user, role or key asked about, as named.
  principalCanReach: translationKey(
    'What "{{principal}}" can reach ({{count}})',
  ),
  securityCases: translationKey("Security cases ({{count}})"),
  // {{known}} of the {{count}} values looked up are on a threat feed.
  threatIntel: translationKey(
    "Threat intel ({{known}} of {{count}} known-bad)",
  ),
  entityActivity: translationKey("Entity activity"),
};

/*
 * The line under a record table's title, in about 40 English letters
 * where it can be: the line is cut beside Open on a phone. A count of
 * days or hours that is not a plural's is written short ("30d"), as the
 * tools always wrote it; a language writes its own short unit, or the
 * word for the count it nearly always has (Locales/ARABIC.md).
 */
export const AI_READ_RECORD_TABLE_LINES: {
  onCallPolicyRules: string;
  onCallPolicyArchived: string;
  onCallPagesInHours: string;
  onCallPagesInDays: string;
  announcementsShownInDays: string;
  maintenanceWindows: string;
  sloCompliance: string;
  runbooksShown: string;
  teamsShown: string;
  workflowArchived: string;
  workflowDisabled: string;
  workflowRunOutcomes: string;
  probesDisconnected: string;
  aiInsightsInDays: string;
} = {
  onCallPolicyRules: translationKey("Who each escalation rule pages, in order"),
  // ARCHIVED_ON_CALL_POLICY_NOTE (Toolbox/OnCallTools), which the model reads too.
  onCallPolicyArchived: translationKey(
    "This on-call policy is archived, so it pages no one: incidents and alerts that list it notify nobody through it. Unarchive it to use it again.",
  ),
  onCallPagesInHours: translationKey(
    "Policy executions and direct pages in the last {{hours}}h",
  ),
  onCallPagesInDays: translationKey(
    "Policy executions and direct pages in the last {{days}}d",
  ),
  announcementsShownInDays: translationKey("Shown in the last {{days}}d"),
  maintenanceWindows: translationKey(
    "Windows overlapping the last {{past}}d and next {{upcoming}}d",
  ),
  sloCompliance: translationKey(
    "Compliance columns are as of each SLO's last evaluation.",
  ),
  // A page of a longer list: {{total}} is always more than {{shown}}.
  runbooksShown: translationKey("Showing {{shown}} of {{total}} runbooks"),
  teamsShown: translationKey("Showing {{shown}} of {{total}} teams"),
  // ARCHIVED_WORKFLOW_NOTE (Toolbox/WorkflowProbeTools), which the model reads too.
  workflowArchived: translationKey(
    "This workflow is archived, so it does not run from any trigger. Unarchive it to run it again.",
  ),
  workflowDisabled: translationKey("This workflow is disabled."),
  workflowRunOutcomes: translationKey(
    "Run outcomes from the last {{count}} runs across these workflows",
  ),
  probesDisconnected: translationKey(
    "Disconnected = no heartbeat in the last {{minutes}} minutes",
  ),
  aiInsightsInDays: translationKey(
    "Preventive findings seen in the last {{days}}d",
  ),
};

export const AI_READ_RECORD_TABLE_PLURAL_SENTENCES: {
  onCallNowSchedules: PluralTemplate;
  entityActivityHours: PluralTemplate;
} = {
  // Who is on call now, over every schedule: how many schedules it lists.
  onCallNowSchedules: {
    one: translationKey("On-call now ({{count}} schedule)"),
    other: translationKey("On-call now ({{count}} schedules)"),
  },
  // The window an entity's activity was read over.
  entityActivityHours: {
    one: translationKey("The last {{count}} hour"),
    other: translationKey("The last {{count}} hours"),
  },
};

/*
 * A record table's cells that are OneUptime's words: who an on-call
 * schedule or rule pages now, a page's trigger, a timeline entry. A name
 * inside one is a value, as named.
 */
export const AI_READ_RECORD_TABLE_CELLS: {
  schedule: string;
  ruleDirectResponder: string;
  ruleTeam: string;
  ruleNextInRotation: string;
  ruleSchedule: string;
  allMembersOfTeam: string;
  personAfterInRotation: string;
  scheduleNotAccessible: string;
  noEscalationRules: string;
  directPage: string;
  triggeredByIncident: string;
  triggeredByIncidentUnnumbered: string;
  triggeredByAlert: string;
  triggeredByUser: string;
  noNotificationsRecorded: string;
  rollingWindow: string;
  stateChangedTo: string;
  stateChangedToWithRootCause: string;
} = {
  // {{name}}, {{team}} and {{schedule}} are names as the project gave them.
  schedule: translationKey("Schedule '{{name}}'"),
  // {{order}} is the rule's place in the policy's order, a number.
  ruleDirectResponder: translationKey("Rule {{order}} — direct responder"),
  ruleTeam: translationKey("Rule {{order}} — team '{{team}}'"),
  ruleNextInRotation: translationKey(
    "Rule {{order}} — next in rotation of schedule '{{schedule}}'",
  ),
  ruleSchedule: translationKey("Rule {{order}} — schedule '{{schedule}}'"),
  allMembersOfTeam: translationKey("All members of '{{team}}'"),
  // Who a rule that pages the next in rotation pages: never {{name}}, on call now.
  personAfterInRotation: translationKey(
    "The person after {{name}} in the rotation",
  ),
  scheduleNotAccessible: translationKey(
    "Schedule not accessible (no read access or deleted)",
  ),
  noEscalationRules: translationKey("No escalation rules configured"),
  // A page with no on-call policy behind it (DIRECT_PAGE_POLICY_LABEL).
  directPage: translationKey("Direct page (no on-call policy)"),
  // {{number}} is "#42"; {{title}} the incident's or alert's own title.
  triggeredByIncident: translationKey("Incident {{number}}: {{title}}"),
  triggeredByIncidentUnnumbered: translationKey("Incident: {{title}}"),
  triggeredByAlert: translationKey("Alert: {{title}}"),
  triggeredByUser: translationKey("Manually triggered by {{name}}"),
  noNotificationsRecorded: translationKey(
    "No individual notifications recorded",
  ),
  // An SLO's rolling window, as the SLO list writes it: "Rolling 30d".
  rollingWindow: translationKey("Rolling {{days}}d"),
  // {{state}} is the state as the project named it; {{rootCause}} as written.
  stateChangedTo: translationKey("State changed to {{state}}"),
  stateChangedToWithRootCause: translationKey(
    "State changed to {{state}}. Root cause: {{rootCause}}",
  ),
};

/*
 * A record table's cells that are a word of OneUptime's alone, beside the
 * words the read cards say already (Yes, No, Public, Private, an SLO's
 * status): a timeline entry's kind, a team member's standing, a threat
 * feed's verdict.
 */
export const AI_READ_RECORD_TABLE_TERMS: {
  stateChange: string;
  internalNote: string;
  publicNote: string;
  feed: string;
  teamMember: string;
  invitedNotAccepted: string;
  knownBad: string;
  noMatch: string;
} = {
  stateChange: translationKey("State change"),
  internalNote: translationKey("Internal note"),
  publicNote: translationKey("Public note"),
  feed: translationKey("Feed"),
  teamMember: translationKey("Member"),
  invitedNotAccepted: translationKey("Invited (not yet accepted)"),
  knownBad: translationKey("Known-bad"),
  noMatch: translationKey("No match"),
};

/*
 * ---------------------------------------------------------------------------
 * The telemetry tables (#7979): logs, traces, RUM, profiles, containers
 * and security events. Their lines name the window they read.
 * ---------------------------------------------------------------------------
 */

export const AI_READ_TELEMETRY_TABLE_TITLES: {
  logs: string;
  traceAnalytics: string;
  rumApplications: string;
  rumWebVitals: string;
  whereTheTimeGoes: string;
  whatGotSlower: string;
  containersOfHost: string;
  securityEvents: string;
  securityEventsByClass: string;
} = {
  logs: translationKey("Logs ({{count}})"),
  // {{groupBy}} is what the spans were grouped by, as asked: "service", "http.route".
  traceAnalytics: translationKey("Trace analytics by {{groupBy}}"),
  rumApplications: translationKey("RUM applications"),
  rumWebVitals: translationKey("RUM web vitals"),
  whereTheTimeGoes: translationKey("Where the time goes"),
  whatGotSlower: translationKey("What got slower"),
  // {{host}} is the host's name, as it reports it.
  containersOfHost: translationKey("Containers of {{host}}"),
  securityEvents: translationKey("Security Events ({{count}})"),
  securityEventsByClass: translationKey(
    "Security events by class and severity",
  ),
};

/*
 * A window: {{start}} and {{end}} are moments, which the Dashboard writes
 * in the reader's language and time ("14. Sep., 17:49 – 18:49"). The
 * window alone has no words of its own, so it reads the reader's way.
 */
export const AI_READ_WINDOW: string = "{{start}} – {{end}}";

export const AI_READ_TELEMETRY_TABLE_LINES: {
  rankedBy: string;
  averages: string;
  profileKindWindow: string;
  profileWindows: string;
  basedOnRecentEvents: string;
} = {
  // {{metric}} is the duration figure the rows are ranked by: "p95", "avg".
  rankedBy: translationKey("Ranked by {{metric}} · {{start}} – {{end}}"),
  averages: translationKey("Averages · {{start}} – {{end}}"),
  // {{kind}} is what the profile measures (AI_READ_PROFILE_KINDS).
  profileKindWindow: translationKey("{{kind}} · {{start}} to {{end}}"),
  // Two windows, before and after: four moments.
  profileWindows: translationKey(
    "{{beforeStart}} to {{beforeEnd}} → {{afterStart}} to {{afterEnd}}",
  ),
  // The summary read only the newest events: its counts are a floor.
  basedOnRecentEvents: translationKey(
    "{{start}} – {{end}} (based on the most recent {{count}} events — counts are a floor)",
  ),
};

/*
 * What a continuous profile measures, as the profile tools name it in a
 * sentence (Utils/Profiles/ProfileTypes' getProfileCategoryNoun).
 */
export const AI_READ_PROFILE_KINDS: ReadonlyArray<string> = [
  translationKey("CPU time"),
  translationKey("wall time"),
  translationKey("memory in use"),
  translationKey("memory allocations"),
  translationKey("time waiting on locks"),
  translationKey("goroutines"),
  translationKey("samples"),
];

// A container's status, as the containers table says it (ContainerTools).
export const AI_READ_CONTAINER_STATUSES: {
  stoppedReporting: string;
  startedInWindow: string;
  reporting: string;
} = {
  stoppedReporting: translationKey("Stopped reporting"),
  startedInWindow: translationKey("Started in this window"),
  reporting: translationKey("Reporting"),
};

// A web vital's rating, as the RUM web vitals table says it (RumTools).
export const AI_READ_WEB_VITAL_RATINGS: {
  good: string;
  needsImprovement: string;
  poor: string;
} = {
  good: translationKey("Good"),
  needsImprovement: translationKey("Needs improvement"),
  poor: translationKey("Poor"),
};

// A probe's status, as the probes table says it (WorkflowProbeTools).
export const AI_READ_PROBE_STATUSES: {
  connected: string;
  disconnected: string;
} = {
  connected: translationKey("Connected"),
  disconnected: translationKey("Disconnected"),
};

/*
 * ---------------------------------------------------------------------------
 * The chips under Sources (#7980): what each read looked at, and how much
 * it found. Each says what the tool's label always said, so an answer's
 * history reads the same to the model.
 * ---------------------------------------------------------------------------
 */

export const AI_READ_CITATIONS: {
  monitor: string;
  monitors: string;
  monitorsPaged: string;
  monitorsWithProblems: string;
  monitorsWithProblemsPaged: string;
  monitorsInStatus: string;
  monitorsInStatusPaged: string;
  incidents: string;
  incidentsInHours: string;
  activeIncidents: string;
  activeIncidentsInHours: string;
  resolvedIncidents: string;
  resolvedIncidentsInHours: string;
  incidentSearch: string;
  incident: string;
  activeAlerts: string;
  activeAlertsPaged: string;
  activeAlertsInHours: string;
  activeAlertsInHoursPaged: string;
  alertsInHours: string;
  alertsInHoursPaged: string;
  resolvedAlertsInHours: string;
  resolvedAlertsInHoursPaged: string;
  alertSearch: string;
  alert: string;
  topExceptions: string;
  onCallPolicies: string;
  onCallPoliciesPaged: string;
  onCallPolicy: string;
  onCallNowForPolicy: string;
  onCallNow: string;
  onCallNowForSchedule: string;
  onCallPagesInHours: string;
  onCallPagesInHoursPaged: string;
  onCallPagesInDays: string;
  onCallPagesInDaysPaged: string;
  statusPages: string;
  statusPage: string;
  statusPageAnnouncements: string;
  maintenanceEvent: string;
  scheduledMaintenance: string;
  slos: string;
  slosInStatus: string;
  slo: string;
  runbooks: string;
  runbooksPaged: string;
  teams: string;
  teamsPaged: string;
  incidentTimeline: string;
  alertTimeline: string;
  workflows: string;
  workflowsPaged: string;
  probes: string;
  probesNone: string;
  aiInsights: string;
  logs: string;
  logVolume: string;
  traceAnalytics: string;
  trace: string;
  traceWithMoreSpans: string;
  rumApplications: string;
  rumWebVitals: string;
  containersOfHost: string;
  securityEvents: string;
  securityEventSummary: string;
  securityEventSummarySampled: string;
} = {
  // {{name}} is the monitor's name, or its ID.
  monitor: translationKey("Monitor {{name}} + status timeline"),
  monitors: translationKey("Monitors ({{count}} found)"),
  // One page of a longer list: {{count}} of {{total}}.
  monitorsPaged: translationKey("Monitors ({{count}} of {{total}})"),
  monitorsWithProblems: translationKey(
    "Monitors with problems ({{count}} found)",
  ),
  monitorsWithProblemsPaged: translationKey(
    "Monitors with problems ({{count}} of {{total}})",
  ),
  // {{status}} is a status the project named, as named.
  monitorsInStatus: translationKey(
    'Monitors in status "{{status}}" ({{count}} found)',
  ),
  monitorsInStatusPaged: translationKey(
    'Monitors in status "{{status}}" ({{count}} of {{total}})',
  ),
  incidents: translationKey("Incidents ({{count}} total)"),
  // {{hours}}: how far back the list reaches.
  incidentsInHours: translationKey(
    "Incidents, last {{hours}}h ({{count}} total)",
  ),
  activeIncidents: translationKey("Active incidents ({{count}} total)"),
  activeIncidentsInHours: translationKey(
    "Active incidents, last {{hours}}h ({{count}} total)",
  ),
  resolvedIncidents: translationKey("Resolved incidents ({{count}} total)"),
  resolvedIncidentsInHours: translationKey(
    "Resolved incidents, last {{hours}}h ({{count}} total)",
  ),
  // {{query}} is the text searched for, as typed.
  incidentSearch: translationKey(
    'Incident search "{{query}}" ({{count}} found)',
  ),
  // {{incident}} is "#42", or the incident's ID.
  incident: translationKey("Incident {{incident}}"),
  activeAlerts: translationKey("Active alerts ({{count}} found)"),
  activeAlertsPaged: translationKey("Active alerts ({{count}} of {{total}})"),
  activeAlertsInHours: translationKey(
    "Active alerts, last {{hours}}h ({{count}} found)",
  ),
  activeAlertsInHoursPaged: translationKey(
    "Active alerts, last {{hours}}h ({{count}} of {{total}})",
  ),
  alertsInHours: translationKey("Alerts, last {{hours}}h ({{count}} found)"),
  alertsInHoursPaged: translationKey(
    "Alerts, last {{hours}}h ({{count}} of {{total}})",
  ),
  resolvedAlertsInHours: translationKey(
    "Resolved alerts, last {{hours}}h ({{count}} found)",
  ),
  resolvedAlertsInHoursPaged: translationKey(
    "Resolved alerts, last {{hours}}h ({{count}} of {{total}})",
  ),
  // {{query}} is the text searched for, as typed.
  alertSearch: translationKey('Alert search "{{query}}" ({{count}} found)'),
  alert: translationKey("Alert {{alert}}"),
  topExceptions: translationKey(
    "Top exceptions, last {{hours}}h ({{count}} found)",
  ),
  onCallPolicies: translationKey("On-call policies ({{count}} found)"),
  onCallPoliciesPaged: translationKey(
    "On-call policies ({{count}} of {{total}})",
  ),
  // {{policy}} and {{schedule}} are names, or IDs.
  onCallPolicy: translationKey("On-call policy '{{policy}}'"),
  onCallNowForPolicy: translationKey(
    "On-call now for '{{policy}}' ({{responders}})",
  ),
  // {{responders}} is how many people it pages (AI_READ_CITATION_PLURALS.responders).
  onCallNow: translationKey("On-call now ({{responders}})"),
  onCallNowForSchedule: translationKey("On-call now: '{{schedule}}'"),
  onCallPagesInHours: translationKey(
    "On-call pages, last {{hours}}h ({{count}} found)",
  ),
  onCallPagesInHoursPaged: translationKey(
    "On-call pages, last {{hours}}h ({{count}} of {{total}})",
  ),
  onCallPagesInDays: translationKey(
    "On-call pages, last {{days}}d ({{count}} found)",
  ),
  onCallPagesInDaysPaged: translationKey(
    "On-call pages, last {{days}}d ({{count}} of {{total}})",
  ),
  statusPages: translationKey("Status pages ({{count}} total)"),
  // {{name}} is the status page's name, or its ID.
  statusPage: translationKey('Status page "{{name}}"'),
  statusPageAnnouncements: translationKey(
    "Status page announcements, last {{days}}d ({{count}} total)",
  ),
  maintenanceEvent: translationKey("Maintenance event {{number}}"),
  scheduledMaintenance: translationKey(
    "Scheduled maintenance, -{{past}}d/+{{upcoming}}d ({{count}} found)",
  ),
  slos: translationKey("SLOs ({{count}} found)"),
  slosInStatus: translationKey("{{status}} SLOs ({{count}} found)"),
  slo: translationKey("SLO {{name}}"),
  runbooks: translationKey("Runbooks ({{count}} found)"),
  runbooksPaged: translationKey("Runbooks ({{count}} of {{total}})"),
  teams: translationKey("Teams ({{count}} found)"),
  teamsPaged: translationKey("Teams ({{count}} of {{total}})"),
  // {{entries}} is how many entries it read (AI_READ_CITATION_PLURALS.timelineEntries).
  incidentTimeline: translationKey(
    "Incident {{incident}} timeline ({{entries}})",
  ),
  alertTimeline: translationKey("Alert {{alert}} timeline ({{entries}})"),
  workflows: translationKey("Workflows ({{count}} found)"),
  workflowsPaged: translationKey("Workflows (showing {{count}} of {{total}})"),
  probes: translationKey(
    "Probes ({{count}} found, {{disconnected}} disconnected)",
  ),
  probesNone: translationKey("Probes (0 found)"),
  aiInsights: translationKey("AI insights, last {{days}}d ({{count}} found)"),
  // A window, as AI_READ_WINDOW.
  logs: translationKey("Logs {{start}} – {{end}} ({{count}} shown)"),
  logVolume: translationKey("Log volume by severity, {{start}} – {{end}}"),
  traceAnalytics: translationKey(
    "Trace analytics by {{groupBy}} ({{metric}}), {{start}} – {{end}}",
  ),
  // {{traceId}} as the trace carries it.
  trace: translationKey("Trace {{traceId}} ({{count}} spans)"),
  traceWithMoreSpans: translationKey("Trace {{traceId}} ({{count}}+ spans)"),
  rumApplications: translationKey("RUM applications ({{count}} found)"),
  rumWebVitals: translationKey("RUM web vitals, {{start}} – {{end}}"),
  containersOfHost: translationKey(
    "Containers of {{host}}, {{start}} – {{end}}",
  ),
  securityEvents: translationKey(
    "Security events {{start}} – {{end}} ({{count}} shown)",
  ),
  securityEventSummary: translationKey(
    "Security event summary {{start}} – {{end}}",
  ),
  // The summary read only the newest {{count}} events.
  securityEventSummarySampled: translationKey(
    "Security event summary {{start}} – {{end}} (based on the most recent {{count}} events — counts are a floor)",
  ),
};

export const AI_READ_CITATION_PLURALS: {
  team: PluralTemplate;
  runbook: PluralTemplate;
  workflow: PluralTemplate;
  responders: PluralTemplate;
  timelineEntries: PluralTemplate;
} = {
  // {{name}} is the team's name, as named.
  team: {
    one: translationKey('Team "{{name}}" ({{count}} member)'),
    other: translationKey('Team "{{name}}" ({{count}} members)'),
  },
  runbook: {
    one: translationKey('Runbook "{{name}}" ({{count}} step)'),
    other: translationKey('Runbook "{{name}}" ({{count}} steps)'),
  },
  workflow: {
    one: translationKey('Workflow "{{name}}" ({{count}} recent run)'),
    other: translationKey('Workflow "{{name}}" ({{count}} recent runs)'),
  },
  // How many people a policy or the project's schedules page now.
  responders: {
    one: translationKey("{{count}} responder"),
    other: translationKey("{{count}} responders"),
  },
  timelineEntries: {
    one: translationKey("{{count}} entry"),
    other: translationKey("{{count}} entries"),
  },
};

/*
 * ---------------------------------------------------------------------------
 * The other widgets under an answer (#8312): the lists of incidents, alerts
 * and exceptions, the charts and the trace waterfall say their title and
 * line as a table does. A chart's series and a list's items are data.
 * ---------------------------------------------------------------------------
 */

export const AI_READ_WIDGET_TITLES: {
  incident: string;
  alert: string;
  incidents: string;
  activeIncidents: string;
  resolvedIncidents: string;
  incidentsMatching: string;
  alerts: string;
  alertsMatching: string;
  topExceptions: string;
  logVolume: string;
  metric: string;
  metricBy: string;
  metricVsExpected: string;
  traceWaterfall: string;
  traceWaterfallMore: string;
} = {
  // One record whose number could not be read: its kind alone.
  incident: translationKey("Incident"),
  alert: translationKey("Alert"),
  incidents: translationKey("Incidents ({{count}})"),
  activeIncidents: translationKey("Active incidents ({{count}})"),
  resolvedIncidents: translationKey("Resolved incidents ({{count}})"),
  // {{query}} is the text searched for, as typed.
  incidentsMatching: translationKey(
    'Incidents matching "{{query}}" ({{count}})',
  ),
  alerts: translationKey("Alerts ({{count}})"),
  // {{query}} is the text searched for, as typed.
  alertsMatching: translationKey('Alerts matching "{{query}}" ({{count}})'),
  topExceptions: translationKey("Top exceptions ({{count}})"),
  logVolume: translationKey("Log volume by severity"),
  /*
   * {{aggregation}} is how the points were aggregated, as the query names
   * it ("Avg", "P95"); {{metric}} the metric's name; {{groupBy}} the
   * attributes the series differ in, as named.
   */
  metric: translationKey("{{aggregation}} of {{metric}}"),
  metricBy: translationKey("{{aggregation}} of {{metric}} by {{groupBy}}"),
  metricVsExpected: translationKey("{{metric}} vs expected range"),
  traceWaterfall: translationKey("Trace waterfall ({{count}} spans)"),
  // More spans than the read could hold: {{count}} is a floor.
  traceWaterfallMore: translationKey("Trace waterfall ({{count}}+ spans)"),
};

export const AI_READ_WIDGET_LINES: {
  createdInHours: string;
  regardlessOfCreation: string;
  currentlyUnresolvedAlerts: string;
  exceptionsInHours: string;
  traceDuration: string;
  baselineWindow: string;
} = {
  createdInHours: translationKey("Created in the last {{hours}}h"),
  regardlessOfCreation: translationKey("Regardless of when they were created"),
  currentlyUnresolvedAlerts: translationKey("Currently unresolved alerts"),
  exceptionsInHours: translationKey("Last {{hours}}h, by occurrence count"),
  // {{duration}} is how long the trace took, in milliseconds.
  traceDuration: translationKey("{{duration}} ms total"),
  /*
   * The band a metric is expected in, for this hour of the week: {{sigma}}
   * standard deviations wide, learned over {{days}} days; then the window.
   */
  baselineWindow: translationKey(
    "Hour-of-week baseline (±{{sigma}}σ, {{days}}-day window), {{start}} – {{end}}",
  ),
};

/*
 * ---------------------------------------------------------------------------
 * The cells of the record tables that are OneUptime's words, beside those
 * above (#8313): an escalation chain, a page's and an AI run's status, an
 * AI insight's, a data store's and a runbook step's words.
 * ---------------------------------------------------------------------------
 */

export const AI_READ_ESCALATION_CHAIN: {
  rule: string;
  ruleEscalates: string;
  users: string;
  teams: string;
  schedules: string;
  nextInRotation: string;
  notifiedPerson: string;
  notifiedPersonAcknowledged: string;
} = {
  /*
   * One rule of a policy's escalation chain: {{order}} is its place in the
   * chain, {{name}} its name, {{targets}} whom it pages (users, teams and
   * schedules below, as a list), {{minutes}} when it escalates.
   */
  rule: translationKey("{{order}}. {{name}}: {{targets}}"),
  ruleEscalates: translationKey(
    "{{order}}. {{name}}: {{targets}} (escalates after {{minutes}}m)",
  ),
  // {{names}} are the users, teams or schedules, as named, in a list.
  users: translationKey("users [{{names}}]"),
  teams: translationKey("teams [{{names}}]"),
  schedules: translationKey("schedules [{{names}}]"),
  // A rule that pages the next person in a schedule's rotation.
  nextInRotation: translationKey(
    "{{name}} (next in rotation: the person after whoever is on call, passing over anyone away)",
  ),
  /*
   * Who a page notified, one by one: {{name}} the person, {{status}} how
   * their notification went (AI_READ_NOTIFICATION_STATUSES).
   */
  notifiedPerson: translationKey("{{name}}: {{status}}"),
  notifiedPersonAcknowledged: translationKey(
    "{{name}}: {{status}} (acknowledged)",
  ),
};

export const AI_READ_ESCALATION_CHAIN_TERMS: {
  unnamedRule: string;
  noTargets: string;
} = {
  unnamedRule: translationKey("Unnamed rule"),
  // A rule that pages nobody: in the middle of a sentence.
  noTargets: translationKey("no targets"),
};

// An on-call page's status (OnCallDutyPolicyStatus), as the pages list says it.
export const AI_READ_ON_CALL_PAGE_STATUSES: ReadonlyArray<string> = [
  translationKey("Waiting"),
  translationKey("Scheduled"),
  translationKey("Started"),
  translationKey("Executing"),
  translationKey("Execution Completed"),
  translationKey("Execution Completed - No One Notified"),
  translationKey("Error"),
];

/*
 * How a person's notification went (UserNotificationExecutionStatus), as
 * people read it: one they escalated is stored "Passed On", the Escalate
 * action's first name, and reads "Escalated", as the logs and their filters
 * say it (getOnCallPageStatusLabel). One merged into their open page from
 * another policy's run is "Already Paged" (OnCallPageMerge).
 */
export const AI_READ_NOTIFICATION_STATUSES: ReadonlyArray<string> = [
  translationKey("Scheduled"),
  translationKey("Started"),
  translationKey("Executing"),
  translationKey("Completed"),
  translationKey("Error"),
  translationKey("Escalated"),
  translationKey("Already Paged"),
];

/*
 * An AI investigation's status (AIRunStatus), as the incident's and the
 * alert's AI pages say it: an error is "Failed", a run the sweeper gave up
 * on "Timed out".
 */
export const AI_READ_AI_RUN_STATUSES: Record<AIRunStatus, string> = {
  [AIRunStatus.Queued]: translationKey("Queued"),
  [AIRunStatus.Running]: translationKey("Running"),
  [AIRunStatus.WaitingForApproval]: translationKey("Waiting for approval"),
  [AIRunStatus.Completed]: translationKey("Completed"),
  [AIRunStatus.NoFixFound]: translationKey("No fix found"),
  [AIRunStatus.Error]: translationKey("Failed"),
  [AIRunStatus.Cancelled]: translationKey("Cancelled"),
  [AIRunStatus.Stale]: translationKey("Timed out"),
};

/*
 * An AI insight's status and severity, as the insights inbox and an
 * insight's page say them (Dashboard's Components/AIInsights/
 * InsightPresentation reads these): "ActionRequired" is "Needs Attention".
 */
export const AI_INSIGHT_STATUS_LABELS: Record<AIInsightStatus, string> = {
  [AIInsightStatus.Detected]: translationKey("Detected"),
  [AIInsightStatus.ActionRequired]: translationKey("Needs Attention"),
  /*
   * A fix task is attached. Where it stands - in progress, its pull request
   * open, failed - is the task's to say, never this status: it is set when
   * the task starts, before any pull request.
   */
  [AIInsightStatus.FixOpened]: translationKey("Fix task"),
  [AIInsightStatus.Resolved]: translationKey("Resolved"),
  [AIInsightStatus.Dismissed]: translationKey("Dismissed"),
};

export const AI_INSIGHT_SEVERITY_LABELS: Record<AIInsightSeverity, string> = {
  [AIInsightSeverity.High]: translationKey("High"),
  [AIInsightSeverity.Medium]: translationKey("Medium"),
  [AIInsightSeverity.Low]: translationKey("Low"),
};

/*
 * An insight's AI triage (Types/Telemetry/ErrorClass), as the exceptions
 * pages name it: "unknown" is "Unclassified" - triage could not decide.
 */
export const AI_READ_TRIAGE_LABELS: Record<ErrorClass, string> = {
  [ErrorClass.CodeFault]: translationKey("Code fault"),
  [ErrorClass.UserError]: translationKey("User error"),
  [ErrorClass.ExpectedDenial]: translationKey("Expected denial"),
  [ErrorClass.Infrastructure]: translationKey("Infrastructure"),
  [ErrorClass.Unknown]: translationKey("Unclassified"),
};

// An open data security issue's status, by its meaning key (Types/MeaningKeys).
export const AI_READ_OPEN_STATUS_TERM: string = translationKey("Open (status)");

/*
 * Data Security's words in its tables, as its pages' pills say them: a
 * store's sensitivity and exposure, an issue's severity and status, an
 * access level, and the kinds of store that are OneUptime's own telemetry.
 * A cloud's kind of store ("AWS S3 Bucket") is a product's name: data.
 */
export const AI_READ_DATA_SECURITY_TERMS: ReadonlyArray<string> = [
  // DataSensitivity
  translationKey("Restricted"),
  translationKey("Confidential"),
  translationKey("Internal"),
  translationKey("Public"),
  // DataStoreExposure
  translationKey("Other accounts"),
  translationKey("Internet reachable"),
  translationKey("Private"),
  translationKey("Unknown"),
  // SecuritySeverity
  translationKey("Critical"),
  translationKey("High"),
  translationKey("Medium"),
  translationKey("Low"),
  /*
   * DataSecurityIssueStatus. "Open" alone is every Open button's verb in
   * every language ("Öffnen"), so an open issue's status is its meaning key
   * (Types/MeaningKeys), as the Data Security pages word it: "Open" in
   * English and the stored row, "Offen" in German (#8512).
   */
  AI_READ_OPEN_STATUS_TERM,
  translationKey("Resolved"),
  translationKey("Accepted"),
  translationKey("Not an issue"),
  // DataStoreAccessLevel
  translationKey("Read"),
  translationKey("Write"),
  translationKey("Admin"),
  // The telemetry a project's own OneUptime holds (DataStoreKind)
  translationKey("Logs"),
  translationKey("Traces"),
  translationKey("Exceptions"),
  translationKey("Session Replays"),
  translationKey("AI Conversations"),
];

// A security case's AI verdict (SecurityCaseAiVerdict), as its page says it.
export const AI_READ_SECURITY_VERDICTS: ReadonlyArray<string> = [
  translationKey("Likely Malicious"),
  translationKey("Likely Benign"),
  translationKey("Likely False Positive"),
  translationKey("Inconclusive"),
];

// A runbook step's type, as the runbook's Steps page names it.
export const AI_READ_RUNBOOK_STEP_TYPES: Record<RunbookStepType, string> = {
  [RunbookStepType.Manual]: translationKey("Manual checklist step"),
  [RunbookStepType.JavaScript]: translationKey("JavaScript"),
  [RunbookStepType.HttpRequest]: translationKey("HTTP request"),
  [RunbookStepType.Bash]: translationKey("Bash script"),
  [RunbookStepType.AI]: translationKey("AI step"),
  [RunbookStepType.SSH]: translationKey("SSH script"),
  // A kubectl script: the type keeps its stored name, Kubernetes.
  [RunbookStepType.Kubernetes]: translationKey("kubectl script"),
  [RunbookStepType.Kubectl]: translationKey("kubectl command"),
  [RunbookStepType.ResourceCommand]: translationKey("Resource command"),
};

/*
 * What a runbook step does, as its row says it: the script, the address,
 * the prompt and the command are data, as written.
 */
export const AI_READ_RUNBOOK_STEP_INSTRUCTIONS: {
  manual: string;
  javaScript: string;
  bash: string;
  httpRequest: string;
  httpRequestWithBody: string;
  ai: string;
  sshCommand: string;
  sshScript: string;
  kubernetesAction: string;
  kubernetesActionWithReplicas: string;
  kubectl: string;
} = {
  manual: translationKey(
    "Manual step — a responder performs this by hand (see the step title/description).",
  ),
  javaScript: translationKey("Runs JavaScript on a runner: {{script}}"),
  bash: translationKey("Runs bash on a runner: {{script}}"),
  // {{method}} is the HTTP method ("GET"), {{url}} the address.
  httpRequest: translationKey("HTTP {{method}} {{url}}"),
  httpRequestWithBody: translationKey(
    "HTTP {{method}} {{url}} with body: {{body}}",
  ),
  ai: translationKey("AI step with prompt: {{prompt}}"),
  sshCommand: translationKey("Runs over SSH: {{command}}"),
  // {{target}} is user@host, or the host.
  sshScript: translationKey(
    "Runs a bash script over SSH on {{target}}: {{script}}",
  ),
  // A step written before kubectl scripts: restart or scale one workload.
  kubernetesAction: translationKey(
    "Kubernetes {{action}} on {{workloadKind}} {{namespace}}/{{workloadName}}",
  ),
  kubernetesActionWithReplicas: translationKey(
    "Kubernetes {{action}} on {{workloadKind}} {{namespace}}/{{workloadName}} (replicas: {{replicas}})",
  ),
  kubectl: translationKey("Runs kubectl commands on a runner: {{script}}"),
};

// A RUM application's client type, as its row stores it ("browser").
export const AI_READ_RUM_CLIENT_TYPES: { browser: string; mobile: string } = {
  browser: translationKey("Browser"),
  mobile: translationKey("Mobile"),
};

/*
 * ---------------------------------------------------------------------------
 * The chips of every other tool (#8311): what a docs, code, cloud, metric,
 * profile or context read looked at, what a write did, and a read that
 * found nothing to read. Each says what its tool's label always said, but
 * three, which spoke the code's notation to people: a metric's baseline
 * ("baseline_anomaly(...)"), an output's page and a profile's window.
 * ---------------------------------------------------------------------------
 */

export const AI_TOOL_CITATIONS: {
  // Docs and the Dashboard's pages (DocsTools)
  docsSearch: string;
  docsPage: string;
  docsSection: string;
  dashboardPageSearch: string;
  dashboardPage: string;
  // Code (CodeTools, CodeWriteTools)
  codeRepositories: string;
  codeLocationNoStackTrace: string;
  codeLocationNoRepository: string;
  codeLocation: string;
  codeSearch: string;
  codeFileEmpty: string;
  codeFileLines: string;
  commit: string;
  pullRequest: string;
  mergeRequest: string;
  // Cloud, devices and context (CloudTools, TransceiverTools, ContextTools)
  cloudResourceInventory: string;
  cloudResourceInventoryUnnamed: string;
  cloudAccounts: string;
  transceivers: string;
  transceiversUnnamed: string;
  telemetryServices: string;
  metricNames: string;
  metricAttributeKeys: string;
  metricAttributeKeysOf: string;
  traceAttributeKeys: string;
  logAttributeKeys: string;
  exceptionAttributeKeys: string;
  profileAttributeKeys: string;
  securityEventAttributeKeys: string;
  // Metrics and an infrastructure resource's telemetry (MetricTools, ResourceTools)
  metric: string;
  metricBy: string;
  metricBaseline: string;
  metricBaselineOfEntity: string;
  resourceMetrics: string;
  resourceMetricsBy: string;
  resourceLogs: string;
  resourceTraces: string;
  // Profiles (ProfileTools)
  profileHotspots: string;
  profileComparison: string;
  profileOfFunction: string;
  // Data observability, changes and health
  dataTable: string;
  dataTables: string;
  lineageOf: string;
  lineageOfTables: string;
  changeNotFound: string;
  change: string;
  changeWithCommits: string;
  recentChanges: string;
  setupHealth: string;
  whoIsTold: string;
  // What a write did (the write and setup tools)
  createdIncident: string;
  linkedIncident: string;
  incidentInState: string;
  createdAlert: string;
  linkedAlert: string;
  alertInState: string;
  incidentNote: string;
  alertNote: string;
  pagedPolicyForIncident: string;
  startedRunbook: string;
  startedRunbookById: string;
  incidentStatusUpdate: string;
  incidentSeverityChanged: string;
  setUpMonitor: string;
  createdOnCallPolicy: string;
  publishedStatusPage: string;
  addedMonitorsToStatusPage: string;
  addedToOnCallPolicy: string;
  savedHowToReachMe: string;
  invitedPeople: string;
  workflowComponents: string;
  workflowDraft: string;
  createdWorkflow: string;
  updatedWorkflow: string;
  // AI investigations (AIMetaTools)
  aiInvestigationInvalidArguments: string;
  aiInvestigationSubjectNotFound: string;
  aiInvestigationNone: string;
  aiInvestigationRuns: string;
  aiInsightsInvalidStatus: string;
  investigationInProgress: string;
  recentInvestigationExists: string;
  investigationNotEnqueued: string;
  investigationQueued: string;
  // Security cases and data security (SecurityCaseTools, DataSecurityTools)
  openSecurityCases: string;
  openSecurityCasesAbout: string;
  closedSecurityCases: string;
  closedSecurityCasesAbout: string;
  allSecurityCases: string;
  allSecurityCasesAbout: string;
  securityCase: string;
  threatIntelLookup: string;
  securityActivity: string;
  securityPlaybooksOn: string;
  securityCaseNote: string;
  securityCasePlaybook: string;
  dataStores: string;
  dataStoresFiltered: string;
  dataStoreSensitivityOrAbove: string;
  dataStoreHolding: string;
  dataStoreNamedLike: string;
  dataStore: string;
  openDataSecurityIssues: string;
  acceptedDataSecurityIssues: string;
  resolvedDataSecurityIssues: string;
  notAnIssueDataSecurityIssues: string;
  allDataSecurityIssues: string;
  openDataSecurityIssuesOfSeverity: string;
  acceptedDataSecurityIssuesOfSeverity: string;
  resolvedDataSecurityIssuesOfSeverity: string;
  notAnIssueDataSecurityIssuesOfSeverity: string;
  allDataSecurityIssuesOfSeverity: string;
  dataSecurityIssue: string;
  whoCanReachDataStore: string;
  dataStoresPrincipalCanReach: string;
  // A read that found nothing to read, or was asked wrong
  onCallNowPolicyNotFound: string;
  statusPageById: string;
  slosInvalidStatus: string;
  runbookById: string;
  teamById: string;
  incidentTimelineNoId: string;
  incidentTimelineNotFound: string;
  alertTimelineNoId: string;
  alertTimelineNotFound: string;
  workflowById: string;
  incidentSearchNoQuery: string;
  alertSearchNoQuery: string;
  // A long output, read a page at a time (Chat/ToolOutputPager)
  outputPage: string;
} = {
  // {{query}} is the text searched for, as typed; {{page}} a page's title.
  docsSearch: translationKey("Docs search: {{query}}"),
  docsPage: translationKey("Docs: {{page}}"),
  docsSection: translationKey("Docs: {{page}} > {{section}}"),
  dashboardPageSearch: translationKey("Dashboard page: {{query}}"),
  /*
   * {{path}} is where the page is and its name, as the Dashboard's menus
   * name them, each in the reader's language (AIActionMenuPath, #8831).
   */
  dashboardPage: translationKey("Page: {{path}}"),
  codeRepositories: translationKey("Connected code repositories ({{count}})"),
  codeLocationNoStackTrace: translationKey(
    "Code location for exception (no stack trace)",
  ),
  codeLocationNoRepository: translationKey(
    "Code location for exception (no repository matched)",
  ),
  // {{repository}} is organization/repository, as the code host names it.
  codeLocation: translationKey(
    "Code location: {{repository}} ({{count}} frames)",
  ),
  codeSearch: translationKey(
    'Code search "{{query}}" in {{repository}} ({{count}} of {{total}})',
  ),
  // {{file}} is the file's path.
  codeFileEmpty: translationKey("{{file}} (empty)"),
  // Lines {{start}} to {{end}} of the file: no words of their own.
  codeFileLines: "{{file}}:{{start}}-{{end}} ({{repository}})",
  // {{sha}} is the commit's short hash; {{files}} how many files it changed.
  commit: translationKey("Commit {{sha}} on {{branch}} ({{files}})"),
  // {{number}} is "#12" on GitHub, "!12" on GitLab; {{title}} as written.
  pullRequest: translationKey("PR {{number}}: {{title}}"),
  mergeRequest: translationKey("MR {{number}}: {{title}}"),
  // {{name}} is the resource's or the device's name, as its cloud names it.
  cloudResourceInventory: translationKey("{{name}} (inventory)"),
  cloudResourceInventoryUnnamed: translationKey("Cloud resource (inventory)"),
  cloudAccounts: translationKey("Cloud accounts ({{count}})"),
  transceivers: translationKey("{{name}} transceivers"),
  transceiversUnnamed: translationKey("Network device transceivers"),
  telemetryServices: translationKey("Telemetry services ({{count}} found)"),
  metricNames: translationKey("Metric names ({{count}} found)"),
  metricAttributeKeys: translationKey(
    "Metric attribute keys ({{count}} found)",
  ),
  // {{metric}} is the metric's name.
  metricAttributeKeysOf: translationKey(
    "{{metric}} Metric attribute keys ({{count}} found)",
  ),
  traceAttributeKeys: translationKey("Trace attribute keys ({{count}} found)"),
  logAttributeKeys: translationKey("Log attribute keys ({{count}} found)"),
  exceptionAttributeKeys: translationKey(
    "Exception attribute keys ({{count}} found)",
  ),
  profileAttributeKeys: translationKey(
    "Profile attribute keys ({{count}} found)",
  ),
  securityEventAttributeKeys: translationKey(
    "SecurityEvent attribute keys ({{count}} found)",
  ),
  /*
   * {{aggregation}} is how the points were aggregated ("Avg", "P95"),
   * {{metric}} the metric's name, {{groupBy}} what the series differ in; a
   * window, as AI_READ_WINDOW. No words of their own but "by".
   */
  metric: "{{aggregation}}({{metric}}), {{start}} – {{end}}",
  metricBy: translationKey(
    "{{aggregation}}({{metric}}) by {{groupBy}}, {{start}} – {{end}}",
  ),
  // {{at}} is the moment judged against its hour of the week's range.
  metricBaseline: translationKey("Expected range of {{metric}} at {{at}}"),
  // {{entity}} is the ID of what the metric is about (a monitor's).
  metricBaselineOfEntity: translationKey(
    "Expected range of {{metric}} · {{entity}} at {{at}}",
  ),
  // {{kind}} is the kind of resource (AI_READ_RESOURCE_KINDS), in the sentence.
  resourceMetrics: translationKey("{{kind}} metrics, {{start}} – {{end}}"),
  resourceMetricsBy: translationKey(
    "{{kind}} metrics by {{groupBy}}, {{start}} – {{end}}",
  ),
  resourceLogs: translationKey("{{kind}} logs, {{start}} – {{end}}"),
  resourceTraces: translationKey("{{kind}} traces, {{start}} – {{end}}"),
  // Two windows' ends, moments: "to" between them, as the profile tables say.
  profileHotspots: translationKey("Profile hotspots, {{start}} to {{end}}"),
  profileComparison: translationKey(
    "Profile comparison, {{beforeStart}} to {{beforeEnd}} vs {{afterStart}} to {{afterEnd}}",
  ),
  // {{function}} is the function's name, as the profile names it.
  profileOfFunction: translationKey(
    "Profile of {{function}}, {{start}} to {{end}}",
  ),
  // {{table}}, {{name}} and {{reference}} are a data table's names, as given.
  dataTable: translationKey("Data table {{table}}"),
  dataTables: translationKey(
    'Data tables called "{{reference}}" - {{count}} found',
  ),
  lineageOf: translationKey("Lineage of {{name}}"),
  lineageOfTables: translationKey(
    'Lineage of tables called "{{reference}}" - {{count}} found',
  ),
  // {{id}} is the change's ID; {{title}} its title, as written.
  changeNotFound: translationKey("Change {{id}} (not found)"),
  change: translationKey("Change {{title}}"),
  // {{commits}} is how many commits it holds (AI_TOOL_CITATION_PLURALS.commits).
  changeWithCommits: translationKey("Change {{title}} ({{commits}})"),
  // Two moments, then how many events.
  recentChanges: translationKey(
    "Changes {{start}} → {{end}} ({{count}} events)",
  ),
  setupHealth: translationKey("Setup Health"),
  // {{monitor}} is the monitor's name.
  whoIsTold: translationKey('Who is told when "{{monitor}}" goes down'),
  // {{incident}} and {{alert}} are the record's number ("#42").
  createdIncident: translationKey("Created incident {{incident}}"),
  linkedIncident: translationKey("Linked incident {{incident}}"),
  // {{state}} is the state it moved to, as the project named it.
  incidentInState: translationKey("{{state}} incident {{incident}}"),
  createdAlert: translationKey("Created alert {{alert}}"),
  linkedAlert: translationKey("Linked alert {{alert}}"),
  alertInState: translationKey("{{state}} alert {{alert}}"),
  incidentNote: translationKey("Internal note on incident {{incident}}"),
  alertNote: translationKey("Internal note on alert {{alert}}"),
  // {{policy}} is the on-call policy's name.
  pagedPolicyForIncident: translationKey(
    'Paged "{{policy}}" for incident {{incident}}',
  ),
  // {{name}} is the runbook's name; {{id}} its ID, when its name is not readable.
  startedRunbook: translationKey('Started runbook "{{name}}"'),
  startedRunbookById: translationKey("Started runbook {{id}}"),
  incidentStatusUpdate: translationKey(
    "Status update on incident {{incident}}",
  ),
  // {{severity}} is the severity it moved to, as the project named it.
  incidentSeverityChanged: translationKey(
    "Incident {{incident}} → {{severity}}",
  ),
  // {{name}} is the monitor's, the policy's, the page's or the workflow's name.
  setUpMonitor: translationKey('Set up monitor "{{name}}"'),
  createdOnCallPolicy: translationKey('Created on-call policy "{{name}}"'),
  publishedStatusPage: translationKey('Published status page "{{name}}"'),
  addedMonitorsToStatusPage: translationKey(
    'Added monitors to status page "{{name}}"',
  ),
  /*
   * People added to a policy the project has (#7244), the person's ladder
   * saved (#7454), people invited to the project (#7242): the record each
   * chip opens.
   */
  addedToOnCallPolicy: translationKey('Added to on-call policy "{{name}}"'),
  savedHowToReachMe: translationKey("Saved How to Reach Me"),
  invitedPeople: translationKey("Invited to the {{team}} team"),
  workflowComponents: translationKey("Workflow components"),
  workflowDraft: translationKey("Workflow draft"),
  createdWorkflow: translationKey('Created workflow "{{name}}"'),
  updatedWorkflow: translationKey('Updated workflow "{{name}}"'),
  aiInvestigationInvalidArguments: translationKey(
    "AI investigation (invalid arguments)",
  ),
  aiInvestigationSubjectNotFound: translationKey(
    "AI investigation (subject not found)",
  ),
  /*
   * {{subject}} is the incident or the alert, by its number
   * (AI_READ_CITATIONS.incident, .alert); {{runs}} how many runs it read.
   */
  aiInvestigationNone: translationKey(
    "AI investigation for {{subject}} (none found)",
  ),
  aiInvestigationRuns: translationKey(
    "AI investigation for {{subject}} ({{runs}})",
  ),
  aiInsightsInvalidStatus: translationKey(
    "AI insights (invalid status filter)",
  ),
  investigationInProgress: translationKey(
    "Investigation already in progress for {{subject}}",
  ),
  recentInvestigationExists: translationKey(
    "Recent investigation exists for {{subject}}",
  ),
  investigationNotEnqueued: translationKey(
    "Investigation not enqueued for {{subject}}",
  ),
  investigationQueued: translationKey(
    "AI investigation queued for {{subject}}",
  ),
  // {{entity}} is the IP, host or user the cases are about, as given.
  openSecurityCases: translationKey("Security cases (open) - {{count}} found"),
  openSecurityCasesAbout: translationKey(
    "Security cases (open, about {{entity}}) - {{count}} found",
  ),
  closedSecurityCases: translationKey(
    "Security cases (closed) - {{count}} found",
  ),
  closedSecurityCasesAbout: translationKey(
    "Security cases (closed, about {{entity}}) - {{count}} found",
  ),
  allSecurityCases: translationKey("Security cases (all) - {{count}} found"),
  allSecurityCasesAbout: translationKey(
    "Security cases (all, about {{entity}}) - {{count}} found",
  ),
  // {{case}} is the case's number and title; {{detections}} how many.
  securityCase: translationKey("Security case {{case}} ({{detections}})"),
  // {{values}} is how many were looked up; {{known}} how many a feed knows.
  threatIntelLookup: translationKey(
    "Threat intel lookup of {{values}}: {{known}} known-bad",
  ),
  // {{hours}} is how far back it reads (AI_TOOL_CITATION_PLURALS.hours).
  securityActivity: translationKey(
    "Security activity of {{values}} over {{hours}}",
  ),
  securityPlaybooksOn: translationKey(
    "Security playbooks that are on ({{count}})",
  ),
  securityCaseNote: translationKey("Note on {{case}}"),
  // {{playbook}} is the playbook's name.
  securityCasePlaybook: translationKey("Playbook {{playbook}} on {{case}}"),
  dataStores: translationKey("Data stores - {{count}} found"),
  // {{filters}} is the list of what the stores were filtered by.
  dataStoresFiltered: translationKey(
    "Data stores ({{filters}}) - {{count}} found",
  ),
  // {{sensitivity}} is a sensitivity (AI_READ_DATA_SECURITY_TERMS).
  dataStoreSensitivityOrAbove: translationKey("{{sensitivity}} or above"),
  // {{dataType}} is a data type's name, as the catalog names it.
  dataStoreHolding: translationKey("holding {{dataType}}"),
  dataStoreNamedLike: translationKey('named like "{{name}}"'),
  dataStore: translationKey("Data store {{name}}"),
  openDataSecurityIssues: translationKey(
    "Data security issues (open) - {{count}} found",
  ),
  acceptedDataSecurityIssues: translationKey(
    "Data security issues (accepted) - {{count}} found",
  ),
  resolvedDataSecurityIssues: translationKey(
    "Data security issues (resolved) - {{count}} found",
  ),
  notAnIssueDataSecurityIssues: translationKey(
    "Data security issues (not-an-issue) - {{count}} found",
  ),
  allDataSecurityIssues: translationKey(
    "Data security issues (all) - {{count}} found",
  ),
  // The issues of one severity: {{severity}} is a severity, as a term.
  openDataSecurityIssuesOfSeverity: translationKey(
    "Data security issues (open, {{severity}}) - {{count}} found",
  ),
  acceptedDataSecurityIssuesOfSeverity: translationKey(
    "Data security issues (accepted, {{severity}}) - {{count}} found",
  ),
  resolvedDataSecurityIssuesOfSeverity: translationKey(
    "Data security issues (resolved, {{severity}}) - {{count}} found",
  ),
  notAnIssueDataSecurityIssuesOfSeverity: translationKey(
    "Data security issues (not-an-issue, {{severity}}) - {{count}} found",
  ),
  allDataSecurityIssuesOfSeverity: translationKey(
    "Data security issues (all, {{severity}}) - {{count}} found",
  ),
  // {{title}} is the issue's title, as its check names it.
  dataSecurityIssue: translationKey("Data security issue: {{title}}"),
  whoCanReachDataStore: translationKey(
    "Who can reach the data store - {{count}} found",
  ),
  // {{principal}} is the user, role or key asked about, as named.
  dataStoresPrincipalCanReach: translationKey(
    'Data stores "{{principal}}" can reach - {{count}} found',
  ),
  onCallNowPolicyNotFound: translationKey("On-call now (policy not found)"),
  // {{id}} is the record's ID, as asked for: it could not be read.
  statusPageById: translationKey("Status page {{id}}"),
  slosInvalidStatus: translationKey("SLOs (invalid status filter)"),
  runbookById: translationKey("Runbook {{id}}"),
  teamById: translationKey("Team {{id}}"),
  incidentTimelineNoId: translationKey("Incident timeline (no incident id)"),
  incidentTimelineNotFound: translationKey("Incident timeline (not found)"),
  alertTimelineNoId: translationKey("Alert timeline (no alert id)"),
  alertTimelineNotFound: translationKey("Alert timeline (not found)"),
  workflowById: translationKey("Workflow {{id}}"),
  incidentSearchNoQuery: translationKey("Incident search (no query)"),
  alertSearchNoQuery: translationKey("Alert search (no query)"),
  /*
   * {{label}} is what the output is of - a command, or another chip's
   * words - and {{start}} and {{end}} the characters this page holds.
   */
  outputPage: translationKey("{{label}} (characters {{start}}–{{end}})"),
};

/*
 * The counts said with words of their own inside a chip: "2 runs", "1
 * commit" (ReadTableWords.countedValue).
 */
export const AI_TOOL_CITATION_PLURALS: {
  runs: PluralTemplate;
  commits: PluralTemplate;
  files: PluralTemplate;
  detections: PluralTemplate;
  values: PluralTemplate;
  hours: PluralTemplate;
} = {
  runs: {
    one: translationKey("{{count}} run"),
    other: translationKey("{{count}} runs"),
  },
  commits: {
    one: translationKey("{{count}} commit"),
    other: translationKey("{{count}} commits"),
  },
  files: {
    one: translationKey("{{count}} file"),
    other: translationKey("{{count}} files"),
  },
  detections: {
    one: translationKey("{{count}} detection"),
    other: translationKey("{{count}} detections"),
  },
  values: {
    one: translationKey("{{count}} value"),
    other: translationKey("{{count}} values"),
  },
  hours: {
    one: translationKey("{{count}} hour"),
    other: translationKey("{{count}} hours"),
  },
};

/*
 * An infrastructure resource's kind, as the telemetry pages name it
 * (Types/Telemetry/ResourceFacetCatalog): one and many.
 */
export const AI_READ_RESOURCE_KINDS: ReadonlyArray<string> = [
  translationKey("Host"),
  translationKey("Hosts"),
  translationKey("Docker Host"),
  translationKey("Docker Hosts"),
  translationKey("Podman Host"),
  translationKey("Podman Hosts"),
  translationKey("Kubernetes Cluster"),
  translationKey("Kubernetes Clusters"),
  translationKey("Docker Swarm Cluster"),
  translationKey("Docker Swarm Clusters"),
  translationKey("Proxmox Cluster"),
  translationKey("Proxmox Clusters"),
  translationKey("OpenStack Cloud"),
  translationKey("OpenStack Clouds"),
  translationKey("vCenter"),
  translationKey("vCenters"),
  translationKey("Ceph Cluster"),
  translationKey("Ceph Clusters"),
  translationKey("Storage Array"),
  translationKey("Storage Arrays"),
  translationKey("Serverless Function"),
  translationKey("Serverless Functions"),
  translationKey("Cloud Resource"),
  translationKey("Cloud Resources"),
  translationKey("RUM Application"),
  translationKey("RUM Applications"),
  translationKey("IoT Fleet"),
  translationKey("IoT Fleets"),
  translationKey("Database"),
  translationKey("Databases"),
  translationKey("Network Device"),
  translationKey("Network Devices"),
];

/*
 * ---------------------------------------------------------------------------
 * The chips of the tools Ask AI gets from outside the toolbox (#8511): a
 * connected cluster's kubectl, a resource's AI agent, the external MCP
 * servers and an investigation's remediation. A command, a cluster's, a
 * runner's and a server's name are data.
 * ---------------------------------------------------------------------------
 */

export const AI_TOOLKIT_CITATIONS: {
  clustersAvailable: string;
  commandOnCluster: string;
  infrastructureAvailable: string;
  commandOnResource: string;
  mcpServerTools: string;
  mcpServersTools: string;
  mcpToolResult: string;
  mcpToolNotRun: string;
  noFixReason: string;
  proposedRollback: string;
  commandTargets: string;
  sentToCluster: string;
  executedOnCluster: string;
  sentToResource: string;
  executedOnResource: string;
  executedOnRunner: string;
  proposedPlan: string;
} = {
  clustersAvailable: translationKey("Clusters OneUptime AI can inspect"),
  // {{command}} is the command as run; {{cluster}} the cluster's name.
  commandOnCluster: translationKey('{{command}} on cluster "{{cluster}}"'),
  infrastructureAvailable: translationKey(
    "Infrastructure OneUptime AI can inspect",
  ),
  // {{resource}} is the resource, by its kind and name ('Docker host "web-1"').
  commandOnResource: translationKey("{{command}} on {{resource}}"),
  // {{server}} is the MCP server's name; {{tool}} its tool's.
  mcpServerTools: translationKey("Tools of MCP server {{server}}"),
  mcpServersTools: translationKey("Tools of the external MCP servers"),
  // What a tool of an MCP server returned: no words of their own.
  mcpToolResult: "{{server}} · {{tool}}",
  mcpToolNotRun: translationKey("{{server}} · {{tool}} (not run)"),
  noFixReason: translationKey("Why there is no fix"),
  // {{deployment}} is namespace/deployment.
  proposedRollback: translationKey("Proposed rolling back {{deployment}}"),
  commandTargets: translationKey("Available command targets"),
  sentToCluster: translationKey(
    'Sent to cluster "{{cluster}}", result unknown: {{command}}',
  ),
  executedOnCluster: translationKey(
    'Executed on cluster "{{cluster}}": {{command}}',
  ),
  sentToResource: translationKey(
    "Sent to {{resource}}, result unknown: {{command}}",
  ),
  executedOnResource: translationKey("Executed on {{resource}}: {{command}}"),
  // {{runner}} is the Runner's name.
  executedOnRunner: translationKey(
    'Executed on Runner "{{runner}}": {{command}}',
  ),
  // {{count}} is how many commands the plan proposes.
  proposedPlan: translationKey("Proposed a {{count}}-command remediation plan"),
};

/*
 * ---------------------------------------------------------------------------
 * Every sentence and term above, for AIActionWords' lists.
 * ---------------------------------------------------------------------------
 */

export const AI_READ_TABLE_AND_CITATION_SENTENCES: ReadonlyArray<string> = [
  ...Object.values(AI_READ_RECORD_TABLE_TITLES),
  ...Object.values(AI_READ_RECORD_TABLE_LINES),
  ...Object.values(AI_READ_RECORD_TABLE_CELLS),
  ...Object.values(AI_READ_TELEMETRY_TABLE_TITLES),
  AI_READ_WINDOW,
  ...Object.values(AI_READ_TELEMETRY_TABLE_LINES),
  ...Object.values(AI_READ_CITATIONS),
  ...Object.values(AI_READ_WIDGET_TITLES),
  ...Object.values(AI_READ_WIDGET_LINES),
  ...Object.values(AI_READ_ESCALATION_CHAIN),
  ...Object.values(AI_READ_RUNBOOK_STEP_INSTRUCTIONS),
  ...Object.values(AI_TOOL_CITATIONS),
  ...Object.values(AI_TOOLKIT_CITATIONS),
];

export const AI_READ_TABLE_AND_CITATION_PLURAL_SENTENCES: ReadonlyArray<PluralTemplate> =
  [
    ...Object.values(AI_READ_RECORD_TABLE_PLURAL_SENTENCES),
    ...Object.values(AI_READ_CITATION_PLURALS),
    ...Object.values(AI_TOOL_CITATION_PLURALS),
  ];

export const AI_READ_TABLE_TERMS: ReadonlyArray<string> = [
  ...Object.values(AI_READ_RECORD_TABLE_TERMS),
  ...AI_READ_PROFILE_KINDS,
  ...Object.values(AI_READ_CONTAINER_STATUSES),
  ...Object.values(AI_READ_PROBE_STATUSES),
  ...Object.values(AI_READ_WEB_VITAL_RATINGS),
  ...Object.values(AI_READ_ESCALATION_CHAIN_TERMS),
  ...AI_READ_ON_CALL_PAGE_STATUSES,
  ...AI_READ_NOTIFICATION_STATUSES,
  ...Object.values(AI_READ_AI_RUN_STATUSES),
  ...Object.values(AI_INSIGHT_STATUS_LABELS),
  ...Object.values(AI_INSIGHT_SEVERITY_LABELS),
  ...Object.values(AI_READ_TRIAGE_LABELS),
  ...AI_READ_DATA_SECURITY_TERMS,
  ...AI_READ_SECURITY_VERDICTS,
  ...Object.values(AI_READ_RUNBOOK_STEP_TYPES),
  ...Object.values(AI_READ_RUM_CLIENT_TYPES),
  ...AI_READ_RESOURCE_KINDS,
];
