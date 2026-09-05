import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import Config, { RECORDER_VERSION, RecorderInitOptions } from "./Config";
import Consent from "./Consent";
import {
  DebugRecord,
  debugLog,
  debugWarn,
  getDebugRecords,
  setEnabled,
} from "./Debug";
import { EarlyErrorRecord } from "./EarlyErrors";
import Recorder, {
  RecorderDecisions,
  RecorderState,
  RecorderStopReason,
  SessionChangeListener,
} from "./Recorder";

/*
 * Entry point for the PINNED artifact, bundled as an IIFE under the global
 * OneUptimeReplay.
 *
 * The loader stub (src/Loader.ts) is what a customer's page actually
 * references. It fetches the policy, honours enabled / consent / DNT / GPC,
 * and only then loads this file - which is why a bad masking release can be
 * rolled back by changing one config field instead of waiting out a
 * year-long immutable cache.
 *
 * This file can also be loaded directly by a customer self-hosting the
 * bundle, in which case start() does the config fetch itself.
 */

/*
 * Commands queued by the page before the artifact finished loading. The
 * pattern every analytics snippet uses, and it matters here: the host page's
 * consent banner may resolve before a ~50 KB script does, and dropping that
 * grant would mean recording a session we are never allowed to upload.
 *
 * Entries are arrays: [command, ...arguments], e.g. ["identify", ref,
 * traits], ["track", name, properties], ["setTags", tags], ["addTag", key,
 * value], ["captureSession", reason], ["onSessionChange", callback].
 */
const COMMAND_QUEUE_GLOBAL: string = "OneUptimeReplayQueue";

/* Set by the loader so a directly loaded artifact does not double-start. */
const BOOTSTRAP_FLAG_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_STARTED__";

export type SessionReplayTraits = Record<string, string | number | boolean>;

export interface SessionReplayApi {
  version: string;

  /*
   * Called by the loader with an already-validated policy, plus whatever
   * errors its pre-load buffer caught while the artifact was downloading.
   * The third argument is optional so an OLDER cached stub calling a
   * newer artifact (or vice versa) keeps working — additive-only is the
   * rule for this contract.
   */
  bootstrap: (
    initOptions: RecorderInitOptions,
    config: SessionReplayConfigResponse,
    earlyErrors?: Array<EarlyErrorRecord>,
  ) => void;

  /* Self-service entry point for a page that hosts the bundle itself. */
  start: (initOptions?: RecorderInitOptions) => Promise<void>;

  /* Force an upload of this session; the reason lands on the timeline. */
  captureSession: (reason?: string) => void;
  grantConsent: () => void;
  revokeConsent: () => void;

  /*
   * Who this session belongs to. Traits (plan, role, tenant) are capped,
   * stringified and masked before they leave the page, and neither the
   * reference nor the traits is sent unless the application has
   * user-identity capture switched on.
   */
  identify: (userRef: string, traits?: SessionReplayTraits) => void;

  /* A business event ("checkout_failed") with optional properties. */
  track: (name: string, properties?: SessionReplayTraits) => void;

  /* Per-session tags, searchable from the session list. */
  setTags: (tags: SessionReplayTraits) => void;
  addTag: (key: string, value: string | number | boolean) => void;

  /*
   * Be told the session id - immediately if one exists, and again on every
   * rotation. This is what puts session.id on the page's own OpenTelemetry
   * resource so its traces and logs can be joined to the recording.
   */
  onSessionChange: (listener: SessionChangeListener) => () => void;

  stop: () => void;
  getSessionId: () => string | null;

  /*
   * Turn the console diagnostics on or off for this page only. The
   * localStorage switch in Debug.ts is the one to reach for when the
   * problem is that the recorder never starts, because this call needs an
   * artifact that already loaded.
   */
  setDebug: (enabled: boolean) => void;

  /*
   * Everything the recorder decided, whether or not diagnostics were on.
   *
   * This is the call a support ticket asks for: the ring is filled
   * unconditionally, and it includes the LOADER's records - the ones from
   * before this bundle existed - because both bundles share one timeline.
   */
  getDiagnostics: () => SessionReplayDiagnostics;
}

/*
 * Why bootstrap() did or did not build a recorder. Stable words: the
 * dashboard's installation test and support both read them.
 */
export type SessionReplayBootstrapDecision =
  | "not-started"
  | "started"
  | "privacy-signal"
  | "directive-stop"
  | "already-started"
  | "cancelled-before-start";

/* Shape of getDiagnostics(). Additive-only, like everything else here. */
export interface SessionReplayDiagnostics {
  version: string;
  sessionId: string | null;
  tabId: string | null;

  /*
   * True only while the recorder is actually recording (into memory or
   * uploading). It used to be "a recorder object exists", which answered
   * true for a recorder that had stopped on a directive, a breaker trip, the
   * chunk cap or an unsampled draw - sending every diagnosis the wrong way.
   */
  isRecording: boolean;
  isUploading: boolean;
  state: RecorderState | "none";
  stopReason: RecorderStopReason | null;
  bootstrapDecision: SessionReplayBootstrapDecision;
  triggerReason: string | null;

  /* Null until a recorder exists; every gate answered once it does. */
  decisions: RecorderDecisions | null;
  tags: Record<string, string>;
  hasTraits: boolean;
  capabilities: Array<string>;

  records: Array<DebugRecord>;
}

let activeRecorder: Recorder | null = null;
let bootstrapDecision: SessionReplayBootstrapDecision = "not-started";

/*
 * Kept here rather than on the recorder so a listener registered before
 * the artifact loaded (through the command queue) survives into the
 * recorder, and one registered after a rotation still fires on the next.
 */
const sessionChangeListeners: Set<SessionChangeListener> =
  new Set<SessionChangeListener>();

function markStarted(): boolean {
  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  if (globalRecord[BOOTSTRAP_FLAG_GLOBAL] === true) {
    return false;
  }

  globalRecord[BOOTSTRAP_FLAG_GLOBAL] = true;

  return true;
}

function notifySessionChange(sessionId: string, tabId: string): void {
  for (const listener of Array.from(sessionChangeListeners)) {
    try {
      listener(sessionId, tabId);
    } catch {
      /* A host-page listener that throws must not break the recorder. */
    }
  }
}

export function bootstrap(
  initOptions: RecorderInitOptions,
  config: SessionReplayConfigResponse,
  earlyErrors?: Array<EarlyErrorRecord>,
): void {
  if (initOptions.debug === true) {
    setEnabled(true, "init-options");
  }

  if (activeRecorder) {
    debugWarn(
      "bootstrap-already-running",
      "bootstrap() called again while a recorder is running; ignored.",
    );

    return;
  }

  if (!markStarted()) {
    /*
     * Two copies of the snippet, or a stub and a self-hosted artifact on the
     * same page. Both would record the same session twice.
     */
    debugWarn(
      "bootstrap-already-started",
      "Already started on this page; ignoring a second start.",
    );

    bootstrapDecision = "already-started";
    return;
  }

  debugLog("bootstrap", "Artifact bootstrapping.", {
    recorderVersion: RECORDER_VERSION,
    earlyErrors: earlyErrors ? earlyErrors.length : 0,
  });

  /*
   * Re-checked here even though the loader already checked. The artifact may
   * be loaded directly, and a privacy signal that is only honoured on one of
   * two entry paths is not honoured. The page's preference is passed RAW:
   * an explicit value wins, and with none the server policy decides.
   */
  if (
    !Consent.isRecordingPermitted(
      initOptions.respectDoNotTrack,
      config.respectDoNotTrack,
    )
  ) {
    debugWarn(
      "privacy-signal",
      "Do Not Track or Global Privacy Control is set. Nothing is recorded.",
    );

    bootstrapDecision = "privacy-signal";
    return;
  }

  if (config.directive === "stop") {
    debugWarn(
      "directive-stop",
      "The policy carries a stop directive. Nothing is recorded.",
    );

    bootstrapDecision = "directive-stop";
    return;
  }

  activeRecorder = new Recorder({
    initOptions: initOptions,
    config: config,
    onSessionChange: notifySessionChange,
    ...(earlyErrors && earlyErrors.length > 0
      ? { earlyErrors: earlyErrors }
      : {}),
  });

  /*
   * Commands that only SET STATE are applied BEFORE start(). Consent
   * decisions, because replayEarlyErrors() runs at the end of start() and
   * can dispatch the session's first upload, and a revokeConsent the page
   * already issued must win over that upload, not chase it. Identity and
   * tags, because chunk 0 is often closed inside start() itself and is the
   * one chunk guaranteed to carry meta - applying identify() after it
   * means the header learns the user from a later chunk instead. Only
   * actions stay queued: captureSession() pre-start would arm a trigger on
   * a recorder with no snapshot yet, and track() has no stream to land in.
   */
  drainCommandQueue(PRE_START_COMMANDS);

  if (!activeRecorder) {
    /* Revoked or stopped before it ever started. Nothing may upload. */
    debugWarn(
      "bootstrap-cancelled",
      "A queued revokeConsent() or stop() ran before start().",
    );

    bootstrapDecision = "cancelled-before-start";
    return;
  }

  activeRecorder.start();
  bootstrapDecision = "started";

  notifySessionChange(activeRecorder.getSessionId(), activeRecorder.getTabId());

  drainCommandQueue();
}

export async function start(initOptions?: RecorderInitOptions): Promise<void> {
  const options: RecorderInitOptions | null =
    initOptions === undefined ? Config.readInitOptions() : initOptions;

  if (!options) {
    /*
     * The self-hosted entry point. The loader stub prints an unconditional
     * console.warn for this same condition and this path had nothing at all,
     * so a customer who bundles the artifact themselves got total silence
     * from the one failure that WAS instrumented.
     */
    debugWarn(
      "init-options-missing",
      "start() found no init options. Nothing will be recorded.",
    );

    return;
  }

  const config: SessionReplayConfigResponse | null =
    await Config.fetchConfig(options);

  /* No config, no recording. The fail-closed rule, restated at the edge. */
  if (!config) {
    debugWarn(
      "start-stopped",
      "No usable policy. start() will not record anything.",
    );

    return;
  }

  bootstrap(options, config);
}

export function captureSession(reason?: string): void {
  if (!activeRecorder) {
    debugWarn(
      "api-no-recorder",
      "captureSession() called with no recorder running.",
    );

    return;
  }

  debugLog("api-capture-session", "captureSession() called.", {
    hasReason: typeof reason === "string" && reason.length > 0,
  });

  activeRecorder.captureSession(
    typeof reason === "string" ? reason : undefined,
  );
}

export function grantConsent(): void {
  if (!activeRecorder) {
    debugWarn(
      "api-no-recorder",
      "grantConsent() called with no recorder running.",
    );

    return;
  }

  debugLog("api-grant-consent", "grantConsent() called.");

  activeRecorder.grantConsent();
}

export function revokeConsent(): void {
  if (activeRecorder) {
    debugLog("api-revoke-consent", "revokeConsent() called.");

    /*
     * The recorder stays: it keeps recording into memory under a withdrawn
     * consent (nothing uploads), so a later grantConsent() continues on a
     * fresh session instead of hitting "no recorder running" for the rest
     * of the page's life.
     */
    activeRecorder.revokeConsent();
  }
}

export function identify(userRef: string, traits?: SessionReplayTraits): void {
  if (activeRecorder) {
    activeRecorder.identify(userRef, traits);
  }
}

export function track(name: string, properties?: SessionReplayTraits): void {
  if (activeRecorder) {
    activeRecorder.track(name, properties);
  }
}

export function setTags(tags: SessionReplayTraits): void {
  if (activeRecorder) {
    activeRecorder.setTags(tags);
  }
}

export function addTag(key: string, value: string | number | boolean): void {
  if (activeRecorder) {
    activeRecorder.addTag(key, value);
  }
}

export function onSessionChange(listener: SessionChangeListener): () => void {
  if (typeof listener !== "function") {
    return (): void => {
      /* Nothing registered. */
    };
  }

  sessionChangeListeners.add(listener);

  if (activeRecorder && !activeRecorder.isStopped()) {
    try {
      listener(activeRecorder.getSessionId(), activeRecorder.getTabId());
    } catch {
      /* See notifySessionChange. */
    }
  }

  return (): void => {
    sessionChangeListeners.delete(listener);
  };
}

export function setDebug(enabled: boolean): void {
  setEnabled(enabled === true, "api");
}

export function getDiagnostics(): SessionReplayDiagnostics {
  const state: RecorderState | "none" = activeRecorder
    ? activeRecorder.getState()
    : "none";

  return {
    version: RECORDER_VERSION,
    sessionId: activeRecorder ? activeRecorder.getSessionId() : null,
    tabId: activeRecorder ? activeRecorder.getTabId() : null,
    isRecording: state === "recording" || state === "uploading",
    isUploading: activeRecorder ? activeRecorder.isUploading() : false,
    state: state,
    stopReason: activeRecorder ? activeRecorder.getStopReason() : null,
    bootstrapDecision: bootstrapDecision,
    triggerReason: activeRecorder ? activeRecorder.getTriggerReason() : null,
    decisions: activeRecorder ? activeRecorder.getDecisions() : null,
    tags: activeRecorder ? activeRecorder.getTags() : {},
    hasTraits: activeRecorder ? activeRecorder.hasTraits() : false,
    capabilities: activeRecorder ? activeRecorder.getCapabilities() : [],
    records: getDebugRecords(),
  };
}

export function stop(): void {
  if (activeRecorder) {
    debugLog("api-stop", "stop() called.");

    activeRecorder.stop();
    activeRecorder = null;
  }
}

export function getSessionId(): string | null {
  return activeRecorder && !activeRecorder.isStopped()
    ? activeRecorder.getSessionId()
    : null;
}

export const version: string = RECORDER_VERSION;

/*
 * The commands that may (and must) run before the recorder starts: they
 * decide WHETHER anything records or uploads at all, or set state chunk 0
 * should carry, and all are safe on a not-yet-started recorder. Everything
 * else waits until after start().
 */
const PRE_START_COMMANDS: ReadonlyArray<string> = [
  "grantConsent",
  "revokeConsent",
  "stop",
  "identify",
  "setTags",
  "addTag",
];

function isTraits(value: unknown): value is SessionReplayTraits {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTagValue(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/*
 * Apply commands the page queued before this bundle arrived. Unknown command
 * names are ignored rather than thrown on: the page may have been written
 * against a newer recorder than the one the config pinned.
 *
 * With `only`, just the named commands are consumed and everything else
 * stays queued for a later full drain.
 */
function drainCommandQueue(only?: ReadonlyArray<string>): void {
  const globalRecord: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  const queue: unknown = globalRecord[COMMAND_QUEUE_GLOBAL];

  if (!Array.isArray(queue)) {
    /*
     * Reported on the FULL drain only. bootstrap() drains twice - the
     * pre-start commands before start(), then everything after - and
     * warning on both put the same line in the console twice for one page
     * load, which reads like two different faults.
     */
    if (queue !== undefined && !only) {
      debugWarn(
        "command-queue-not-an-array",
        `window.${COMMAND_QUEUE_GLOBAL} is not an array; queued commands ignored.`,
        { type: typeof queue },
      );
    }

    return;
  }

  const remainder: Array<unknown> = [];

  for (const entry of queue) {
    if (!Array.isArray(entry)) {
      continue;
    }

    const command: unknown = entry[0];
    const first: unknown = entry[1];
    const second: unknown = entry[2];

    if (only && (typeof command !== "string" || !only.includes(command))) {
      remainder.push(entry);
      continue;
    }

    if (command === "captureSession") {
      captureSession(typeof first === "string" ? first : undefined);
    } else if (command === "grantConsent") {
      grantConsent();
    } else if (command === "revokeConsent") {
      revokeConsent();
    } else if (command === "identify" && typeof first === "string") {
      identify(first, isTraits(second) ? second : undefined);
    } else if (command === "track" && typeof first === "string") {
      track(first, isTraits(second) ? second : undefined);
    } else if (command === "setTags" && isTraits(first)) {
      setTags(first);
    } else if (
      command === "addTag" &&
      typeof first === "string" &&
      isTagValue(second)
    ) {
      addTag(first, second);
    } else if (command === "onSessionChange" && typeof first === "function") {
      onSessionChange(first as SessionChangeListener);
    } else if (command === "stop") {
      stop();
    } else {
      /*
       * Unknown names are ignored rather than thrown on - the page may have
       * been written against a newer recorder than the config pinned - but
       * ignoring them SILENTLY is how a misspelt "grantconsent" becomes a
       * session that records forever and uploads nothing.
       */
      debugWarn(
        "command-queue-unknown-command",
        "A queued command was not recognised and was dropped.",
        { command: typeof command === "string" ? command : typeof command },
      );
    }
  }

  globalRecord[COMMAND_QUEUE_GLOBAL] = remainder;
}
