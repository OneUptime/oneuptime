import { DashboardRecordingConfig } from "./DashboardRecordingConfig";

/*
 * LOADING ONEUPTIME'S RECORDER INTO ONEUPTIME'S DASHBOARD (issue #6834).
 *
 * This file is imported with import() by DashboardRecording, and only once
 * every gate (DashboardRecordingGate) has passed: a Dashboard that never
 * records - every self-hosted one - never downloads it, and nothing in it
 * runs. It loads the recorder the way a customer's page does (the docs'
 * init global and loader script, from the configured OneUptime host), with
 * the page's own requests on top of whatever the RUM application's policy
 * says:
 *
 *   - maskAllText: every word masked, whatever the policy's masking mode;
 *     only the product's own words, marked by Common/UI with
 *     PRODUCT_TEXT_CLASS_NAME (Utils/ProductText), are recorded as written;
 *   - blockSelectors: images, canvases, code, monospace text (keys, ids,
 *     log lines) left out of the recording altogether, as empty boxes;
 *   - respectDoNotTrack: the browser's signal wins, whatever the policy;
 *   - offlineStorage false: nothing of a recording is kept on the person's
 *     disk while their connection is down.
 *
 * Consent is granted as the recorder loads, because the person already gave
 * it ("Accept all") before this file was even fetched: nothing is recorded,
 * held or buffered before that.
 */

const INIT_GLOBAL: string = "__ONEUPTIME_SESSION_REPLAY__";
const COMMAND_QUEUE_GLOBAL: string = "OneUptimeReplayQueue";

// The loader every customer's page loads (the docs' install snippet).
export const RECORDER_LOADER_PATH: string =
  "/telemetry/session-replay/v1/recorder.js";

// Marks the script tag, so it is found again and never added twice.
export const RECORDER_SCRIPT_ATTRIBUTE: string =
  "data-oneuptime-dashboard-recording";

/*
 * Left out of every recording, as boxes of their size: a picture or an
 * avatar, a chart's canvas, a frame, and anything set in monospace - code,
 * keys and tokens (HiddenText), record ids, log lines - which is where the
 * Dashboard shows what customers' systems said.
 */
export const DASHBOARD_BLOCK_SELECTORS: ReadonlyArray<string> = [
  "img",
  "picture",
  "video",
  "canvas",
  "iframe",
  "svg image",
  "pre",
  "code",
  ".font-mono",
  ".monaco-editor",
];

export interface DashboardRecorderInitOptions {
  host: string;
  token: string;
  appIdentifier: string;
  respectDoNotTrack: boolean;
  offlineStorage: boolean;
  maskAllText: boolean;
  blockSelectors: Array<string>;
}

export const getDashboardRecorderInitOptions: (
  config: DashboardRecordingConfig,
) => DashboardRecorderInitOptions = (
  config: DashboardRecordingConfig,
): DashboardRecorderInitOptions => {
  return {
    host: config.host,
    token: config.token,
    appIdentifier: config.appIdentifier,
    respectDoNotTrack: true,
    offlineStorage: false,
    maskAllText: true,
    blockSelectors: [...DASHBOARD_BLOCK_SELECTORS],
  };
};

type ReplayCommand = Array<unknown>;

const getWindowRecord: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return window as unknown as Record<string, unknown>;
};

/*
 * The recorder could not load (an ad blocker, a lost connection): nothing
 * will ever read the queue, so nothing more is added to it.
 */
let hasFailedToLoad: boolean = false;

/*
 * Hands the recorder one command: applied at once once it has loaded (the
 * queue is live), and in order when it arrives otherwise - so a pause asked
 * for while it loads means it starts paused.
 */
const push: (command: ReplayCommand) => void = (
  command: ReplayCommand,
): void => {
  if (hasFailedToLoad) {
    return;
  }

  const windowRecord: Record<string, unknown> = getWindowRecord();

  if (!Array.isArray(windowRecord[COMMAND_QUEUE_GLOBAL])) {
    windowRecord[COMMAND_QUEUE_GLOBAL] = [];
  }

  (windowRecord[COMMAND_QUEUE_GLOBAL] as Array<ReplayCommand>).push(command);
};

export default class DashboardRecorder {
  /*
   * Load the recorder. Once per page: a second call finds its script tag
   * and does nothing. `startPaused` when the person has already moved on to
   * a page that is not recorded by the time this file arrived.
   */
  public static start(
    config: DashboardRecordingConfig,
    options?: { startPaused?: boolean | undefined } | undefined,
  ): void {
    if (document.querySelector(`script[${RECORDER_SCRIPT_ATTRIBUTE}]`)) {
      return;
    }

    getWindowRecord()[INIT_GLOBAL] = getDashboardRecorderInitOptions(config);

    push(["grantConsent"]);

    if (options?.startPaused) {
      push(["pause"]);
    }

    const script: HTMLScriptElement = document.createElement("script");
    script.src = `${config.host}${RECORDER_LOADER_PATH}`;
    script.async = true;
    script.setAttribute(RECORDER_SCRIPT_ATTRIBUTE, "true");
    script.addEventListener("error", (): void => {
      hasFailedToLoad = true;
      delete getWindowRecord()[COMMAND_QUEUE_GLOBAL];
    });
    document.head.appendChild(script);
  }

  public static hasFailedToLoad(): boolean {
    return hasFailedToLoad;
  }

  public static pause(): void {
    push(["pause"]);
  }

  public static resume(): void {
    push(["resume"]);
  }

  /*
   * A marker on the recording's timeline: a sign of frustration, or one of
   * the Dashboard's product events (#6830), by its name. Its properties are
   * masked like the page, so where it happened goes in the tags instead.
   */
  public static track(name: string): void {
    push(["track", name]);
  }

  // Where the person is: the page's route pattern and the guided setup's step.
  public static setTags(tags: Record<string, string>): void {
    push(["setTags", tags]);
  }

  // The person withdrew: stop, and keep nothing that was not yet sent.
  public static stop(): void {
    push(["revokeConsent"]);
    push(["stop"]);
  }
}
