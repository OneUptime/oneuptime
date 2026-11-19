import SecuritySeverity from "../SecuritySeverity";
import ComplianceFramework from "./ComplianceFramework";
import { DataSecurityResponseAction } from "./DataSecurityResponseAction";
import { ComplianceFrameworkResult } from "./ComplianceRequirementCatalog";
import DataCategory from "./DataCategory";
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
  findingOccurrences: (findingId: string) => string;
  explainIssue: (issueId: string) => string;
  fixIssueWithAi: (issueId: string) => string;
  responseActions: (dataStoreId: string) => string;
  respond: (dataStoreId: string) => string;
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
  // The newest records a telemetry finding's data was seen in.
  findingOccurrences: (findingId: string): string => {
    return `/data-store-finding/${findingId}/occurrences`;
  },
  explainIssue: (issueId: string): string => {
    return `/data-security-issue/${issueId}/explain`;
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

export interface DataSecurityExplainResult {
  markdown: string;
}

export interface DataSecurityFixResult {
  // What happened, for the toast: a run started, or why it could not.
  message: string;
  aiRunId?: string | undefined;
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
