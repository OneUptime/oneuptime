import SecuritySeverity from "../SecuritySeverity";
import ComplianceFramework from "./ComplianceFramework";
import { DataSecurityResponseAction } from "./DataSecurityResponseAction";
import { ComplianceFrameworkResult } from "./ComplianceRequirementCatalog";
import DataCategory from "./DataCategory";
import DataSensitivity from "./DataSensitivity";

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
  recordOfProcessing: string;
  scanNow: (dataStoreId: string) => string;
  checkNow: (dataStoreId: string) => string;
  scrubFinding: (findingId: string) => string;
  explainIssue: (issueId: string) => string;
  fixIssueWithAi: (issueId: string) => string;
  responseActions: (dataStoreId: string) => string;
  respond: (dataStoreId: string) => string;
} = {
  overview: "/data-security/overview",
  compliance: "/data-security/compliance",
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
  // YYYY-MM-DD, UTC.
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

export interface DataSecurityComplianceFramework
  extends ComplianceFrameworkResult {
  fullName: string;
  scope: string;
}

export interface DataSecurityComplianceResponse {
  frameworks: Array<DataSecurityComplianceFramework>;
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

export interface DataSecurityScrubResult {
  // "log" or "trace": which kind of scrub rule was made.
  signal: "log" | "trace";
  scrubRuleId: string;
  scrubRuleName: string;
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
