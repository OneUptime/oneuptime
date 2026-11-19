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
 *
 * opentelemetry-swift (iOS) and the OpenTelemetry JavaScript SDK a React
 * Native app runs send none of the app start, frame or crash signals on
 * their own; an app on them reports these only where its code records them
 * under the same names.
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
 *
 * It and the crash and ANR event names below are written out, not imported
 * from Types/Log/LogEventName and Utils/Telemetry/MobileAppFaults, because a
 * module in Common/{Utils,Types}/Rum imports nothing from the rest of
 * Common: the browser recorder inlines these modules into the page it is
 * served to, and its SourceHygiene test holds every one of them to that.
 * Tests/Types/Rum/MobileAppTelemetry.test.ts holds each copy to the name
 * ingest reads.
 */
export const EVENT_NAME_ATTRIBUTE: string = "event.name";

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

// The crash and ANR events, first the name current SDKs send.
export const APP_CRASH_EVENT_NAME: string = "app.crash";

export const APP_ANR_EVENT_NAME: string = "device.anr";

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
