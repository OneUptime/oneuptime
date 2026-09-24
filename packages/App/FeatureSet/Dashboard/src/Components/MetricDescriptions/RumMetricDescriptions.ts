/*
 * What each number on the RUM application overview means, in plain words.
 * Shown in the (i) tooltip beside a tile or chart title.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest: "Events" counts every span, and the event-duration tile is
 * an average of per-interval p95s. Change the fetch, change the words.
 */

export type RumMetric =
  | "pageLoads"
  | "pageLoadTime"
  | "events"
  | "errorRate"
  | "eventDuration"
  | "exceptions"
  | "clients"
  | "sessionsRecorded"
  | "pageLoadsChart"
  | "pageLoadTimeChart"
  | "eventsChart"
  | "eventDurationChart"
  | "exceptionsChart"
  | "logsChart"
  | "webVitals";

export const RUM_METRIC_DESCRIPTIONS: Record<RumMetric, string> = {
  pageLoads:
    "Full page loads in the selected range, counted from the documentLoad span the OpenTelemetry browser SDK records each time a page is opened or reloaded. Route changes inside a single-page app are not page loads.",
  pageLoadTime:
    "How long full page loads took, from the start of navigation to the browser's load event. p95 means the 95th percentile: 95% of page loads in the selected range were faster than this and the slowest 5% took longer. The median below is the typical load - half were faster.",
  events:
    "Every span your app reported in the selected range: page loads, the files and API requests they make, and clicks and other interactions. One page view usually produces several, so this is higher than the number of pages viewed.",
  errorRate:
    "The share of events in the selected range that were marked as errors, such as a failed page load or network request; the line below is how many errored. The bar turns amber at 1% and red at 5%.",
  eventDuration:
    "p95 means the 95th percentile: 95% of events (page loads, requests and interactions) finished faster than this, and the slowest 5% took longer. Worked out for each interval on the chart, then averaged over the selected range, so quiet and busy intervals count equally.",
  exceptions:
    "Errors your app reported as exceptions in the selected range, such as uncaught JavaScript errors. The browser SDK does not send these on its own - they appear once your app records them (see Documentation).",
  clients:
    "Distinct platforms this app has been used on so far, such as a browser's operating system or a mobile device model. Not limited to the selected range, and not a count of users or devices.",
  sessionsRecorded:
    'Visitor sessions with a Session Replay recording in the selected range. Counting stops at 50, so "50+" means there are more - open Session Replay to see them all.',
  pageLoadsChart:
    "Full page loads (documentLoad spans) in each interval of the selected range, with failed loads as a second line.",
  pageLoadTimeChart:
    "The 95th percentile page load time in each interval: 95% of the page loads in that interval finished faster than the line. A spike means some visitors waited much longer than usual.",
  eventsChart:
    "Events (spans) reported in each interval, with the ones marked as errors as a second line. Page loads, requests and interactions all count.",
  eventDurationChart:
    "The 95th percentile event duration in each interval: 95% of the page loads, requests and interactions in that interval finished faster than the line.",
  exceptionsChart:
    "Exceptions your app reported in each interval of the selected range.",
  logsChart:
    "Log records your app sent in each interval, with Error and Fatal ones as a second line. Browser apps only send logs once the optional OpenTelemetry logs setup is added.",
  webVitals:
    "Standard measures of how fast and stable your pages feel to real visitors. Each value is an average over the selected range; Google's own report uses the 75th percentile, so its rating can differ.",
};

/*
 * The Replay Access Log (Pages/Rum/View/SessionReplayAudit.tsx). "Watched"
 * is footage actually played in one viewing: the player adds up elapsed time
 * only while playing, times the playback speed (SessionReplayPlayer's
 * heartbeat), and the server floors it to 15-second steps and never lets it
 * go down (normalizeSecondsWatched and recordSecondsWatched in
 * Common/Server/Services/RumSessionReplayViewService.ts). The page shows 0
 * as "< 15s".
 */
export type RumReplayAccessMetric = "watched";

export const RUM_REPLAY_ACCESS_METRIC_DESCRIPTIONS: Record<
  RumReplayAccessMetric,
  string
> = {
  watched:
    "How much of the recording this person actually played in this viewing. Paused time and jumps along the timeline do not count, and at 2x speed a minute of watching counts as two. Rounded down to 15-second steps, so less than that shows as < 15s.",
};
