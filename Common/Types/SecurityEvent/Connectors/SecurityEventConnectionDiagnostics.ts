import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "./ConnectorDiagnostics";

/*
 * Run bookkeeping for the Security Event Connections framework. Mirrors
 * GoogleSecOpsDiagnostics.ts on purpose: the diagnostics UI and the run
 * executor treat the two families the same way, and a customer who has
 * both should not have to learn two vocabularies.
 */

export type SecurityEventConnectionRunType =
  | "test"
  | "poll"
  | "preview"
  | "backfill";

export type SecurityEventConnectionRunStatus =
  | "queued"
  | "running"
  | "success"
  | "empty"
  | "partial"
  | "failed";

export interface SecurityEventConnectionRunOptions {
  type: SecurityEventConnectionRunType;
  runId?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
}

export interface SecurityEventConnectionRunResult {
  type: SecurityEventConnectionRunType;
  provider: string;
  runId?: string | undefined;
  status: SecurityEventConnectionRunStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  windowStart: string;
  windowEnd: string;
  // Records returned by the source before normalization.
  fetchedCount: number;
  // Rows written to the security event store.
  ingestedCount: number;
  // Records already stored under the same source identifier.
  duplicateCount: number;
  // Records the connector did not recognize as events.
  rejectedCount: number;
  // Records that failed normalization.
  failedCount: number;
  // False when a bound or a partial response left part of the window unread.
  complete: boolean;
  requestCount: number;
  warnings: Array<string>;
  samples: Array<SecurityConnectorSample>;
  checks: Array<SecurityConnectorCheck>;
  eventTimeStart?: string | undefined;
  eventTimeEnd?: string | undefined;
  error?: string | undefined;
}
