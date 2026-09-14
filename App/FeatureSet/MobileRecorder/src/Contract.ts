/*
 * Build-time copy of the pure session-replay wire contract. This package is
 * installed in customer React Native applications and must not pull the
 * OneUptime monorepo's Common package into their bundle. Contract-parity
 * tests compare these additive constants with Common in the repository.
 */

export const SESSION_REPLAY_WIRE_VERSION: number = 1;
export const SESSION_REPLAY_SCHEMA_VERSION: number = 1;
export const SESSION_REPLAY_CONTENT_TYPE: string =
  "application/vnd.oneuptime.session-replay.v1";
export const SESSION_REPLAY_APP_IDENTIFIER_HEADER: string =
  "x-oneuptime-app-identifier";
export const SESSION_REPLAY_RECORDER_KIND_HEADER: string =
  "x-oneuptime-replay-recorder-kind";
export const SESSION_REPLAY_MOBILE_APP_IDENTIFIER_HEADER: string =
  "x-oneuptime-mobile-app-identifier";
export const SESSION_REPLAY_USER_REF_HEADER: string = "x-oneuptime-user-ref";
export const SESSION_REPLAY_MAX_USER_REF_LENGTH: number = 512;
export const AUTH_TOKEN_HEADER: string = "x-oneuptime-token";

export const CONFIG_PATH: string = "/telemetry/session-replay/v1/config";
export const CHUNK_PATH: string = "/telemetry/session-replay/v1/chunk";
export const SESSION_REPLAY_FLUSH_INTERVAL_MS: number = 15_000;
export const SESSION_REPLAY_FLUSH_BYTES: number = 256 * 1024;
export const SESSION_REPLAY_CHECKOUT_INTERVAL_MS: number = 60_000;
export const SESSION_REPLAY_ROLLING_BUFFER_MS: number = 60_000;
export const SESSION_REPLAY_ROLLING_BUFFER_BYTES: number = 2 * 1024 * 1024;
export const SESSION_REPLAY_IDLE_ROLLOVER_MS: number = 30 * 60_000;
export const SESSION_REPLAY_MAX_SESSION_MS: number = 4 * 60 * 60_000;
export const SESSION_REPLAY_MAX_DECOMPRESSED_FRAME_BYTES: number =
  8 * 1024 * 1024;
export const MAX_SESSION_REPLAY_CHUNK_BYTES: number = 2 * 1024 * 1024;
export const MAX_SESSION_REPLAY_CHUNKS_PER_SESSION: number = 480;
export const MOBILE_CAPTURE_INTERVAL_MS: number = 500;
type MobileRecorderKind = "rn-view-tree";
export const MOBILE_RECORDER_KIND: MobileRecorderKind = "rn-view-tree";
export const SYNTHETIC_RRWEB_VERSION: string = "synthetic-1";

declare const __ONEUPTIME_MOBILE_RECORDER_VERSION__: string;

export const RECORDER_VERSION: string =
  typeof __ONEUPTIME_MOBILE_RECORDER_VERSION__ === "string"
    ? __ONEUPTIME_MOBILE_RECORDER_VERSION__
    : "0.0.0-dev";

export const SESSION_REPLAY_MOBILE_RECORDER_CAPABILITIES: ReadonlyArray<string> =
  [
    "mobile-view-tree",
    "mobile-touch-events",
    "custom-events",
    "traits",
    "tags",
    "visibility",
    "visitor-id",
    "route-events",
    "js-errors",
  ];

export enum SessionReplayMaskingMode {
  MaskSensitiveInputsOnly = "MaskSensitiveInputsOnly",
  MaskInputsOnly = "MaskInputsOnly",
  MaskAllText = "MaskAllText",
}

export enum SessionReplayConsentMode {
  RequireExplicit = "RequireExplicit",
  NotRequired = "NotRequired",
}

export enum SessionReplayCaptureTrigger {
  Always = "Always",
  OnErrorOrFrustration = "OnErrorOrFrustration",
}

export enum SessionReplayTriggerReason {
  Error = "error",
  Frustration = "frustration",
  Sampled = "sampled",
  Manual = "manual",
  Performance = "performance",
}

export enum SessionReplayFidelityNotice {
  MobileImagesOpaque = "mobile-images-opaque",
  MobileWebViewOpaque = "mobile-webview-opaque",
  MobileCanvasOpaque = "mobile-canvas-opaque",
  MobileAnimationSampled = "mobile-animation-sampled",
  BufferOverflow = "buffer-overflow",
  SnapshotTooLarge = "snapshot-too-large",
}

export type SessionReplayConsentState = "Granted" | "NotRequired" | "Unknown";
export type SessionReplayDirective = "continue" | "stop" | "throttle";
export type SessionReplayPayloadEncoding = "gzip" | "identity";
export type SessionReplayRecorderKind = "dom" | "rn-view-tree";

export interface SessionReplayConfigResponse {
  enabled: boolean;
  recorderVersion: string;
  maskingMode: SessionReplayMaskingMode;
  captureTrigger: string;
  consentMode: SessionReplayConsentMode;
  samplePercentage: number;
  maskSelectors: Array<string>;
  blockSelectors: Array<string>;
  urlAllowlist: Array<string>;
  recordCanvas: boolean;
  captureUserIdentity: boolean;
  ignoreErrorPatterns: Array<string>;
  respectDoNotTrack: boolean;
  configEpoch: number;
  directive: SessionReplayDirective;
  isTargeted?: boolean;
  disabledReason?: string;
  disabledDetail?: string;
  budgetResetsAt?: string;
  debug?: boolean;
}

export interface SessionReplaySignalCounts {
  errorCount: number;
  rageClickCount: number;
  deadClickCount: number;
  errorClickCount: number;
  refreshRageCount: number;
  routeCount: number;
  clickCount?: number;
  customEventCount?: number;
}

export interface SessionReplayChunkMeta {
  entryUrl: string;
  browserName: string;
  browserVersion: string;
  osName: string;
  deviceType: string;
  viewportWidth: number;
  viewportHeight: number;
  identifiedUserRef?: string;
  visitorId?: string;
  identifiedUserTraits?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface SessionReplayChunkEnvelope {
  v: number;
  appIdentifier: string;
  sessionId: string;
  tabId: string;
  chunkIndex: number;
  sessionStartUnixMs: number;
  clientSendUnixMs: number;
  chunkStartOffsetMs: number;
  chunkEndOffsetMs: number;
  eventCount: number;
  hasFullSnapshot: boolean;
  isFinal: boolean;
  recorderKind: SessionReplayRecorderKind;
  schemaVersion: number;
  rrwebVersion: string;
  recorderVersion: string;
  maskingMode: SessionReplayMaskingMode;
  consentState: SessionReplayConsentState;
  triggerReason: SessionReplayTriggerReason;
  payloadEncoding: SessionReplayPayloadEncoding;
  payloadBytes: number;
  url: string;
  routes?: Array<string>;
  signals: SessionReplaySignalCounts;
  fidelityNotices: Array<string>;
  droppedEvents: number;
  flushFailures: number;
  meta?: SessionReplayChunkMeta;
  capabilities?: Array<string>;
}

export interface SessionReplayChunkResponse {
  directive: SessionReplayDirective;
  configEpoch: number;
  retryAfterSeconds?: number;
  reason?: string;
}

export enum RrwebEventType {
  DomContentLoaded = 0,
  Load = 1,
  FullSnapshot = 2,
  IncrementalSnapshot = 3,
  Meta = 4,
  Custom = 5,
}

export enum RrwebIncrementalSource {
  Mutation = 0,
  MouseMove = 1,
  MouseInteraction = 2,
  Scroll = 3,
  ViewportResize = 4,
  Input = 5,
  TouchMove = 6,
}

export enum RrwebMouseInteractionType {
  TouchStart = 7,
  TouchEnd = 9,
}

export interface RrwebEvent<TData = unknown> {
  type: RrwebEventType;
  data: TData;
  timestamp: number;
}

export const ROUTE_CUSTOM_EVENT_TAG: string = "oneuptime.route";
export const ERROR_CUSTOM_EVENT_TAG: string = "oneuptime.error";
export const CUSTOM_EVENT_TAG: string = "oneuptime.custom";
export const IDENTIFY_CUSTOM_EVENT_TAG: string = "oneuptime.identify";
export const TAGS_CUSTOM_EVENT_TAG: string = "oneuptime.tags";
export const VISIBILITY_CUSTOM_EVENT_TAG: string = "oneuptime.visibility";
export const TOUCH_CUSTOM_EVENT_TAG: string = "oneuptime.touch";
