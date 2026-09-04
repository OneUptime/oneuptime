import {
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
} from "./SessionReplay";

/*
 * Wire contract between the Dashboard and the session-replay read routes
 * in Common/Server/API/TelemetryAPI.ts (/list, /manifest, /heartbeat,
 * /for-exception, /ingest-status). Everything here is the JSON as it
 * crosses HTTP, which is why:
 *
 *   - Dates are ISO-8601 STRINGS. The server builds Date objects
 *     (SessionReplayReadService) and Response.sendJsonObjectResponse
 *     serialises them; the Dashboard parsers have always read them back
 *     as strings (parseSessionReplaySummary). The *UnixMs numbers are
 *     additive siblings so the player can do clock arithmetic without
 *     re-parsing.
 *   - Every field added after the first release is OPTIONAL. The Dashboard
 *     is deployed with the server, but a manifest fixture, a cached
 *     response, or a self-hosted install mid-rollout can still present
 *     the old shape, and a parser that throws on a missing engagement
 *     counter would take the whole player down over a column that adds a
 *     badge. Absence means "not measured", and the UI renders that as
 *     unknown rather than 0.
 *   - Nothing here is a class. The Dashboard reads rows off untyped
 *     JSONObject bodies with the readDto* helpers at the bottom, which
 *     carry the same defensive semantics the player and table parsers
 *     were written with (UInt8 booleans as 0/1/"1", numeric strings).
 */

/* ---- /list ---- */

/*
 * Sort keys the list accepts. "frustration" sorts by the sum of the four
 * frustration counters, which is what the Frustration quick filter shows.
 */
export type SessionReplaySortBy =
  | "startTime"
  | "durationMs"
  | "errorCount"
  | "frustration";

export const SESSION_REPLAY_SORT_BY_VALUES: ReadonlyArray<SessionReplaySortBy> =
  ["startTime", "durationMs", "errorCount", "frustration"];

/*
 * Keyset cursor for the sorted list. sortValue is the numeric sort key of
 * the last row on the previous page (unix ms for startTime, a count or a
 * duration otherwise) and sessionId is the tiebreak.
 */
export interface SessionReplaySortedListCursorDto {
  sortBy: SessionReplaySortBy;
  sortValue: number;
  sessionId: string;
}

/*
 * The cursor shape the list has emitted since its first release. Still
 * accepted (as sortBy: "startTime") so a bookmarked page and an older
 * Dashboard keep paging; still emitted when sortBy is startTime so an
 * older Dashboard can read the response.
 */
export interface SessionReplayLegacyListCursorDto {
  startTimeUnixMs: number;
  sessionId: string;
}

export type SessionReplayListCursorDto =
  | SessionReplaySortedListCursorDto
  | SessionReplayLegacyListCursorDto;

export interface SessionReplayListFiltersDto {
  hasError?: boolean;
  hasFrustration?: boolean;
  isFinalized?: boolean;
  triggerReasons?: Array<string>;
  browserNames?: Array<string>;
  osNames?: Array<string>;
  deviceTypes?: Array<string>;
  countryCodes?: Array<string>;
  /*
   * The end-user reference the customer's page supplied; the server hashes
   * it. Silently dropped server-side unless the caller holds the identity
   * permission, and a 400 when unusable.
   */
  identifiedUserRef?: string;
  /* An already-derived digest, for API callers that hold one. */
  identifiedUserKey?: string;
  /* Exact route match against the routes array. */
  route?: string;
  minDurationMs?: number;

  /* ---- Additive filters. ---- */

  /*
   * Free text, capped at SESSION_REPLAY_LIST_SEARCH_MAX_LENGTH: sessionId
   * prefix, entry/exit URL and routes substring, exact trace id, and the
   * identified user label when the caller may read it. The server refuses
   * a search over more than SESSION_REPLAY_LIST_SEARCH_MAX_WINDOW_DAYS.
   */
  search?: string;
  /* startsWith over routes and the entry URL: "/checkout", or a full URL. */
  urlPrefix?: string;
  /* Every pair must match (hasAll over the session's tag map). */
  tags?: Record<string, string>;
  hasIdentifiedUser?: boolean;
  /* (not finalized OR has chunks) AND not recording-lost. */
  isPlayable?: boolean;
  hasTraces?: boolean;
}

export interface SessionReplayListRequestDto {
  rumApplicationId: string;
  /* ISO-8601. Defaults server-side to the past 7 days. */
  startTime?: string;
  endTime?: string;
  filters?: SessionReplayListFiltersDto;
  limit?: number;
  cursor?: SessionReplayListCursorDto;
  /* Additive. Absent means "startTime", which is what the list always did. */
  sortBy?: SessionReplaySortBy;
}

export interface SessionReplayListItemDto {
  sessionId: string;
  rumApplicationId: string;
  /* ISO-8601, server-clamped. */
  startTime: string;
  endTime: string;
  durationMs: number;
  isFinalized: boolean;
  sealedReason: string;
  chunkCount: number;
  maxChunkIndex: number;
  missingChunkCount: number;
  eventCount: number;
  payloadBytes: number;
  hasError: boolean;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;
  triggerReason: string;
  entryUrl: string;
  exitUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  viewportWidth: number;
  viewportHeight: number;
  identifiedUserKey: string;
  /* Present only when the caller holds the narrower identity permission. */
  identifiedUserLabel?: string;
  samplePercentageAtCapture: number;

  /* ---- Additive projections. ---- */

  /* First 5 routes, in order. */
  routes?: Array<string>;
  /* length(traceIds) - the header keeps at most 50 ids. */
  traceCount?: number;
  exceptionGroupCount?: number;
  clickCount?: number;
  /* Sum of chunk spans that carried user activity; 0 until finalized. */
  activeMs?: number;
  /* Offset of the first chunk with an error; 0 when there is none. */
  firstErrorOffsetMs?: number;
  /* argMax(retentionDate) as unix ms; drives "expires in 6d". */
  expiresAtUnixMs?: number;
  tags?: Record<string, string>;
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
  /* Identity-gated like identifiedUserLabel. */
  identifiedUserTraits?: Record<string, string>;
}

export interface SessionReplayListResponseDto {
  sessions: Array<SessionReplayListItemDto>;
  nextCursor: SessionReplayListCursorDto | null;
}

/* ---- /manifest ---- */

export interface SessionReplayManifestRequestDto {
  sessionId: string;
  /* Audit fields, written to the view row. */
  accessReason?: string;
  linkedIncidentId?: string;
  linkedExceptionFingerprint?: string;
  /*
   * Additive. A live-session poll: when true and viewId names a view row
   * that belongs to this caller and session, the server SKIPS recordView
   * and echoes the same viewId, so polling writes one audit row per view
   * rather than one per 30s. A mismatch falls back to a fresh recordView.
   */
  isRefresh?: boolean;
  viewId?: string;
}

/*
 * The session header exactly as SessionReplayReadService.getSessionHeader
 * builds it, serialised. The identity fields and the engagement counters
 * are additive.
 */
export interface SessionReplayManifestHeaderDto {
  sessionId: string;
  projectId: string;
  rumApplicationId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  isFinalized: boolean;
  sealedReason: string;
  chunkCount: number;
  maxChunkIndex: number;
  missingChunkCount: number;
  eventCount: number;
  payloadBytes: number;
  hasError: boolean;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;
  triggerReason: string;
  maskingMode: string;
  consentState: string;
  recorderKind: string;
  recorderVersion: string;
  rrwebVersion: string;
  schemaVersion: number;
  wireVersion: number;
  entryUrl: string;
  exitUrl: string;
  routes: Array<string>;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  countryCode: string;
  viewportWidth: number;
  viewportHeight: number;
  fidelityNotices: Array<string>;
  fullSnapshotChunkIndexes: Array<number>;
  traceIds: Array<string>;
  exceptionFingerprints: Array<string>;
  /* Client-minus-server, positive when the device runs ahead. */
  clockSkewMs: number;

  /* ---- Additive. ---- */

  /*
   * The session clock. Every telemetry row is placed on the timeline as
   * rowUnixMs - startTimeUnixMs, so this is a number rather than a
   * re-parsed ISO string.
   */
  startTimeUnixMs?: number;
  endTimeUnixMs?: number;
  /* The recorder's own start clock, before clamping. */
  clientReportedStartUnixMs?: number;
  tags?: Record<string, string>;
  expiresAtUnixMs?: number;
  clickCount?: number;
  customEventCount?: number;
  activeMs?: number;
  firstErrorOffsetMs?: number;
  /* Both present ONLY when the identity permission check passes. */
  identifiedUserLabel?: string;
  identifiedUserTraits?: Record<string, string>;
  /*
   * From chunk 0's envelope, so the player can say what an older recorder
   * could not capture. Empty for recordings that predate the field.
   */
  recorderCapabilities?: Array<string>;
}

export interface SessionReplayManifestTabDto {
  tabId: string;
  chunks: Array<SessionReplayChunkManifestEntry>;
  chunkIndexes: Array<number>;
  fullSnapshotChunkIndexes: Array<number>;
  gaps: Array<SessionReplayGap>;
  maxChunkIndex: number;
  totalPayloadBytes: number;
  /*
   * Additive. Where this tab's footage begins on the session clock, so the
   * tab pill can say "Tab 2 - 30s (opened 2:14)".
   */
  firstChunkStartOffsetMs?: number;
}

export interface SessionReplayManifestResponseDto {
  /* The audit row this read created; null only if no row could be made. */
  viewId: string | null;
  header: SessionReplayManifestHeaderDto;
  tabs: Array<SessionReplayManifestTabDto>;
  isChunkIndexTruncated: boolean;
}

/* ---- /heartbeat ---- */

export interface SessionReplayHeartbeatRequestDto {
  viewId: string;
  secondsWatched: number;
}

export interface SessionReplayHeartbeatResponseDto {
  /* Floored to the 15s cadence server-side. */
  secondsWatched: number;
}

/* ---- /for-exception ---- */

export interface SessionReplayForExceptionRequestDto {
  fingerprint: string;
  /* ISO-8601 bounds; the server scans every partition without them. */
  startTime?: string;
  endTime?: string;
  limit?: number;
}

export interface SessionReplayExceptionSessionDto {
  sessionId: string;
  rumApplicationId: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  hasError: boolean;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  maskingMode: string;
  triggerReason: string;
  entryUrl: string;
  browserName: string;
  osName: string;
  deviceType: string;
  isFinalized: boolean;
}

export interface SessionReplayForExceptionResponseDto {
  sessions: Array<SessionReplayExceptionSessionDto>;
  /* The accessible-application scan has a ceiling; true when it was hit. */
  isApplicationScopeTruncated: boolean;
}

/* ---- /ingest-status ---- */

export interface SessionReplayIngestStatusRequestDto {
  rumApplicationId: string;
}

/*
 * The response is the wire form of RecordingHealthStatus; see
 * Common/Types/Rum/SessionReplayHealth.ts, which owns it because the
 * health diagnosis is the only consumer.
 */

/* ---- Defensive row readers shared by the Dashboard parsers. ---- */

/*
 * Every route above answers a hand-written ClickHouse projection, not a
 * model serialisation, so nothing is trusted: numbers may arrive as
 * strings (ClickHouse quotes 64-bit integers in JSON), UInt8 booleans as
 * 0/1 or "0"/"1", and any field may be absent on an older server.
 */

/* A finite number, or 0. Use readDtoOptionalNumber when 0 would be a lie. */
export function readDtoNumber(
  row: Record<string, unknown>,
  key: string,
): number {
  const parsed: number = Number(row[key]);

  return Number.isFinite(parsed) ? parsed : 0;
}

/*
 * A finite number, or undefined when the field is absent, null, or not a
 * number. This is the reader for every additive counter: "not measured"
 * must stay distinguishable from "measured as zero" all the way to the UI.
 */
export function readDtoOptionalNumber(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value: unknown = row[key];

  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  const parsed: number = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function readDtoString(
  row: Record<string, unknown>,
  key: string,
): string {
  const value: unknown = row[key];

  return value === null || value === undefined ? "" : String(value);
}

/* A non-empty string, or undefined. */
export function readDtoOptionalString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value: unknown = row[key];

  if (typeof value === "string") {
    return value.length > 0 ? value : undefined;
  }

  return undefined;
}

/* ClickHouse UInt8 booleans arrive as 0/1, sometimes as the strings "0"/"1". */
export function readDtoBoolean(
  row: Record<string, unknown>,
  key: string,
): boolean {
  const value: unknown = row[key];

  return value === true || value === 1 || value === "1";
}

export function readDtoStringArray(
  row: Record<string, unknown>,
  key: string,
): Array<string> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry: unknown): string => {
    return String(entry);
  });
}

export function readDtoNumberArray(
  row: Record<string, unknown>,
  key: string,
): Array<number> {
  const value: unknown = row[key];

  if (!Array.isArray(value)) {
    return [];
  }

  const numbers: Array<number> = [];

  for (const entry of value) {
    const parsed: number = Number(entry);

    if (Number.isFinite(parsed)) {
      numbers.push(parsed);
    }
  }

  return numbers;
}

/*
 * A Map(String, String) column, serialised by ClickHouse as a JSON object.
 * Non-object values (including arrays) read as an empty map; values are
 * stringified so a numeric-looking tag still renders.
 */
export function readDtoStringMap(
  row: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value: unknown = row[key];
  const result: Record<string, string> = {};

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return result;
  }

  for (const entryKey of Object.keys(value as Record<string, unknown>)) {
    const entry: unknown = (value as Record<string, unknown>)[entryKey];

    if (entry === null || entry === undefined) {
      continue;
    }

    result[entryKey] = String(entry);
  }

  return result;
}

/*
 * An ISO-8601 timestamp as unix ms, or undefined when absent or
 * unparseable. Never 0: epoch is a real instant and would place a row at
 * 1970 on the timeline.
 */
export function readDtoUnixMs(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value: unknown = row[key];

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  const parsed: number = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

/*
 * True when the cursor carries the additive sort fields; false for the
 * legacy {startTimeUnixMs, sessionId} shape.
 */
export function isSessionReplaySortedListCursor(
  cursor: SessionReplayListCursorDto,
): cursor is SessionReplaySortedListCursorDto {
  return (
    typeof (cursor as SessionReplaySortedListCursorDto).sortBy === "string" &&
    typeof (cursor as SessionReplaySortedListCursorDto).sortValue === "number"
  );
}

/*
 * Read a cursor off an untyped body. The legacy shape is normalised to
 * sortBy "startTime" so callers have one branch to write. Returns null
 * when neither shape is present.
 */
export function parseSessionReplayListCursor(
  value: unknown,
): SessionReplaySortedListCursorDto | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row: Record<string, unknown> = value as Record<string, unknown>;
  const sessionId: string | undefined = readDtoOptionalString(row, "sessionId");

  if (!sessionId) {
    return null;
  }

  const sortBy: unknown = row["sortBy"];
  const sortValue: number | undefined = readDtoOptionalNumber(row, "sortValue");

  if (
    typeof sortBy === "string" &&
    (SESSION_REPLAY_SORT_BY_VALUES as ReadonlyArray<string>).includes(sortBy) &&
    sortValue !== undefined
  ) {
    return {
      sortBy: sortBy as SessionReplaySortBy,
      sortValue: sortValue,
      sessionId: sessionId,
    };
  }

  const startTimeUnixMs: number | undefined = readDtoOptionalNumber(
    row,
    "startTimeUnixMs",
  );

  if (startTimeUnixMs !== undefined) {
    return {
      sortBy: "startTime",
      sortValue: startTimeUnixMs,
      sessionId: sessionId,
    };
  }

  return null;
}
