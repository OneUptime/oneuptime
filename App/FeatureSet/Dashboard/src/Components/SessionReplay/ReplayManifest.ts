import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  SessionReplayChunkManifestEntry,
  SessionReplayGap,
  SessionReplaySealedReason,
} from "Common/Types/Rum/SessionReplay";
import {
  readDtoBoolean,
  readDtoNumber,
  readDtoOptionalNumber,
  readDtoOptionalString,
  readDtoString,
  readDtoStringArray,
  readDtoStringMap,
  readDtoUnixMs,
} from "Common/Types/Rum/SessionReplayApi";
import type { ReplaySessionDetails } from "./ReplayCorrelationPanel";

/*
 * The /manifest response, mapped onto what the player needs.
 *
 * Moved out of SessionReplayPlayer.tsx so the parser is testable in a node
 * environment without a Replayer, and so the one place that knows the
 * wire shape ({ viewId, header, tabs, isChunkIndexTruncated }, gaps per
 * TAB because chunkIndex is minted per tab) is a pure function.
 *
 * Every additive field (WP-S2: startTimeUnixMs, identity, tags, counters,
 * firstChunkStartOffsetMs, per-chunk clickCount/url) is read defensively
 * so a manifest from an older server, a fixture or a cached response still
 * plays: absent means "not measured" (undefined / null), never 0, all the
 * way to the UI.
 */

export type SessionReplayManifestChunk = SessionReplayChunkManifestEntry;

export interface SessionReplayManifestTab {
  tabId: string;
  chunks: Array<SessionReplayManifestChunk>;
  gaps: Array<SessionReplayGap>;
  /*
   * Where this tab's footage begins on the session clock. From the
   * manifest when the server sends it, otherwise from the first chunk row;
   * null for a tab with no chunks at all.
   */
  firstChunkStartOffsetMs: number | null;
  /* Duration of the footage stored for this tab (last chunk end - first start). */
  durationMs: number;
}

/* Header counters the header strip and the empty states quote. */
export interface SessionReplayManifestCounts {
  chunkCount: number;
  missingChunkCount: number;
  eventCount: number;
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  pageCount: number;
  /* Additive: undefined when the server did not measure them. */
  clickCount: number | undefined;
  customEventCount: number | undefined;
  activeMs: number | undefined;
  firstErrorOffsetMs: number | undefined;
}

export interface SessionReplayManifest {
  /*
   * The audit row the manifest read just created. Every heartbeat advances
   * THIS row; the endpoint takes a viewId and nothing else identifies it.
   * Empty when the server could not make one.
   */
  viewId: string;
  sessionId: string;
  rumApplicationId: string;
  durationMs: number;
  isFinalized: boolean;
  sealedReason: string;
  /* True when the chunk index itself was cut short server-side. */
  isChunkIndexTruncated: boolean;
  tabs: Array<SessionReplayManifestTab>;
  /* Every tab's holes, so notices describe the whole recording. */
  gaps: Array<SessionReplayGap>;
  fidelityNotices: Array<string>;
  details: ReplaySessionDetails;
  counts: SessionReplayManifestCounts;
  /*
   * The session clock. null on a manifest that carries neither the numeric
   * field nor a parseable startTime - telemetry rows cannot be placed then,
   * and the rail says so rather than guessing.
   */
  startTimeUnixMs: number | null;
  endTimeUnixMs: number | null;
  clientReportedStartUnixMs: number | null;
  /* When the footage leaves retention; drives "expires in 6d" and the expired copy. */
  expiresAtUnixMs: number | null;
  routes: Array<string>;
  recorderCapabilities: Array<string>;
  tags: Record<string, string>;
}

function readBooleanLoose(row: JSONObject, key: string): boolean {
  return readDtoBoolean(row as Record<string, unknown>, key);
}

function parseManifestChunk(row: JSONObject): SessionReplayManifestChunk {
  const record: Record<string, unknown> = row as Record<string, unknown>;
  const chunk: SessionReplayManifestChunk = {
    chunkIndex: readDtoNumber(record, "chunkIndex"),
    tabId: readDtoString(record, "tabId"),
    chunkStartOffsetMs: readDtoNumber(record, "chunkStartOffsetMs"),
    chunkEndOffsetMs: readDtoNumber(record, "chunkEndOffsetMs"),
    eventCount: readDtoNumber(record, "eventCount"),
    hasFullSnapshot: readBooleanLoose(row, "hasFullSnapshot"),
    payloadBytes: readDtoNumber(record, "payloadBytes"),
    errorCount: readDtoNumber(record, "errorCount"),
    rageClickCount: readDtoNumber(record, "rageClickCount"),
    deadClickCount: readDtoNumber(record, "deadClickCount"),
    errorClickCount: readDtoNumber(record, "errorClickCount"),
    refreshRageCount: readDtoNumber(record, "refreshRageCount"),
    routeCount: readDtoNumber(record, "routeCount"),
  };

  /*
   * Optional on the wire type; only set when the server measured it, so
   * the timeline's activity lane can tell "0 clicks" from "not counted".
   */
  const clickCount: number | undefined = readDtoOptionalNumber(
    record,
    "clickCount",
  );

  if (clickCount !== undefined) {
    chunk.clickCount = clickCount;
  }

  const url: string | undefined = readDtoOptionalString(record, "url");

  if (url !== undefined) {
    chunk.url = url;
  }

  return chunk;
}

function parseGap(row: JSONObject): SessionReplayGap {
  const record: Record<string, unknown> = row as Record<string, unknown>;

  return {
    fromIndex: readDtoNumber(record, "fromIndex"),
    toIndex: readDtoNumber(record, "toIndex"),
    missingMs: readDtoNumber(record, "missingMs"),
  };
}

function sortChunks(
  chunks: Array<SessionReplayManifestChunk>,
): Array<SessionReplayManifestChunk> {
  return [...chunks].sort(
    (a: SessionReplayManifestChunk, b: SessionReplayManifestChunk): number => {
      return a.chunkIndex - b.chunkIndex;
    },
  );
}

function parseTab(row: JSONObject): SessionReplayManifestTab {
  const record: Record<string, unknown> = row as Record<string, unknown>;
  const chunkRows: JSONArray = (row["chunks"] as JSONArray) || [];
  const gapRows: JSONArray = (row["gaps"] as JSONArray) || [];
  const chunks: Array<SessionReplayManifestChunk> = sortChunks(
    chunkRows.map(parseManifestChunk),
  );

  const firstChunk: SessionReplayManifestChunk | undefined = chunks[0];
  const lastChunk: SessionReplayManifestChunk | undefined =
    chunks[chunks.length - 1];

  const serverFirstOffset: number | undefined = readDtoOptionalNumber(
    record,
    "firstChunkStartOffsetMs",
  );

  const firstChunkStartOffsetMs: number | null =
    serverFirstOffset !== undefined
      ? serverFirstOffset
      : firstChunk
        ? firstChunk.chunkStartOffsetMs
        : null;

  return {
    tabId: readDtoString(record, "tabId"),
    chunks: chunks,
    gaps: gapRows.map(parseGap),
    firstChunkStartOffsetMs: firstChunkStartOffsetMs,
    durationMs:
      firstChunk && lastChunk
        ? Math.max(
            0,
            lastChunk.chunkEndOffsetMs - firstChunk.chunkStartOffsetMs,
          )
        : 0,
  };
}

/*
 * Tabs in the order the end user opened them (first footage first), so
 * "Tab 1" is the tab the session started in. Chunkless tabs go last: they
 * are usually a duplicated tab that never flushed anything.
 */
function sortTabs(
  tabs: Array<SessionReplayManifestTab>,
): Array<SessionReplayManifestTab> {
  return [...tabs].sort(
    (a: SessionReplayManifestTab, b: SessionReplayManifestTab): number => {
      if (a.firstChunkStartOffsetMs === null) {
        return b.firstChunkStartOffsetMs === null ? 0 : 1;
      }

      if (b.firstChunkStartOffsetMs === null) {
        return -1;
      }

      return a.firstChunkStartOffsetMs - b.firstChunkStartOffsetMs;
    },
  );
}

export function parseManifest(data: JSONObject): SessionReplayManifest {
  const header: JSONObject = (data["header"] as JSONObject) || {};
  const headerRecord: Record<string, unknown> = header as Record<
    string,
    unknown
  >;
  const dataRecord: Record<string, unknown> = data as Record<string, unknown>;
  const tabRows: JSONArray = (data["tabs"] as JSONArray) || [];

  const tabs: Array<SessionReplayManifestTab> = sortTabs(tabRows.map(parseTab));

  /*
   * The numeric clock when the server sends it; the ISO string parsed
   * otherwise (older server). Both are server-clamped, so either is the
   * session's zero for placing telemetry rows.
   */
  const startTimeUnixMs: number | null =
    readDtoUnixMs(headerRecord, "startTimeUnixMs") ??
    readDtoUnixMs(headerRecord, "startTime") ??
    null;
  const endTimeUnixMs: number | null =
    readDtoUnixMs(headerRecord, "endTimeUnixMs") ??
    readDtoUnixMs(headerRecord, "endTime") ??
    null;

  /*
   * Identity is served ONLY behind the identity permission. The field's
   * absence must stay distinguishable from an empty label (anonymous):
   * null tells the header and the panel not to claim the session is
   * anonymous when the viewer merely may not know.
   */
  const hasIdentity: boolean = Object.prototype.hasOwnProperty.call(
    header,
    "identifiedUserLabel",
  );
  const identifiedUserLabel: string | null = hasIdentity
    ? readDtoString(headerRecord, "identifiedUserLabel")
    : null;
  const identifiedUserTraits: Record<string, string> | null =
    hasIdentity ||
    Object.prototype.hasOwnProperty.call(header, "identifiedUserTraits")
      ? readDtoStringMap(headerRecord, "identifiedUserTraits")
      : null;

  const tags: Record<string, string> = readDtoStringMap(headerRecord, "tags");
  const recorderCapabilities: Array<string> = readDtoStringArray(
    headerRecord,
    "recorderCapabilities",
  );
  const sealedReason: string = readDtoString(headerRecord, "sealedReason");
  const isFinalized: boolean = readBooleanLoose(header, "isFinalized");
  const durationMs: number = readDtoNumber(headerRecord, "durationMs");

  const details: ReplaySessionDetails = {
    entryUrl: readDtoString(headerRecord, "entryUrl"),
    exitUrl: readDtoString(headerRecord, "exitUrl"),
    browserName: readDtoString(headerRecord, "browserName"),
    browserVersion: readDtoString(headerRecord, "browserVersion"),
    osName: readDtoString(headerRecord, "osName"),
    deviceType: readDtoString(headerRecord, "deviceType"),
    countryCode: readDtoString(headerRecord, "countryCode"),
    identifiedUserLabel: identifiedUserLabel,
    identifiedUserTraits: identifiedUserTraits,
    tags: tags,
    maskingMode: readDtoString(headerRecord, "maskingMode"),
    consentState: readDtoString(headerRecord, "consentState"),
    triggerReason: readDtoString(headerRecord, "triggerReason"),
    recorderVersion: readDtoString(headerRecord, "recorderVersion"),
    rrwebVersion: readDtoString(headerRecord, "rrwebVersion"),
    recorderCapabilities: recorderCapabilities,
    viewportWidth: readDtoNumber(headerRecord, "viewportWidth"),
    viewportHeight: readDtoNumber(headerRecord, "viewportHeight"),
    clockSkewMs: readDtoNumber(headerRecord, "clockSkewMs"),
    payloadBytes: readDtoNumber(headerRecord, "payloadBytes"),
    startTime: readDtoString(headerRecord, "startTime"),
    endTime: readDtoString(headerRecord, "endTime"),
    durationMs: durationMs,
    sealedReason: sealedReason,
    isFinalized: isFinalized,
    traceIds: readDtoStringArray(headerRecord, "traceIds"),
    exceptionFingerprints: readDtoStringArray(
      headerRecord,
      "exceptionFingerprints",
    ),
  };

  return {
    viewId: readDtoString(dataRecord, "viewId"),
    sessionId: readDtoString(headerRecord, "sessionId"),
    rumApplicationId: readDtoString(headerRecord, "rumApplicationId"),
    durationMs: durationMs,
    isFinalized: isFinalized,
    sealedReason: sealedReason,
    isChunkIndexTruncated: readBooleanLoose(data, "isChunkIndexTruncated"),
    tabs: tabs,
    gaps: tabs.flatMap(
      (tab: SessionReplayManifestTab): Array<SessionReplayGap> => {
        return tab.gaps;
      },
    ),
    fidelityNotices: readDtoStringArray(headerRecord, "fidelityNotices"),
    details: details,
    counts: {
      chunkCount: readDtoNumber(headerRecord, "chunkCount"),
      missingChunkCount: readDtoNumber(headerRecord, "missingChunkCount"),
      eventCount: readDtoNumber(headerRecord, "eventCount"),
      errorCount: readDtoNumber(headerRecord, "errorCount"),
      rageClickCount: readDtoNumber(headerRecord, "rageClickCount"),
      deadClickCount: readDtoNumber(headerRecord, "deadClickCount"),
      errorClickCount: readDtoNumber(headerRecord, "errorClickCount"),
      refreshRageCount: readDtoNumber(headerRecord, "refreshRageCount"),
      pageCount: readDtoNumber(headerRecord, "pageCount"),
      clickCount: readDtoOptionalNumber(headerRecord, "clickCount"),
      customEventCount: readDtoOptionalNumber(headerRecord, "customEventCount"),
      activeMs: readDtoOptionalNumber(headerRecord, "activeMs"),
      firstErrorOffsetMs: readDtoOptionalNumber(
        headerRecord,
        "firstErrorOffsetMs",
      ),
    },
    startTimeUnixMs: startTimeUnixMs,
    endTimeUnixMs: endTimeUnixMs,
    clientReportedStartUnixMs:
      readDtoUnixMs(headerRecord, "clientReportedStartUnixMs") ?? null,
    expiresAtUnixMs: readDtoUnixMs(headerRecord, "expiresAtUnixMs") ?? null,
    routes: readDtoStringArray(headerRecord, "routes"),
    recorderCapabilities: recorderCapabilities,
    tags: tags,
  };
}

/* ---- Derived facts. ---- */

export function tabHasFootage(tab: SessionReplayManifestTab): boolean {
  return tab.chunks.some((chunk: SessionReplayManifestChunk): boolean => {
    return chunk.eventCount > 0;
  });
}

export function hasPlayableFootage(manifest: SessionReplayManifest): boolean {
  return manifest.tabs.some(tabHasFootage);
}

/*
 * The tab to open: the one the URL names when it has footage, otherwise
 * the first tab that does (not simply tabs[0]: a duplicated tab mints a
 * tabId before anything is flushed, and one tab's chunks can expire before
 * another's). Null when nothing in the session is playable.
 */
export function pickInitialTab(
  manifest: SessionReplayManifest,
  preferredTabId: string | null | undefined,
): SessionReplayManifestTab | null {
  if (preferredTabId) {
    const preferred: SessionReplayManifestTab | undefined = manifest.tabs.find(
      (tab: SessionReplayManifestTab): boolean => {
        return tab.tabId === preferredTabId && tabHasFootage(tab);
      },
    );

    if (preferred) {
      return preferred;
    }
  }

  return manifest.tabs.find(tabHasFootage) ?? null;
}

export function findTab(
  manifest: SessionReplayManifest,
  tabId: string,
): SessionReplayManifestTab | null {
  return (
    manifest.tabs.find((tab: SessionReplayManifestTab): boolean => {
      return tab.tabId === tabId;
    }) ?? null
  );
}

/*
 * The tab whose footage starts after `offsetMs`, for the "Continue in Tab
 * 2" chip when the active tab plays out while another has later footage.
 */
export function findTabContinuingAfter(
  manifest: SessionReplayManifest,
  activeTabId: string,
  offsetMs: number,
): SessionReplayManifestTab | null {
  let best: SessionReplayManifestTab | null = null;

  for (const tab of manifest.tabs) {
    if (tab.tabId === activeTabId || !tabHasFootage(tab)) {
      continue;
    }

    const lastChunk: SessionReplayManifestChunk | undefined =
      tab.chunks[tab.chunks.length - 1];

    /* Only a tab with footage the viewer has not watched out yet. */
    if (!lastChunk || lastChunk.chunkEndOffsetMs <= offsetMs) {
      continue;
    }

    if (
      !best ||
      (tab.firstChunkStartOffsetMs ?? 0) < (best.firstChunkStartOffsetMs ?? 0)
    ) {
      best = tab;
    }
  }

  return best;
}

/* Whole days of retention the footage had, from the header's two clocks. */
export function getRetentionDays(
  manifest: SessionReplayManifest,
): number | null {
  if (manifest.expiresAtUnixMs === null || manifest.startTimeUnixMs === null) {
    return null;
  }

  const days: number = Math.round(
    (manifest.expiresAtUnixMs - manifest.startTimeUnixMs) /
      (24 * 60 * 60 * 1000),
  );

  return days > 0 ? days : null;
}

/*
 * Why there is no footage to play, for the stage's empty state. The
 * header outlives the chunks under the metadata-only retention tier, so
 * a manifest with counts but no chunk rows is a normal outcome, and the
 * reason is on the manifest: sealedReason says whether the recording
 * was lost, and expiresAtUnixMs says whether it aged out.
 */
export type ReplayFootageAbsence =
  | { kind: "recording-lost" }
  | {
      kind: "expired";
      expiresAtUnixMs: number | null;
      retentionDays: number | null;
    }
  | { kind: "not-yet-uploaded" }
  | { kind: "none-stored" };

export function describeFootageAbsence(
  manifest: SessionReplayManifest,
  nowUnixMs: number,
): ReplayFootageAbsence | null {
  if (hasPlayableFootage(manifest)) {
    return null;
  }

  if (manifest.sealedReason === SessionReplaySealedReason.RecordingLost) {
    return { kind: "recording-lost" };
  }

  if (
    manifest.expiresAtUnixMs !== null &&
    manifest.expiresAtUnixMs <= nowUnixMs
  ) {
    return {
      kind: "expired",
      expiresAtUnixMs: manifest.expiresAtUnixMs,
      retentionDays: getRetentionDays(manifest),
    };
  }

  /* Chunks were counted but not one is in the index: they aged out. */
  if (manifest.counts.chunkCount > 0) {
    return {
      kind: "expired",
      expiresAtUnixMs: manifest.expiresAtUnixMs,
      retentionDays: getRetentionDays(manifest),
    };
  }

  /* A live header with nothing flushed yet: the recorder is still buffering. */
  if (!manifest.isFinalized) {
    return { kind: "not-yet-uploaded" };
  }

  return { kind: "none-stored" };
}

/* ---- The manifest request's failure modes. ---- */

/*
 * The read route answers a 404 with a message PREFIX that says which of
 * three very different things happened (WP-S2): the session never
 * existed here, its footage expired under retention, or it was erased by
 * a data-subject request. Each gets its own copy; anything else is an
 * ordinary, retryable failure.
 */
export type ReplayManifestFailure =
  | {
      kind: "expired";
      message: string;
      expiresAtIso: string | null;
      retentionDays: number | null;
    }
  | { kind: "erased"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "error"; message: string; isRetryable: boolean };

const EXPIRED_PREFIX: string = "expired:";
const ERASED_PREFIX: string = "erased:";
const NOT_FOUND_PREFIX: string = "not-found:";

/* "expired on 2026-09-01T00:00:00.000Z under the application's 7-day retention" */
const EXPIRED_DETAILS: RegExp =
  /expired on (\S+) under the application's (\d+)-day retention/;

function stripPrefix(message: string, prefix: string): string {
  return message.slice(prefix.length).trim();
}

export function classifyManifestFailure(error: unknown): ReplayManifestFailure {
  let message: string = "";
  let statusCode: number | null = null;

  if (error instanceof HTTPErrorResponse) {
    message = error.message || "";
    statusCode = error.statusCode;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  }

  const trimmed: string = message.trim();

  if (trimmed.startsWith(EXPIRED_PREFIX)) {
    const details: RegExpMatchArray | null = trimmed.match(EXPIRED_DETAILS);
    const retentionDays: number = details ? Number(details[2]) : NaN;

    return {
      kind: "expired",
      message: stripPrefix(trimmed, EXPIRED_PREFIX),
      expiresAtIso: details && details[1] ? details[1] : null,
      retentionDays: Number.isFinite(retentionDays) ? retentionDays : null,
    };
  }

  if (trimmed.startsWith(ERASED_PREFIX)) {
    return { kind: "erased", message: stripPrefix(trimmed, ERASED_PREFIX) };
  }

  if (trimmed.startsWith(NOT_FOUND_PREFIX) || statusCode === 404) {
    return {
      kind: "not-found",
      message: trimmed.startsWith(NOT_FOUND_PREFIX)
        ? stripPrefix(trimmed, NOT_FOUND_PREFIX)
        : trimmed || "No session replay exists with this id in this project.",
    };
  }

  if (statusCode === 401 || statusCode === 403) {
    return {
      kind: "forbidden",
      message:
        trimmed ||
        "You do not have permission to watch recordings for this application.",
    };
  }

  return {
    kind: "error",
    message: trimmed || "The recording's index could not be loaded.",
    isRetryable: true,
  };
}
