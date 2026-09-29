import { JSONObject } from "../../JSON";
import {
  SecurityConnectorCheck,
  SecurityConnectorSample,
} from "./ConnectorDiagnostics";

/*
 * Run bookkeeping for the Security Event Connections framework, shared by
 * every provider including Google SecOps (which had its own copy of these
 * types until it moved into the framework).
 */

/*
 * The event attribute a poll stamps with the connection id, so "View
 * events" can open exactly the rows one connection imported.
 */
export const SECURITY_CONNECTION_ID_ATTRIBUTE: string =
  "oneuptime.security_connection.id";
/*
 * The attribute the retired Google SecOps connector stamped instead. Runs
 * carried over from it name this key in eventAttributeKey, because the
 * events they imported were written before the move.
 */
export const LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE: string =
  "oneuptime.google_secops.connection_id";

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
  /*
   * Adaptive catch-up, scheduled polls only. chunkMinutes is the minutes of
   * creation time this poll read past the saved cursor (from the window
   * start when there was no usable cursor); the overlap before the cursor is
   * not counted. nextChunkMinutes is the chunk the next scheduled poll is
   * given. A poll that could not read its window halves it (or, when the
   * source reads in ascending creation order, resumes from the last record
   * read); a complete poll never shrinks it and doubles it back towards the
   * 24 hour maximum; a failed poll keeps it. forcedAdvance records a one
   * minute window that still could not be read completely and was skipped
   * past so polling keeps moving.
   */
  chunkMinutes?: number | undefined;
  nextChunkMinutes?: number | undefined;
  forcedAdvance?: boolean | undefined;
  /*
   * ISO time no scheduled window may start before. Set to the window end of
   * a forced advance and carried forward while cursor minus the provider's
   * overlap is still earlier than it: without it, a 15 or 30 minute overlap
   * drags every following window back over the minute that overflowed,
   * each of those polls overflows on the same records, and polling skips
   * one more minute per poll for the whole overlap.
   */
  overlapFloor?: string | undefined;
  /*
   * Provider-specific diagnostics the connector reported for this fetch
   * (ConnectorFetchResult.details), e.g. Google SecOps's per-pass counts,
   * the time basis read and creation-lag statistics. Never credentials.
   */
  providerDetails?: JSONObject | undefined;
  /*
   * The event attribute the imported rows carry the connection id under.
   * Absent means SECURITY_CONNECTION_ID_ATTRIBUTE; runs carried over from
   * the retired Google SecOps connector name its legacy attribute.
   */
  eventAttributeKey?: string | undefined;
}
