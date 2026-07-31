import SessionReplayConsentMode from "./SessionReplayConsentMode";
import SessionReplayMaskingMode from "./SessionReplayMaskingMode";
import SessionReplayTriggerReason from "./SessionReplayTriggerReason";

/*
 * Wire contract between the browser (and later mobile) recorder and the
 * session-replay ingest endpoint.
 *
 * Both sides of this file are load-bearing: the recorder is bundled and
 * served to third-party origins, so a customer's browser may be running
 * an older recorder than the server it posts to for as long as the
 * pinned-artifact cache lives. Every field here is therefore additive-only,
 * and SESSION_REPLAY_WIRE_VERSION is bumped for anything else.
 */

/* Bumped only on a breaking change to the envelope or the frame layout. */
export const SESSION_REPLAY_WIRE_VERSION: number = 1;

/*
 * Bumped when the *payload* (the rrweb event array) changes shape in a
 * way playback must branch on. Stored per chunk so a player can refuse
 * gracefully instead of rendering a plausible-but-wrong DOM.
 */
export const SESSION_REPLAY_SCHEMA_VERSION: number = 1;

/*
 * Cap on a single POST body, post-compression. Enforced by the ingest
 * middleware's running byte counter and mirrored by nginx's
 * client_max_body_size on the /session-replay location. This is per
 * REQUEST, not per frame — a catch-up post carrying several frames is
 * bounded by this same number.
 */
export const MAX_SESSION_REPLAY_CHUNK_BYTES: number = 2 * 1024 * 1024;

/* Frames a single catch-up request may concatenate. */
export const MAX_SESSION_REPLAY_CHUNKS_PER_REQUEST: number = 8;

/*
 * Hard stop per session. At the 15s flush cadence this is ~2 hours of
 * continuous recording, comfortably past the 4-hour session cap once
 * idle gaps are accounted for. Prevents one pathological tab from
 * writing unbounded rows under a single sort-key prefix.
 */
export const MAX_SESSION_REPLAY_CHUNKS_PER_SESSION: number = 480;

/* Chunks a single playback request may ask for, and their total size. */
export const MAX_SESSION_REPLAY_CHUNKS_PER_READ: number = 8;
export const MAX_SESSION_REPLAY_READ_BYTES: number = 8 * 1024 * 1024;

/*
 * Default for the instance-wide per-project daily byte budget. The live
 * value is the SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY env var; this
 * default is shared between the ingest gate (App Telemetry Config) and the
 * Dashboard-facing ingest-status endpoint so the number the gate enforces
 * and the number the customer is shown cannot drift.
 */
export const DEFAULT_SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY: number =
  1024 * 1024 * 1024;

/*
 * Recorder flush triggers. A chunk closes on whichever comes first.
 * SESSION_REPLAY_CHECKOUT_INTERVAL_MS is also the worst-case seek
 * granularity, since seeking rewinds to the nearest full snapshot.
 */
export const SESSION_REPLAY_FLUSH_INTERVAL_MS: number = 15 * 1000;
export const SESSION_REPLAY_FLUSH_BYTES: number = 256 * 1024;
export const SESSION_REPLAY_CHECKOUT_INTERVAL_MS: number = 60 * 1000;

/*
 * Rolling pre-roll buffer held in memory before a trigger fires, and the
 * hard byte ceiling on it. The ceiling matters more than the duration:
 * a heavily dynamic page can blow through 2MB in well under 60s, and a
 * recorder that OOMs the host page is worse than no recorder.
 */
export const SESSION_REPLAY_ROLLING_BUFFER_MS: number = 60 * 1000;
export const SESSION_REPLAY_ROLLING_BUFFER_BYTES: number = 2 * 1024 * 1024;

/* Session identity lifetimes. */
export const SESSION_REPLAY_IDLE_ROLLOVER_MS: number = 30 * 60 * 1000;
export const SESSION_REPLAY_MAX_SESSION_MS: number = 4 * 60 * 60 * 1000;

/*
 * fetch(keepalive) quota is 64KB combined per origin across all in-flight
 * keepalive requests, so the terminal flush gets one request under this
 * cap rather than several that would silently fail against the quota.
 */
export const SESSION_REPLAY_KEEPALIVE_MAX_BYTES: number = 56 * 1024;

/*
 * Consecutive transport failures before the recorder permanently
 * self-disables and releases its buffer. A recorder that retries forever
 * against a misconfigured origin is a battery and bandwidth bug on the
 * customer's site.
 */
export const SESSION_REPLAY_MAX_FLUSH_FAILURES: number = 3;

/* Content type carried on every chunk POST. */
export const SESSION_REPLAY_CONTENT_TYPE: string =
  "application/vnd.oneuptime.session-replay.v1";

/* Header carrying the RUM application identifier, needed pre-decode. */
export const SESSION_REPLAY_APP_IDENTIFIER_HEADER: string =
  "x-oneuptime-app-identifier";

/*
 * Header carrying the host page's end-user reference on the CONFIG fetch,
 * URI-component-encoded so a non-ASCII reference cannot make fetch() throw
 * and take the whole recorder down with it. Only sent when the page
 * provided a userRef, and only used server-side to answer one question:
 * "is there a pending record-next-session target for this user?". A header
 * rather than a query parameter so it can never land in access logs.
 */
export const SESSION_REPLAY_USER_REF_HEADER: string = "x-oneuptime-user-ref";

/*
 * How long a "record the next session for this user" target waits for
 * that user to show up before expiring, and the cap on the reference
 * length accepted from either side (dashboard or config fetch).
 */
export const SESSION_REPLAY_TARGET_TTL_SECONDS: number = 24 * 60 * 60;
export const SESSION_REPLAY_MAX_USER_REF_LENGTH: number = 512;

/*
 * Retention values a session may be clamped to. Under expiry-based
 * partitioning each distinct value creates its own partition per ingest
 * day, so this is deliberately a short closed set rather than a free
 * integer.
 */
export const SESSION_REPLAY_ALLOWED_RETENTION_DAYS: Array<number> = [
  1, 7, 14, 30, 90,
];

/*
 * 7 days, not the 15 the other telemetry pillars default to. Replay is
 * the highest-sensitivity and highest-byte pillar, and a short retention
 * is itself a privacy control.
 */
export const DEFAULT_SESSION_REPLAY_RETENTION_IN_DAYS: number = 7;

/* How the payload bytes were compressed by the recorder. */
export type SessionReplayPayloadEncoding = "gzip" | "identity";

/* Which recorder produced the frame — web DOM, or a mobile view tree. */
export type SessionReplayRecorderKind = "dom" | "rn-view-tree";

/* State of the consent handshake at the moment the chunk was cut. */
export type SessionReplayConsentState = "Granted" | "NotRequired" | "Unknown";

/*
 * Instruction handed back to a live recorder on every chunk response, so
 * a project or application that is switched off stops *recording* within
 * one flush window instead of waiting out the config cache.
 */
export type SessionReplayDirective = "continue" | "stop" | "throttle";

/*
 * Machine-readable disclosures of what the recorder could not capture.
 * Surfaced on the player so a viewer sees "this region was not recorded"
 * rather than a silent blank rectangle — in a tool that presents evidence,
 * an unexplained gap is worse than an acknowledged one.
 */
export enum SessionReplayFidelityNotice {
  CanvasNotRecorded = "canvas-not-recorded",
  CrossOriginIframe = "cross-origin-iframe",
  ClosedShadowRoot = "closed-shadow-root",
  StylesheetInaccessible = "stylesheet-inaccessible",
  AdoptedStylesheet = "adopted-stylesheet",
  FontsOmitted = "fonts-omitted",
  MediaNotReplayable = "media-not-replayable",
  SnapshotTooLarge = "snapshot-too-large",
  BufferOverflow = "buffer-overflow",
  BfcacheRestore = "bfcache-restore",
  /*
   * One or more configured ignoreErrorPatterns could not be applied
   * (invalid regex, or over the count/length caps), so error triggering
   * may be noisier than the application's settings intend.
   */
  IgnorePatternsDiscarded = "ignore-patterns-discarded",
}

/* Why a session stopped accumulating chunks. */
export enum SessionReplaySealedReason {
  FinalChunk = "final-chunk",
  IdleTimeout = "idle-timeout",
  DurationCap = "duration-cap",
  Budget = "budget",
  Truncated = "truncated",
  /*
   * Sealed by the never-finalized sweep for a session whose chunks never
   * landed or expired before finalization could run: the header survives
   * as an honest "a recording existed but was lost" record instead of
   * sitting provisional (and re-swept) forever.
   */
  RecordingLost = "recording-lost",
}

/*
 * Per-chunk frustration and volume counters. Carried on the envelope so
 * the ingest worker can populate the header columns WITHOUT decompressing
 * the payload, which is what keeps the hot path cheap.
 */
export interface SessionReplaySignalCounts {
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  routeCount: number;
}

/*
 * Device and entry metadata. Sent only on chunk 0 and on the final chunk
 * — repeating it on every frame would be pure waste, and the finalizer
 * reads whichever copy arrived.
 */
export interface SessionReplayChunkMeta {
  entryUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  viewportWidth: number;
  viewportHeight: number;
  /*
   * Opaque reference for the identified end user, supplied by the host
   * page. Hashed to identifiedUserKey server-side with a per-project
   * salt; the raw value is only ever stored when the application has
   * explicitly enabled user-identity capture.
   */
  identifiedUserRef?: string;
}

/*
 * The JSON envelope prefixed to every chunk body, separated from the
 * compressed payload by a single newline. Kept in the body rather than
 * spread across custom headers: extra request headers widen the CORS
 * preflight surface, and splitting on the first 0x0A byte plus parsing a
 * ~200 byte JSON object costs microseconds.
 */
export interface SessionReplayChunkEnvelope {
  /* Wire version. Rejected outright if it exceeds what the server knows. */
  v: number;

  appIdentifier: string;
  sessionId: string;

  /*
   * Distinguishes concurrent tabs. sessionStorage is COPIED on tab
   * duplication, so two live tabs can share one sessionId and both mint
   * chunkIndex from 0 — without tabId in the sort key one tab's entire
   * stream is silently discarded by read-time dedup.
   */
  tabId: string;

  chunkIndex: number;

  /* Client clocks. Both retained; the server clamps and records the skew. */
  sessionStartUnixMs: number;
  clientSendUnixMs: number;

  chunkStartOffsetMs: number;
  chunkEndOffsetMs: number;

  eventCount: number;

  /*
   * True when this chunk opens on a full DOM snapshot, making it a valid
   * seek anchor. Driven by rrweb's isCheckout flag rather than inferred.
   */
  hasFullSnapshot: boolean;

  isFinal: boolean;

  /*
   * A full snapshot is one indivisible rrweb event and can exceed the
   * flush threshold on a large DOM. When split, hasFullSnapshot is set
   * only on the final part, so seek anchors never point mid-snapshot.
   */
  snapshotPart?: {
    index: number;
    total: number;
  };

  recorderKind: SessionReplayRecorderKind;
  schemaVersion: number;
  rrwebVersion: string;
  recorderVersion: string;

  maskingMode: SessionReplayMaskingMode;
  consentState: SessionReplayConsentState;
  triggerReason: SessionReplayTriggerReason;

  payloadEncoding: SessionReplayPayloadEncoding;
  payloadBytes: number;

  /* Already scrubbed client-side: origin + path, no query, no fragment. */
  url: string;

  signals: SessionReplaySignalCounts;

  fidelityNotices: Array<string>;

  /*
   * Recorder self-reporting. A recorder that silently drops events is
   * indistinguishable from a quiet user, so it tells on itself.
   */
  droppedEvents: number;
  flushFailures: number;

  meta?: SessionReplayChunkMeta;

  /* Trace ids observed in this chunk's network events, for correlation. */
  traceIds?: Array<string>;
}

/*
 * Policy snapshot handed to the recorder at startup. This endpoint is
 * what makes every server-side privacy control reachable by a live
 * recorder — without it, flipping a masking setting would never take
 * effect in a browser that already loaded.
 */
export interface SessionReplayConfigResponse {
  enabled: boolean;

  /* Pinned immutable artifact the loader stub should import. */
  recorderVersion: string;

  maskingMode: SessionReplayMaskingMode;
  captureTrigger: string;
  consentMode: SessionReplayConsentMode;

  samplePercentage: number;

  maskSelectors: Array<string>;
  blockSelectors: Array<string>;

  /* Query parameters that survive URL scrubbing. */
  urlAllowlist: Array<string>;

  recordCanvas: boolean;
  captureUserIdentity: boolean;

  /*
   * Regex strings matched (case-insensitively) against an uncaught
   * error's message and source URL. A matching error is still RECORDED in
   * the session, but it no longer fires the error capture trigger — the
   * dashboard-side remedy for a chronically-throwing third-party tag that
   * would otherwise convert error-triggered capture into always-on
   * upload, without waiting on a recorder release.
   */
  ignoreErrorPatterns: Array<string>;

  /*
   * ---- Fields below are OPTIONAL on the wire, deliberately. ----
   *
   * The loader stub validates this response field-by-field and lives
   * under a hard byte budget; fields only the full recorder artifact acts
   * on are not worth loader bytes to validate. The stub passes the raw
   * body through (LoaderConfig.raw) and the artifact normalises these
   * itself, treating absence as "feature off". The server always sends
   * them (pinned by tests); older cached stubs simply don't validate
   * them, which is the additive-only contract working as intended.
   */

  /*
   * Origins the recorder may inject a W3C traceparent header into, so a
   * recording links to the backend trace of the request that failed —
   * with NO OTel browser instrumentation on the customer's page.
   *
   * Empty means never inject, and that default is the safety mechanism:
   * adding a request header turns a simple cross-origin request into a
   * preflighted one, and an API that does not allow traceparent in
   * Access-Control-Allow-Headers would start failing because a RUM
   * script was installed. Each listed origin is an explicit statement
   * that its API accepts the header.
   */
  tracePropagationOrigins?: Array<string>;

  /*
   * Performance capture budgets, milliseconds; 0 disables that trigger.
   * Exceeding a budget fires the Performance capture trigger, so slow
   * sessions get recordings the same way broken ones do.
   */
  lcpBudgetMs?: number;
  longTaskBudgetMs?: number;
  slowRequestBudgetMs?: number;

  /*
   * True when this recorder boot matched a "record the next session for
   * this user" target set from the Dashboard. The recorder records from
   * the first event, trigger reason "manual". Consent gates still apply.
   */
  isTargeted?: boolean;

  respectDoNotTrack: boolean;

  /*
   * Bumped whenever the policy changes, so a recorder can notice its
   * config is stale without diffing the whole object.
   */
  configEpoch: number;

  directive: SessionReplayDirective;
}

/* Response to a chunk POST. Deliberately tiny. */
export interface SessionReplayChunkResponse {
  directive: SessionReplayDirective;
  configEpoch: number;
  retryAfterSeconds?: number;
  /*
   * WHY the directive says what it says ("budget-exhausted",
   * "not-sampled", "rate-limited", ...). A recorder told to stop without a
   * reason leaves the customer diagnosing silence; the reason string is a
   * closed vocabulary, carries no user data, and lets the recorder log
   * something a support ticket can quote.
   */
  reason?: string;
}

/*
 * One row of the playback manifest — everything the player needs to draw
 * a complete timeline WITHOUT fetching a single payload byte.
 */
export interface SessionReplayChunkManifestEntry {
  chunkIndex: number;
  tabId: string;
  chunkStartOffsetMs: number;
  chunkEndOffsetMs: number;
  eventCount: number;
  hasFullSnapshot: boolean;
  payloadBytes: number;

  /*
   * Per-chunk signal counters. These feed the player's error, frustration
   * and route timeline lanes and the "next error" jump — a lane drawn from
   * counters the chunk row already carries, never inferred from payloads.
   */
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  routeCount: number;
}

/* A hole in the chunk sequence. Never crossed silently during playback. */
export interface SessionReplayGap {
  fromIndex: number;
  toIndex: number;
  missingMs: number;
}
