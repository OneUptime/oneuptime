import { JSONObject } from "../JSON";
import { MetricOutputReaders } from "../Metrics/MetricOutputReaders";
import { TelemetryFieldReaders } from "../Telemetry/TelemetryFieldReaders";
import SecuritySeverity from "../SecuritySeverity";
import ComplianceFramework from "./ComplianceFramework";
import { DataSecurityResponseAction } from "./DataSecurityResponseAction";
import { ComplianceFrameworkResult } from "./ComplianceRequirementCatalog";
import DataCategory from "./DataCategory";
import { DataSecurityIssueAnalysisView } from "./DataSecurityIssueAnalysis";
import DataSensitivity from "./DataSensitivity";
import { DataStoreResourceKind } from "./DataStoreResource";

/*
 * WHAT DATA SECURITY'S OWN API ROUTES ANSWER.
 *
 * The CRUD routes of every model come from BaseAPI; these are the few
 * answers that are worked out rather than stored - the Overview's figures,
 * the compliance scores, the record of processing - and the results of
 * actions such as Scan Now and Scrub It. The server (DataSecurityAPI.ts)
 * builds them and the Dashboard (Components/DataSecurity/DataSecurityApi.ts)
 * reads them, from this one definition.
 */

export const DATA_SECURITY_API_ROUTES: {
  overview: string;
  compliance: string;
  resourceScope: string;
  resourceCompliance: string;
  recordOfProcessing: string;
  scanNow: (dataStoreId: string) => string;
  checkNow: (dataStoreId: string) => string;
  scrubFinding: (findingId: string) => string;
  scrubImpact: (findingId: string) => string;
  dropMetricImpact: (findingId: string) => string;
  dropMetric: (findingId: string) => string;
  findingOccurrences: (findingId: string) => string;
  explainIssue: (issueId: string) => string;
  issueAnalysis: (issueId: string) => string;
  fixIssueWithAi: (issueId: string) => string;
  responseActions: (dataStoreId: string) => string;
  respond: (dataStoreId: string) => string;
  approveAiProposal: (proposalId: string) => string;
  dismissAiProposal: (proposalId: string) => string;
  undoAiProposal: (proposalId: string) => string;
  aiInput: string;
} = {
  overview: "/data-security/overview",
  compliance: "/data-security/compliance",
  // The stores a resource's pages show: { kind, id } (DataStoreResource.ts).
  resourceScope: "/data-security/resource-scope",
  // How a resource's own stores stand against each framework: { kind, id }.
  resourceCompliance: "/data-security/resource-compliance",
  recordOfProcessing: "/data-security/record-of-processing",
  scanNow: (dataStoreId: string): string => {
    return `/data-store/${dataStoreId}/scan-now`;
  },
  checkNow: (dataStoreId: string): string => {
    return `/data-store/${dataStoreId}/check-now`;
  },
  scrubFinding: (findingId: string): string => {
    return `/data-store-finding/${findingId}/scrub`;
  },
  /*
   * The rule Scrub It would make for a finding, and what it would take away
   * from the monitors, dashboards, saved views, recording rules, SLOs and
   * Security Events that read what it hides (#10433), before it is made.
   */
  scrubImpact: (findingId: string): string => {
    return `/data-store-finding/${findingId}/scrub-impact`;
  },
  /*
   * A metric's name that holds sensitive data (#9757): what dropping the
   * service's metrics named so would drop and stop, before it is asked for.
   */
  dropMetricImpact: (findingId: string): string => {
    return `/data-store-finding/${findingId}/drop-metric-impact`;
  },
  // ...and the drop itself, { confirmDataLoss: true }: a metric pipeline Drop rule.
  dropMetric: (findingId: string): string => {
    return `/data-store-finding/${findingId}/drop-metric`;
  },
  // The newest records a telemetry finding's data was seen in.
  findingOccurrences: (findingId: string): string => {
    return `/data-store-finding/${findingId}/occurrences`;
  },
  /*
   * OneUptime AI's analysis of an issue (#10369), as the caller may read
   * it: the one the issue keeps when nothing it rests on changed, else one
   * written now - { force: true } writes a new one whatever changed
   * (Analyze Again).
   */
  explainIssue: (issueId: string): string => {
    return `/data-security-issue/${issueId}/explain`;
  },
  // ...and the analysis the issue keeps, read with no model call: what its page shows.
  issueAnalysis: (issueId: string): string => {
    return `/data-security-issue/${issueId}/analysis`;
  },
  fixIssueWithAi: (issueId: string): string => {
    return `/data-security-issue/${issueId}/fix-with-ai`;
  },
  // Which response actions a store can take now (DataSecurityResponse).
  responseActions: (dataStoreId: string): string => {
    return `/data-store/${dataStoreId}/response-actions`;
  },
  // Block public access, or revoke sharing: { action, dataSecurityIssueId? }.
  respond: (dataStoreId: string): string => {
    return `/data-store/${dataStoreId}/respond`;
  },
  /*
   * A proposal of OneUptime AI's (#10364): approve it, { expectedPlanFingerprint,
   * expectedApprovalStep } - the plan and step its person was shown; dismiss
   * it, { reason }; or undo a change that was made.
   */
  approveAiProposal: (proposalId: string): string => {
    return `/data-security-ai-proposal/${proposalId}/approve`;
  },
  dismissAiProposal: (proposalId: string): string => {
    return `/data-security-ai-proposal/${proposalId}/dismiss`;
  },
  undoAiProposal: (proposalId: string): string => {
    return `/data-security-ai-proposal/${proposalId}/undo`;
  },
  /*
   * What OneUptime AI sees (#10365): the model each feature runs on, and -
   * with { withExample: true } - the exact input one of the project's issues
   * would send. { withExample?, issueId? }.
   */
  aiInput: "/data-security/ai-input",
};

export interface DataSecurityOverviewIssue {
  issueId: string;
  title: string;
  severity: SecuritySeverity;
  riskScore: number;
  checkId: string;
  dataStoreId: string;
  dataStoreName: string;
}

export interface DataSecurityOverviewTrendDay {
  /*
   * YYYY-MM-DD: a day of the reader's calendar, in the zone the overview
   * was asked for (issue #7925), or a UTC day when it named none.
   */
  day: string;
  opened: number;
  resolved: number;
}

export interface DataSecurityOverview {
  storeCount: number;
  // Stores whose configuration was read or content scanned.
  evaluatedStoreCount: number;
  contentScannedStoreCount: number;
  storesBySensitivity: Record<DataSensitivity, number>;
  storesByCategory: Array<{ category: DataCategory; storeCount: number }>;
  // Restricted or Confidential stores that are public or shared outside.
  exposedSensitiveStoreCount: number;
  openIssuesBySeverity: Record<SecuritySeverity, number>;
  topIssues: Array<DataSecurityOverviewIssue>;
  // The last 30 days, oldest first.
  issueTrend: Array<DataSecurityOverviewTrendDay>;
  telemetryFindingCount: number;
  unscrubbedTelemetryFindingCount: number;
  // Cloud connections whose role does not allow content reads yet.
  connectionsWithoutContentAccess: number;
  hasCloudConnection: boolean;
}

/*
 * What one resource turned off of a framework, and why (#9629): the whole
 * framework or one of its requirements, with the reason written for it and
 * who turned it off, when. The resource is named as the reader may read it:
 * by its kind alone ("") when they may not.
 */
export interface DataSecurityComplianceTurnedOff {
  // The setting's own id, which its reason is written to.
  id: string;
  resource: DataSecurityResourceRef;
  // The requirement, as the catalog names it; null for the whole framework.
  requirement: string | null;
  // Why it does not apply there, as written; "" when nobody said.
  note: string;
  // When it was last turned off; null when not known.
  turnedOffAt: string | null;
  // Who turned it off, by name or email; null for an API key, or when not known.
  turnedOffBy: string | null;
}

// The most of a framework's turned-off settings an answer lists, the latest first.
export const MAX_COMPLIANCE_TURNED_OFF: number = 200;

export interface DataSecurityComplianceFramework
  extends ComplianceFrameworkResult {
  fullName: string;
  scope: string;
  /*
   * What is turned off of it, the latest first (#9629): on the project's
   * Compliance page every resource's, on a resource's what is turned off
   * where its compliance is set. Absent from an older server's answer.
   */
  turnedOff?: Array<DataSecurityComplianceTurnedOff> | undefined;
}

export interface DataSecurityComplianceResponse {
  frameworks: Array<DataSecurityComplianceFramework>;
}

// A resource, as the resource routes are asked about one.
export interface DataSecurityResourceRef {
  kind: DataStoreResourceKind;
  id: string;
  name: string;
}

/*
 * What a resource's Data Security and Compliance pages read under
 * (DataStoreResource.ts): every store its pages show - its own, or the
 * databases' running on it - and the ones whose compliance is set on it.
 * A database running on a cluster or a container host shows its store,
 * whose compliance is set on that cluster or host (complianceOwner).
 */
export interface DataSecurityResourceScope {
  kind: DataStoreResourceKind;
  id: string;
  name: string;
  dataStoreIds: Array<string>;
  ownedDataStoreIds: Array<string>;
  // Where the compliance of its stores is set, when that is another resource.
  complianceOwner: DataSecurityResourceRef | null;
  // More stores than a scope lists (MAX_RESOURCE_SCOPE_STORES): the first are listed.
  isTruncated: boolean;
}

// The most stores one resource's scope lists.
export const MAX_RESOURCE_SCOPE_STORES: number = 500;

/*
 * One framework on a resource's Compliance page: scored over the resource's
 * stores, with what is turned off of it where the resource's compliance is
 * set (the resource, or the cluster or container host a database runs on).
 */
export interface DataSecurityResourceComplianceFramework
  extends DataSecurityComplianceFramework {
  isTurnedOff: boolean;
  turnedOffRequirements: Array<string>;
}

export interface DataSecurityResourceComplianceResponse {
  kind: DataStoreResourceKind;
  id: string;
  name: string;
  // The stores the resource's pages show, which its frameworks are scored over.
  storeCount: number;
  /*
   * Where its frameworks are turned on and off, when that is another
   * resource: the cluster or container host a database runs on. Null when
   * the resource sets them itself.
   */
  complianceOwner: DataSecurityResourceRef | null;
  frameworks: Array<DataSecurityResourceComplianceFramework>;
}

export interface DataSecurityRecordOfProcessingRow {
  dataStoreId: string;
  name: string;
  kind: string;
  provider: string;
  region: string;
  environment: string;
  sensitivity: DataSensitivity;
  dataCategories: Array<DataCategory>;
  dataTypeNames: Array<string>;
  owners: Array<string>;
  purpose: string;
  retention: string;
  frameworks: Array<ComplianceFramework>;
}

export interface DataSecurityRecordOfProcessingResponse {
  rows: Array<DataSecurityRecordOfProcessingRow>;
}

/*
 * Which kind of rule Scrub It made: a log or a trace scrub rule, or - for
 * a metric's attribute - a metric pipeline rule that redacts it.
 */
export type DataSecurityScrubSignal = "log" | "trace" | "metric";

export interface DataSecurityScrubResult {
  signal: DataSecurityScrubSignal;
  scrubRuleId: string;
  scrubRuleName: string;
}

/*
 * SCRUB IT, SAID BEFORE IT IS DONE (#10433).
 *
 * The rule Scrub It would make for a finding - what it does with what it
 * finds (redact, mask, hash), in which parts of the records, and whose: the
 * service the finding's telemetry was sent under, or every service and app
 * of the project for a RUM application's replays - and what that rule
 * would take away from the project's monitors, dashboards, saved views,
 * recording rules, SLOs and Security Events (TelemetryFieldReaders). The
 * dialog says all of it, in the reader's words, before the rule is made.
 */
export interface DataSecurityScrubRulePlan {
  signal: DataSecurityScrubSignal;
  // The name the rule will be given.
  name: string;
  // What it leaves of a match: a LogScrubAction (a metric's rule redacts).
  scrubAction: string;
  // A LogScrubPatternType for a log or trace rule; "" for a metric's.
  patternType: string;
  // The parts of the records it scrubs (LogScrubField, TraceScrubField); "" for a metric's.
  fieldsToScrub: string;
  // The data type as the rule calls it.
  dataTypeName: string;
  // The service the rule is for; none for every service and app of the project.
  serviceId?: string | undefined;
  serviceName?: string | undefined;
  /*
   * An IP Address rule that hashes rather than redacts, because Security
   * Events reads the addresses there (#10396): the dialog says what that
   * keeps, in one line.
   */
  hashesForSecurityEvents?: boolean | undefined;
}

export interface DataSecurityScrubImpact {
  isAvailable: boolean;
  // Why no rule can be made, in the server's words: what Scrub It would answer.
  unavailableReason?: string | undefined;
  // The enabled rule that already hides the finding's data, when one does.
  existingRule?:
    | { id: string; name: string; signal: DataSecurityScrubSignal }
    | undefined;
  rule?: DataSecurityScrubRulePlan | undefined;
  // What reads what the rule would hide: a log or trace rule's.
  readers?: TelemetryFieldReaders | undefined;
}

/*
 * DROPPING THE METRICS WHOSE NAMES HOLD A FINDING'S DATA (issue #9757).
 *
 * No rule can take the data out of a metric's name: a pipeline rule only
 * renames a metric whole. What one can do, until the code is fixed, is drop
 * the new data points of every metric of the service whose name has the data
 * type's shape - a metric pipeline Drop rule. That loses them for good, so it
 * is an action of its own, asked for deliberately, after the page has said
 * what it drops and which monitors, dashboards, SLOs and recording rules
 * that leaves without data (#9946).
 */

// Why the metrics named with a finding's data cannot be dropped by a rule.
export enum DataSecurityDropMetricUnavailableReason {
  // The finding is not in a metric's name.
  NotAMetricName = "NotAMetricName",
  /*
   * Its data type has no pattern a rule could find it in a name by: found by
   * field names, or only by the words around it, or one of the project's own.
   */
  NoPattern = "NoPattern",
  // The service the metrics were sent under is gone.
  NoService = "NoService",
}

// A dashboard's widget that reads a metric the drop would empty.
export interface DataSecurityMetricUserWidget {
  // The id the board draws it under: a link opens the dashboard at it (#10084).
  id: string;
  // Its title, or "" when it has none.
  title: string;
  // Its componentType ("chart"), which names it when it has no title.
  type: string;
}

/*
 * A monitor, a dashboard, an SLO or a metric recording rule that reads a
 * metric the drop would empty.
 */
export interface DataSecurityMetricUser {
  id: string;
  name: string;
  // A dashboard's: the widgets on it that read those metrics.
  widgets?: Array<DataSecurityMetricUserWidget> | undefined;
  // A recording rule's: the metric it writes, which finds it in its list.
  outputMetricName?: string | undefined;
  /*
   * A recording rule's: what reads the metric it writes, which no longer
   * includes those metrics either - and on down the chain (#10085). None
   * when nothing does.
   */
  outputReaders?: MetricOutputReaders | undefined;
}

export interface DataSecurityDropMetricImpact {
  isAvailable: boolean;
  unavailableReason?: DataSecurityDropMetricUnavailableReason | undefined;
  // The enabled rule that already drops them, when one does.
  existingRule?: { id: string; name: string } | undefined;
  // The name the rule would be given.
  ruleName?: string | undefined;
  /*
   * How many of the service's metrics written in the last day have a name
   * the rule drops - their names never leave the server - and whether there
   * were more than were counted. metricsCounted is false when they could not
   * be read just now: metricsMatched is then no count at all.
   */
  metricsMatched: number;
  isMetricsMatchedCapped: boolean;
  metricsCounted: boolean;
  /*
   * What reads a metric whose name the rule drops, of that service (or of
   * every service), and so gets no new data from it (#9946): monitors,
   * dashboards (with the widgets on them that read it), Metric SLOs of that
   * service, and metric recording rules. Named only where the reader may
   * read them; the rest are counted in ...Hidden, never named. Checked is
   * false when they could not be read just now: nothing is known of them.
   */
  monitors: Array<DataSecurityMetricUser>;
  dashboards: Array<DataSecurityMetricUser>;
  slos: Array<DataSecurityMetricUser>;
  recordingRules: Array<DataSecurityMetricUser>;
  monitorsChecked: boolean;
  dashboardsChecked: boolean;
  slosChecked: boolean;
  recordingRulesChecked: boolean;
  monitorsHidden: number;
  dashboardsHidden: number;
  slosHidden: number;
  recordingRulesHidden: number;
  /*
   * What reads the output metrics of the recording rules the reader may
   * not read (#10085): named where they may read it, never which rules
   * those are. None when nothing does.
   */
  recordingRulesHiddenOutputReaders?: MetricOutputReaders | undefined;
}

export interface DataSecurityDropMetricResult {
  ruleId: string;
  ruleName: string;
}

// What kind of record a telemetry finding's data was seen in.
export enum DataSecurityOccurrenceRecordKind {
  Log = "Log",
  Span = "Span",
  Exception = "Exception",
  AiCall = "AI call",
  Session = "Session",
  // A metric's data point: one series of the metric, at one moment.
  Metric = "Metric",
}

// Why a telemetry finding's records are not shown.
export enum DataSecurityOccurrencesUnavailableReason {
  // The reader may not read the store's telemetry themselves.
  NoTelemetryAccess = "NoTelemetryAccess",
  // Records cannot be looked up at the finding's location.
  UnreadableLocation = "UnreadableLocation",
  // The service or RUM application the telemetry was sent under is gone.
  NoOwner = "NoOwner",
}

// What a part of a record's excerpt is.
export enum DataSecurityOccurrenceExcerptPartKind {
  // The record's own text, as it reads.
  Text = "Text",
  // The finding's data, masked: what the excerpt is about.
  Match = "Match",
  // Other sensitive data beside it, masked too.
  Masked = "Masked",
}

export interface DataSecurityOccurrenceExcerptPart {
  kind: DataSecurityOccurrenceExcerptPartKind;
  text: string;
}

/*
 * What a record holds at a finding's location, around the finding's data:
 * a log line, an exception's message, an attribute's value, a prompt - cut
 * to the part that matters, with every sensitive value in it masked as a
 * finding's samples are, and the finding's own data marked. Shown only to
 * someone who may read that telemetry; the record itself shows it whole.
 */
export interface DataSecurityOccurrenceExcerpt {
  // The attribute the value is under, as the record names it: user.email.
  field?: string | undefined;
  // For a span event's attribute: the event's name.
  event?: string | undefined;
  parts: Array<DataSecurityOccurrenceExcerptPart>;
  // The value goes on before the first part, or after the last.
  isCutAtStart: boolean;
  isCutAtEnd: boolean;
}

// Which records a finding's records were read from.
export enum DataSecurityOccurrencesSource {
  // The very records the last scan found it in (DataStoreFinding.sampleRecords).
  SampledRecords = "SampledRecords",
  // The records written in the hour the last scan read, before scans kept them.
  SampleWindow = "SampleWindow",
  // The newest records of the last days: when no scan has seen it.
  Recent = "Recent",
}

/*
 * One record a telemetry finding's data was seen in: enough to open it -
 * the trace, the log line, the exception, the session - and the data,
 * masked as a finding's samples are, in its place in the record (excerpt).
 */
export interface DataSecurityFindingOccurrence {
  // When the record was written (ISO 8601).
  time: string;
  recordKind: DataSecurityOccurrenceRecordKind;
  // The service whose telemetry it is.
  serviceId?: string | undefined;
  // For a session replay store: the RUM application.
  rumApplicationId?: string | undefined;
  traceId?: string | undefined;
  spanId?: string | undefined;
  /*
   * A span's or an AI call's name, an exception's type, a metric's name -
   * a metric's with every sensitive value in it masked, as an excerpt's.
   */
  name?: string | undefined;
  /*
   * A metric's data point: its metric's name as the table keys it, to open
   * it in the metrics explorer - only when no sensitive data is in the
   * name, so no value ever goes into an address.
   */
  metricName?: string | undefined;
  /*
   * A log line's own id (the Log row's _id): the logs explorer opens that
   * very line by it, with its time (#9793). Absent from a server of the
   * release before, whose links open the line's request or second instead.
   */
  logId?: string | undefined;
  // A log line's severity.
  severity?: string | undefined;
  // An exception's group.
  fingerprint?: string | undefined;
  sessionId?: string | undefined;
  maskedValue: string;
  excerpt?: DataSecurityOccurrenceExcerpt | undefined;
}

export interface DataSecurityFindingOccurrences {
  // The newest first.
  occurrences: Array<DataSecurityFindingOccurrence>;
  // The window read (ISO 8601).
  since: string;
  until: string;
  // How many records with a value at the finding's location were read.
  recordsRead: number;
  // Every such record in the window was read.
  isComplete: boolean;
  unavailableReason?: DataSecurityOccurrencesUnavailableReason | undefined;
  // Which records were read; Recent when absent (a server of the release before).
  source?: DataSecurityOccurrencesSource | undefined;
  // When a scan last saw the finding (ISO 8601): the records it was found in are from then.
  lastSeenAt?: string | undefined;
}

/*
 * What Explain with AI answers (#10369): the issue's analysis as Markdown,
 * as the API and the MCP have always read it, and as data - each only what
 * the caller may read - and whether it was written now.
 */
export interface DataSecurityExplainResult {
  markdown: string;
  analysis?: DataSecurityIssueAnalysisView | null | undefined;
  // A model call was made for it now: there was none, its input changed, or it was asked for again.
  isNew?: boolean | undefined;
}

/*
 * The analysis an issue keeps, as the caller may read it, or null: none,
 * or the project's AI is off.
 */
export interface DataSecurityIssueAnalysisResult {
  analysis: DataSecurityIssueAnalysisView | null;
}

// A repository the person may ask OneUptime AI to work in (#10362).
export interface DataSecurityFixRepository {
  id: string;
  name: string;
}

export interface DataSecurityFixResult {
  // What happened, for the toast: a run started, or why it could not.
  message: string;
  aiRunId?: string | undefined;
  /*
   * When the person must choose the repository: those of the project's
   * they may ask OneUptime AI to work in, and only those.
   */
  repositories?: Array<DataSecurityFixRepository> | undefined;
}

// Why a store cannot take a response action now.
export enum DataSecurityResponseUnavailableReason {
  // The store was not found through a cloud connection.
  NotThroughACloud = "NotThroughACloud",
  // Its cloud connection is gone, or turned off.
  ConnectionGone = "ConnectionGone",
  // Its connection's "Data security response" setting is off.
  ResponseOff = "ResponseOff",
  // The store is marked public by design: its public access stays.
  PublicByDesign = "PublicByDesign",
}

export interface DataSecurityResponseActionAvailability {
  action: DataSecurityResponseAction;
  isAvailable: boolean;
  unavailableReason?: DataSecurityResponseUnavailableReason | undefined;
}

export interface DataSecurityResponseAvailability {
  // The actions a store of its kind takes; none for the others.
  actions: Array<DataSecurityResponseActionAvailability>;
  // The connection to turn the response on for, when that is what is missing.
  cloudConnectionId?: string | undefined;
}

export interface DataSecurityResponseResult {
  // Whether anything changed: false when the store was already closed.
  changed: boolean;
  summary: string;
}

/*
 * WHAT ONEUPTIME AI SEES, AS DATA SECURITY > SETTINGS > ONEUPTIME AI SHOWS IT
 * (#10365): the model each feature runs on, and the exact input one real
 * issue of the project would send. What each feature sends and keeps is
 * the catalog's (DataSecurityAiFeatures); this is what only the server
 * knows.
 */

// A model a feature runs on, as Settings names it: never its key or address.
export interface DataSecurityAiModelSummary {
  name: string;
  llmType: string;
  modelName: string;
  // One of the project's own providers, or the server's, which every project shares.
  isProjectProvider: boolean;
  // Run where its owner runs it: Ollama, vLLM or any OpenAI-compatible endpoint.
  isSelfHosted: boolean;
}

// Why Settings shows no example.
export enum DataSecurityAiExampleUnavailableReason {
  // The project has no open issue to show one for.
  NoIssue = "NoIssue",
  // The reader may not read the project's issues.
  NoPermission = "NoPermission",
}

/*
 * Explain with AI's input for one issue, exactly as it would be sent - but
 * the project's AI context, which goes first in its system message, is
 * said by its length: it is the project's settings to read.
 */
export interface DataSecurityAiInputExample {
  dataSecurityIssueId: string;
  issueTitle: string;
  // The system message, without the AI context.
  system: string;
  // The user message: one JSON value of data.
  data: JSONObject;
  // What Fix with AI would ask the coding agent for the same issue.
  fixRequest: string;
  // The AI context's length in characters; 0 when the project has none.
  aiContextCharacterCount: number;
}

export interface DataSecurityAiInputResponse {
  // The project's Enable AI: with it off, nothing is sent at all.
  isAiEnabled: boolean;
  /*
   * Whether the reader may read the project's LLM providers: the models
   * below are named only to who may (LlmProvider's readers).
   */
  canReadModels: boolean;
  // What Explain and the field suggestions run on when no AI rule picks one.
  projectModel: DataSecurityAiModelSummary | null;
  // What Fix with AI's coding agent runs on.
  codeAgentModel: DataSecurityAiModelSummary | null;
  // Only when asked for (withExample): null otherwise.
  example: DataSecurityAiInputExample | null;
  exampleUnavailableReason?: DataSecurityAiExampleUnavailableReason | undefined;
}
