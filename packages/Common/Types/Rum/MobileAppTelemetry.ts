import {
  MOBILE_APP_FAULT_EVENT_NAMES,
  MobileAppFaultKind,
} from "../../Utils/Telemetry/MobileAppFaults";
import { JSONObject } from "../JSON";
import { LogEventNameAttributeKey } from "../Log/LogEventName";

/*
 * WHAT A MOBILE APP'S OPENTELEMETRY SDK SENDS, BY NAME.
 *
 * A mobile RUM application's Overview (#9588) and the monitors its
 * Recommendations offer (#9589) read these spans, events and attributes.
 * Each was checked against the OpenTelemetry Android 1.8.1 source, the SDK
 * the Android Setup docs set up:
 *
 *   - App starts: an `AppStart` span (AppStartupTimer, ActivityTracer), with
 *     `start.type` set to `cold` for a start from scratch, `warm` when the
 *     first activity is created again and `hot` when it comes back to the
 *     front. It ends when the first activity resumes, which is about when
 *     Android draws the first frame (its time to initial display), and none
 *     is recorded when the UI takes longer than a minute to start (the app
 *     was started in the background).
 *   - Slow and frozen frames: an `app.jank` event (EventJankReporter), sent
 *     once a second per activity that drew a slow frame in it, with
 *     `app.jank.frame_count`, `app.jank.period` (seconds) and
 *     `app.jank.threshold`: `0.016` counts the frames slower than 16 ms (a
 *     frozen frame is one of them too), `0.7` the frames slower than 700 ms.
 *     The OpenTelemetry semantic conventions define the event and its three
 *     attributes. The event also carries `app.screen.name`, the screen on
 *     view when it was sent.
 *   - Crashes and ANRs: `app.crash` (`device.crash` before 1.5) and
 *     `device.anr` events, filed as unhandled exceptions
 *     (Utils/Telemetry/MobileAppFaults). An ANR is sent again every five
 *     seconds while the main thread stays blocked.
 *   - Sessions: `session.id` on every span and log, stored in each row's
 *     sessionId column (Utils/Telemetry/CorrelationIdAttributes).
 *   - Installs: `app.installation.id` on the resource (1.1 and later), a
 *     random UUID the SDK keeps in the app's SharedPreferences, so one id
 *     for as long as the app stays installed. Stored, as every resource
 *     attribute is, under "resource." on each span and log row; ingest
 *     copies it onto the exception rows of a crash too, so the installs a
 *     crash happened on are counted as its sessions are (#9716).
 *
 * opentelemetry-swift (iOS) and the OpenTelemetry JavaScript SDK a React
 * Native app runs send none of the app start or frame signals on their own;
 * an app on them reports these only where its code records them under the
 * same names. opentelemetry-swift's MetricKit instrumentation reports an
 * iOS app's crashes and hangs (MobileAppFaults), and its releases set no
 * `app.installation.id` yet.
 */

export const APP_START_SPAN_NAME: string = "AppStart";

export const APP_START_TYPE_ATTRIBUTE: string = "start.type";

export type AppStartType = "cold" | "warm" | "hot";

export const APP_START_TYPE_COLD: AppStartType = "cold";
export const APP_START_TYPE_WARM: AppStartType = "warm";
export const APP_START_TYPE_HOT: AppStartType = "hot";

// In the order a start costs the most: a cold start is the number people quote.
export const APP_START_TYPES: ReadonlyArray<AppStartType> = [
  APP_START_TYPE_COLD,
  APP_START_TYPE_WARM,
  APP_START_TYPE_HOT,
];

/*
 * The attribute ingest stamps a log's event name onto (LogEventName), which
 * is where the crash, ANR and frame events are read from.
 */
export const EVENT_NAME_ATTRIBUTE: string = LogEventNameAttributeKey;

export const APP_JANK_EVENT_NAME: string = "app.jank";

export const APP_JANK_FRAME_COUNT_ATTRIBUTE: string = "app.jank.frame_count";

export const APP_JANK_THRESHOLD_ATTRIBUTE: string = "app.jank.threshold";

/*
 * The two thresholds OpenTelemetry Android reports frames against, as the
 * attribute's value is stored: a double, written as the shortest number that
 * reads back the same.
 */
export const SLOW_FRAME_THRESHOLD: string = "0.016";
export const FROZEN_FRAME_THRESHOLD: string = "0.7";

export const APP_SCREEN_NAME_ATTRIBUTE: string = "app.screen.name";

// The install, as the SDK names it on its resource.
export const APP_INSTALLATION_ID_ATTRIBUTE: string = "app.installation.id";

// The install, as a span, log or exception row keeps it.
export const STORED_APP_INSTALLATION_ID_ATTRIBUTE: string = `resource.${APP_INSTALLATION_ID_ATTRIBUTE}`;

/*
 * The install a row's stored attributes name, or '' when none does: only
 * the resource's, the one OpenTelemetry Android sets, so every count of
 * installs reads the same key. Verbatim, as the span's own copy is
 * counted, so a crash's install is the very value its spans carry.
 */
export function readStoredAppInstallationId(
  attributes: JSONObject | undefined | null,
): string {
  const value: unknown = attributes?.[STORED_APP_INSTALLATION_ID_ATTRIBUTE];

  return typeof value === "string" ? value : "";
}

/*
 * An exception row's attributes with the install its span or log names,
 * when that names one and the row's own do not: an exception row keeps
 * none of its span's or log's resource attributes otherwise. The given
 * attributes are never changed.
 */
export function withAppInstallationId(input: {
  attributes: JSONObject;
  from: JSONObject | undefined | null;
}): JSONObject {
  const installationId: string = readStoredAppInstallationId(input.from);

  if (!installationId || readStoredAppInstallationId(input.attributes)) {
    return input.attributes;
  }

  return {
    ...input.attributes,
    [STORED_APP_INSTALLATION_ID_ATTRIBUTE]: installationId,
  };
}

// The crash and ANR events, first the name current SDKs send.
export const APP_CRASH_EVENT_NAME: string = MOBILE_APP_FAULT_EVENT_NAMES[
  MobileAppFaultKind.Crash
][0] as string;

export const APP_ANR_EVENT_NAME: string = MOBILE_APP_FAULT_EVENT_NAMES[
  MobileAppFaultKind.Anr
][0] as string;

/*
 * The start times Android vitals counts as excessive (developer.android.com,
 * "App startup time"): a cold start of 5 seconds or longer, a warm start of
 * 2 seconds or longer and a hot start of 1.5 seconds or longer.
 */
export const EXCESSIVE_APP_START_MS: Readonly<Record<AppStartType, number>> = {
  cold: 5000,
  warm: 2000,
  hot: 1500,
};
