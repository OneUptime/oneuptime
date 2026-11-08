import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import { pickWiderRange } from "../../SessionReplay/SessionReplayEmptyReason";

/*
 * WHY A RUM APPLICATION'S EXCEPTIONS, LOGS OR WEB VITALS ARE EMPTY
 * (issue #5770), without React.
 *
 * The Overview's Exceptions and Logs charts used to say "No data in this
 * time range" whatever the reason - for an app whose errors are simply not
 * reported (the OpenTelemetry browser SDK reports none on its own), for an
 * app that sent its last log yesterday, and for an app nothing has ever
 * arrived from. Those need three different next steps. So an empty chart,
 * the application's Logs page and the setup check on its Documentation tab
 * read one answer from here:
 *
 *   receiving    - something arrived in the range on screen (the setup
 *                  check, with no range: in the past 24 hours);
 *   quiet        - nothing in the range, but it has arrived before: when
 *                  the last one did, and a longer range that shows it.
 *                  Also when nothing at all has arrived from the app
 *                  since its arrivals were first kept: the app is silent,
 *                  whether this signal was set up cannot be told, and
 *                  `since` says when the app was last heard from;
 *   not-set-up   - it has never arrived (since the application's arrivals
 *                  are kept, `since`) while the app reports other things -
 *                  the signal is not set up, or, for the SDK cause, only
 *                  Session Replay reports and the OpenTelemetry SDK is
 *                  missing altogether, or, for the names cause, metrics
 *                  arrive but none under a Web Vitals name;
 *   not-arriving - nothing at all has ever arrived from the application:
 *                  its SDK is not installed, or what it sends never gets
 *                  here (a key, an origin, a Content Security Policy);
 *   unknown      - a read failed: say so, and offer to try again;
 *   loading      - a read is still out.
 *
 * Whether a signal is "set up but quiet" or "not set up" when it has never
 * arrived cannot be told from the server: an error handler that has never
 * caught an error sends nothing, exactly like one that was never added.
 * Telling them apart would take a marker in the app - a log line at
 * startup, or a resource attribute - that every customer would have to add
 * and keep, and that an old build without it would read as "not set up"
 * anyway. So the copy says the likely cause (the browser SDK sends neither
 * on its own) and what is true either way, and asks no change of anyone.
 *
 * Ingest refusals cannot help either: a key that is revoked or switched
 * off and an origin a Browser key does not allow are refused before the
 * request is read, so before it names an application, and a Content
 * Security Policy or a CORS block never reaches the server at all. Only
 * Session Replay counts its refusals per application, and its row reads
 * them (Components/SessionReplay/useSessionReplayHealth).
 */

export type RumSignalState =
  | "loading"
  | "receiving"
  | "quiet"
  | "not-set-up"
  | "not-arriving"
  | "unknown";

/*
 * Why a signal that never arrived is not set up: the signal itself
 * ("signal"), the whole OpenTelemetry SDK ("sdk": only Session Replay
 * reports), or - Web Vitals - metrics that arrive under other names
 * ("names").
 */
export type RumSignalNotSetUpCause = "signal" | "sdk" | "names";

// What is known about the application as a whole.
export interface RumApplicationArrivalFacts {
  // Anything at all has arrived: telemetry (lastSeenAt) or a recording.
  anythingArrived: boolean;
  /*
   * When anything last arrived (lastSeenAt, which telemetry and recordings
   * both refresh, or the newest recording), null for never.
   */
  lastHeardFromAt: Date | null;
  /*
   * Recordings arrive but the OpenTelemetry SDK has never reported
   * (isReplayOnlyInstrumented).
   */
  replayOnly: boolean;
}

export interface RumSignalDiagnosisInput {
  /*
   * How many arrived in the range on screen: a count, null when the read
   * failed, undefined while it loads. Left out entirely by the setup
   * check, which has no range and asks about the past 24 hours instead.
   */
  inRange?: { count: number | null | undefined } | undefined;
  /*
   * The newest arrival there is: at = null when there is none; failed when
   * it could not be read. null while it loads.
   */
  lastArrival: { at: Date | null; failed: boolean } | null;
  /*
   * Since when "none" is known (RumApplication.signalArrivalsTrackedSince):
   * an empty <signal>LastReceivedAt means "none since then". null when the
   * record covers all time (exceptions are rows of their own).
   */
  trackedSince: Date | null;
  /*
   * Web Vitals only: metrics of other names do arrive
   * (metricsLastReceivedAt), so a vitals read that finds none means the
   * names, not the pipeline.
   */
  otherNamesArrive?: boolean | undefined;
  app: RumApplicationArrivalFacts;
  // The range on screen, with the dates it stands for now.
  range?:
    | {
        timeRange: RangeStartAndEndDateTime;
        start: Date;
        end: Date;
      }
    | undefined;
  /*
   * The application's telemetry retention, when it has one of its own: a
   * longer range is offered only while what it would show is still kept.
   */
  retentionInDays?: number | null | undefined;
  now: Date;
}

export interface RumSignalDiagnosis {
  state: RumSignalState;
  // not-set-up only.
  cause?: RumSignalNotSetUpCause | undefined;
  // quiet, and receiving in the setup check: when the newest arrived.
  lastArrivalAt: Date | null;
  /*
   * not-set-up: "nothing since this date"; null for "nothing yet". quiet
   * with no lastArrivalAt: when the silent app was last heard from.
   */
  since: Date | null;
  // quiet: the narrowest longer named range that shows the last arrival.
  widerRange: RangeStartAndEndDateTime | null;
}

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

/*
 * The setup check, which has no range, calls a signal "arriving" when it
 * arrived in the past 24 hours: exceptions and logs come only when
 * something happens, so an hour would call a healthy app quiet every
 * night. Older is quiet, with the date it last came.
 */
export const RUM_SETUP_CHECK_RECENT_WINDOW_MS: number = DAY_MS;

/*
 * How far back the setup check looks for a Web Vital. The vitals are read
 * from metric rows, not from a stamp, and an index-friendly read wants a
 * bound; 30 days covers the default retention.
 */
export const RUM_WEB_VITALS_LOOKBACK_DAYS: number = 30;

/*
 * How far apart lastSeenAt and the arrival stamps can drift for an app
 * that is sending: each is written at most once per fence window (five
 * minutes and a little), so an app last heard from this long before its
 * arrivals were first kept has been silent since, not merely unstamped.
 */
export const RUM_SIGNAL_STAMP_TOLERANCE_MS: number = 15 * 60 * 1000;

function toTime(value: Date | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const ms: number = value.getTime();

  return Number.isNaN(ms) ? null : ms;
}

/*
 * What the Web Vitals row can vouch for. It reads the metric rows of the
 * past 30 days, not a stamp of its own, so:
 *
 * - other metrics arrive only when the application's metrics stamp falls
 *   inside those 30 days - a vitals read that finds none then means the
 *   names, not the pipeline;
 * - "nothing since" is the start of those 30 days, or the date its
 *   arrivals are kept from when that is earlier and no metric at all has
 *   arrived since: the stamp vouches for that much more.
 */
export function getWebVitalsCheckWindow(data: {
  metricsLastReceivedAt: Date | null;
  trackedSince: Date | null;
  now: Date;
}): { otherNamesArrive: boolean; since: Date } {
  const now: number = toTime(data.now) || 0;
  const lookbackStart: number = now - RUM_WEB_VITALS_LOOKBACK_DAYS * DAY_MS;
  const metricsAt: number | null = toTime(data.metricsLastReceivedAt);
  const trackedSince: number | null = toTime(data.trackedSince);

  const otherNamesArrive: boolean =
    metricsAt !== null && metricsAt >= lookbackStart;

  const since: number =
    metricsAt === null && trackedSince !== null
      ? Math.min(trackedSince, lookbackStart)
      : lookbackStart;

  return { otherNamesArrive, since: new Date(since) };
}

/*
 * The longer range that shows an arrival `at`, or null: none when the
 * arrival is inside the range on screen already (the range is empty for
 * another reason, and a longer one would show the same nothing), when it
 * is older than the application keeps telemetry for, or when no named
 * range reaches back far enough (pickWiderRange).
 */
export function getRangeShowingArrival(data: {
  at: Date;
  range: { timeRange: RangeStartAndEndDateTime; start: Date; end: Date };
  retentionInDays?: number | null | undefined;
  now: Date;
}): RangeStartAndEndDateTime | null {
  const at: number | null = toTime(data.at);
  const start: number | null = toTime(data.range.start);
  const end: number | null = toTime(data.range.end);
  const now: number | null = toTime(data.now);

  if (at === null || now === null) {
    return null;
  }

  if (start !== null && end !== null && at >= start && at <= end) {
    return null;
  }

  const ageMs: number = Math.max(0, now - at);

  if (
    typeof data.retentionInDays === "number" &&
    data.retentionInDays > 0 &&
    ageMs > data.retentionInDays * DAY_MS
  ) {
    return null;
  }

  /*
   * A custom window shorter than a week still gets "the past week": what
   * pickWiderRange compares is the window's length, and a zoomed custom
   * range is short. One that is already a week or longer keeps going up.
   */
  return pickWiderRange(ageMs, data.range.timeRange);
}

export function diagnoseRumSignal(
  input: RumSignalDiagnosisInput,
): RumSignalDiagnosis {
  const none: RumSignalDiagnosis = {
    state: "loading",
    lastArrivalAt: null,
    since: null,
    widerRange: null,
  };

  if (input.inRange) {
    const count: number | null | undefined = input.inRange.count;

    if (count === undefined) {
      return none;
    }

    if (count === null) {
      return { ...none, state: "unknown" };
    }

    if (count > 0) {
      return {
        ...none,
        state: "receiving",
        lastArrivalAt: input.lastArrival?.at || null,
      };
    }
  }

  if (!input.lastArrival) {
    return none;
  }

  if (input.lastArrival.failed) {
    return { ...none, state: "unknown" };
  }

  const lastArrivalAt: Date | null = input.lastArrival.at;

  if (lastArrivalAt && toTime(lastArrivalAt) !== null) {
    if (!input.range) {
      const ageMs: number =
        (toTime(input.now) || 0) - (toTime(lastArrivalAt) || 0);

      return {
        ...none,
        state:
          ageMs <= RUM_SETUP_CHECK_RECENT_WINDOW_MS ? "receiving" : "quiet",
        lastArrivalAt,
      };
    }

    return {
      ...none,
      state: "quiet",
      lastArrivalAt,
      widerRange: getRangeShowingArrival({
        at: lastArrivalAt,
        range: input.range,
        retentionInDays: input.retentionInDays,
        now: input.now,
      }),
    };
  }

  // Nothing of this signal has arrived.
  if (input.app.replayOnly) {
    return { ...none, state: "not-set-up", cause: "sdk" };
  }

  if (!input.app.anythingArrived) {
    return { ...none, state: "not-arriving" };
  }

  /*
   * Nothing at all has arrived since this signal's arrivals were first
   * kept (an app that stopped before the upgrade that added them): "not
   * set up" cannot be told from silence, so say since when it is silent.
   */
  const trackedSince: number | null = toTime(input.trackedSince);
  const lastHeardFrom: number | null = toTime(input.app.lastHeardFromAt);

  if (
    trackedSince !== null &&
    lastHeardFrom !== null &&
    trackedSince - lastHeardFrom > RUM_SIGNAL_STAMP_TOLERANCE_MS
  ) {
    return { ...none, state: "quiet", since: input.app.lastHeardFromAt };
  }

  if (input.otherNamesArrive) {
    return { ...none, state: "not-set-up", cause: "names" };
  }

  return {
    ...none,
    state: "not-set-up",
    cause: "signal",
    since: trackedSince !== null ? input.trackedSince : null,
  };
}
