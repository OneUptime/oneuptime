import { SessionReplayConfigResponse } from "Common/Types/Rum/SessionReplay";
import SessionReplayTriggerReason from "Common/Types/Rum/SessionReplayTriggerReason";
import Config, { RECORDER_VERSION, RecorderInitOptions } from "./Config";
import Consent from "./Consent";
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
  if (activeRecorder) {
    return;
  }

  if (!markStarted()) {
    return;
  }

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
    return;
  }

  if (config.directive === "stop") {
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
    return;
  }

  activeRecorder.start();

  drainCommandQueue();
}

export async function start(initOptions?: RecorderInitOptions): Promise<void> {
  const options: RecorderInitOptions | null =
    initOptions === undefined ? Config.readInitOptions() : initOptions;

  if (!options) {
    return;
  }

  const config: SessionReplayConfigResponse | null =
    await Config.fetchConfig(options);

  /* No config, no recording. The fail-closed rule, restated at the edge. */
  if (!config) {
    return;
  }

  bootstrap(options, config);
}

export function captureSession(): void {
  if (activeRecorder) {
    activeRecorder.trigger(SessionReplayTriggerReason.Manual);
  }
}

export function grantConsent(): void {
  if (activeRecorder) {
    activeRecorder.grantConsent();
  }
}

export function revokeConsent(): void {
  if (activeRecorder) {
    activeRecorder.revokeConsent();
    activeRecorder = null;
  }
}

export function identify(userRef: string): void {
  if (activeRecorder) {
    activeRecorder.identify(userRef);
  }
}

export function stop(): void {
  if (activeRecorder) {
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
    }
  }

  globalRecord[COMMAND_QUEUE_GLOBAL] = remainder;
}
