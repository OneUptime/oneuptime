import { PluralTemplate, translationKey } from "../Translator";

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
];

export const AI_READ_TABLE_AND_CITATION_PLURAL_SENTENCES: ReadonlyArray<PluralTemplate> =
  [
    ...Object.values(AI_READ_RECORD_TABLE_PLURAL_SENTENCES),
    ...Object.values(AI_READ_CITATION_PLURALS),
  ];

export const AI_READ_TABLE_TERMS: ReadonlyArray<string> = [
  ...Object.values(AI_READ_RECORD_TABLE_TERMS),
  ...AI_READ_PROFILE_KINDS,
  ...Object.values(AI_READ_CONTAINER_STATUSES),
  ...Object.values(AI_READ_PROBE_STATUSES),
  ...Object.values(AI_READ_WEB_VITAL_RATINGS),
];
