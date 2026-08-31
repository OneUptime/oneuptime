import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
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
import Recorder from "./Recorder";

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
 */
const COMMAND_QUEUE_GLOBAL: string = "OneUptimeReplayQueue";

/* Set by the loader so a directly loaded artifact does not double-start. */
const BOOTSTRAP_FLAG_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY_STARTED__";

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

  captureSession: () => void;
  grantConsent: () => void;
  revokeConsent: () => void;
  identify: (userRef: string) => void;
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

/* Shape of getDiagnostics(). Additive-only, like everything else here. */
export interface SessionReplayDiagnostics {
  version: string;
  sessionId: string | null;
  isRecording: boolean;
  isUploading: boolean;
  triggerReason: string | null;
  records: Array<DebugRecord>;
}

let activeRecorder: Recorder | null = null;

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

    return;
  }

  debugLog("bootstrap", "Artifact bootstrapping.", {
    recorderVersion: RECORDER_VERSION,
    earlyErrors: earlyErrors ? earlyErrors.length : 0,
  });

  /*
   * Re-checked here even though the loader already checked. The artifact may
   * be loaded directly, and a privacy signal that is only honoured on one of
   * two entry paths is not honoured.
   */
  if (
    !Consent.isRecordingPermitted(
      initOptions.respectDoNotTrack !== false,
      config.respectDoNotTrack,
    )
  ) {
    debugWarn(
      "privacy-signal",
      "Do Not Track or Global Privacy Control is set. Nothing is recorded.",
    );

    return;
  }

  if (config.directive === "stop") {
    debugWarn(
      "directive-stop",
      "The policy carries a stop directive. Nothing is recorded.",
    );

    return;
  }

  activeRecorder = new Recorder({
    initOptions: initOptions,
    config: config,
    ...(earlyErrors && earlyErrors.length > 0
      ? { earlyErrors: earlyErrors }
      : {}),
  });

  /*
   * Consent decisions queued while the artifact downloaded are applied
   * BEFORE start(): replayEarlyErrors() runs at the end of start() and
   * can dispatch the session's first upload, and a revokeConsent the page
   * already issued must win over that upload, not chase it. Only the
   * consent-shaped commands run here — captureSession() pre-start would
   * arm a trigger on a recorder with no snapshot yet.
   */
  drainCommandQueue(CONSENT_COMMANDS);

  if (!activeRecorder) {
    /* Revoked or stopped before it ever started. Nothing may upload. */
    debugWarn(
      "bootstrap-cancelled",
      "A queued revokeConsent() or stop() ran before start().",
    );

    return;
  }

  activeRecorder.start();

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

export function captureSession(): void {
  if (!activeRecorder) {
    debugWarn(
      "api-no-recorder",
      "captureSession() called with no recorder running.",
    );

    return;
  }

  debugLog("api-capture-session", "captureSession() called.");

  activeRecorder.trigger(SessionReplayTriggerReason.Manual);
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

    activeRecorder.revokeConsent();
    activeRecorder = null;
  }
}

export function identify(userRef: string): void {
  if (activeRecorder) {
    activeRecorder.identify(userRef);
  }
}

export function setDebug(enabled: boolean): void {
  setEnabled(enabled === true, "api");
}

export function getDiagnostics(): SessionReplayDiagnostics {
  return {
    version: RECORDER_VERSION,
    sessionId: activeRecorder ? activeRecorder.getSessionId() : null,
    isRecording: Boolean(activeRecorder),
    isUploading: activeRecorder ? activeRecorder.isUploading() : false,
    triggerReason: activeRecorder ? activeRecorder.getTriggerReason() : null,
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
  return activeRecorder ? activeRecorder.getSessionId() : null;
}

export const version: string = RECORDER_VERSION;

/*
 * The commands that may (and must) run before the recorder starts: they
 * decide WHETHER anything records or uploads at all, and they are safe on
 * a not-yet-started recorder. Everything else waits until after start().
 */
const CONSENT_COMMANDS: ReadonlyArray<string> = [
  "grantConsent",
  "revokeConsent",
  "stop",
];

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
     * consent-shaped commands before start(), then everything after - and
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
    const argument: unknown = entry[1];

    if (only && (typeof command !== "string" || !only.includes(command))) {
      remainder.push(entry);
      continue;
    }

    if (command === "captureSession") {
      captureSession();
    } else if (command === "grantConsent") {
      grantConsent();
    } else if (command === "revokeConsent") {
      revokeConsent();
    } else if (command === "identify" && typeof argument === "string") {
      identify(argument);
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
