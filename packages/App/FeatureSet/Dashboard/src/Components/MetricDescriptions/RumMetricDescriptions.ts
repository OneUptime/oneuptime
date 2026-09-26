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
  | "webVitals"
  | "inpByRoute";

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
  inpByRoute:
    "Interaction to Next Paint for each route, averaged over the selected range, slowest first. In a single-page app this is the only place a slow view shows up on its own: the app-wide number mixes every route together. Routes come from the app.route (or url.template) attribute on web_vital.inp.",
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

/*
 * User Flows (Pages/Rum/View/UserFlows.tsx): the tiles in
 * Components/UserFlow/UserFlowOverview.tsx, the column headers in
 * Components/UserFlow/UserFlowTables.tsx and the figures in the panel a
 * click on the map opens, Components/UserFlow/UserFlowDetailPanel.tsx (the
 * detail* keys). The map itself (UserFlowMap.tsx) is an SVG of clickable
 * nodes and bands with its own hover text and legend, so it has no (i).
 *
 * Every number is a fold of Common/Utils/Rum/UserFlow.ts over the journeys
 * Common/Server/Utils/SessionReplay/SessionReplayUserFlowReadService.ts
 * reads: the newest USER_FLOW_DEFAULT_MAX_SESSIONS (5,000) recorded
 * sessions that STARTED in the range, each one's pages in order, flattened
 * from its recording chunks (one every SESSION_REPLAY_FLUSH_INTERVAL_MS,
 * 15s). A chunk lists each page once, so a return inside one chunk is
 * lost; back-to-back repeats (a reload) are collapsed. The Sessions, Device
 * and hidden-page controls re-fold the same journeys, so "analysed" means
 * "after those filters".
 *
 * Per page, Errors and Frustrated count SESSIONS, and a signal is placed on
 * the page its chunk was flushed from (the chunk's `url`), not the page it
 * happened on. Errors are what the replay recorder counts: uncaught errors,
 * unhandled rejections and resource load failures (ErrorRecorder).
 * Frustration is rage clicks + dead clicks + error clicks + refresh rage
 * (FrustrationDetector). The Top paths "With errors" column is a SHARE of
 * the path's sessions with any error in the session, wherever it happened.
 *
 * Duration is the recorded span, first chunk start to last chunk end, so
 * idle time counts.
 *
 * Frustration signals (FrustrationDetector, SessionId): a rage click is 3+
 * clicks inside 1s within 30px; a dead click is a click on something that
 * looks clickable with no DOM change, navigation, scroll or request in 3s;
 * an error click is an error within 1s of a click; refresh rage is the
 * same scrubbed path LOADED 3+ times inside 60s (every load counts, the
 * first one included - so two reloads, or an A -> B -> A -> B -> A run of
 * full page loads).
 *
 * Map panel (buildUserFlowGraph): a node is one page at one step (column);
 * a band is one step-to-step move. "Share of" a band's ends divides by that
 * node's sessions. "Returning to a seen page" is revisitSessions, judged
 * against every page lived earlier in the journey, including pages before
 * the part the map draws. terminal is "left here" going forward and
 * "started here" going backward; on the last column, sessions whose slice
 * runs past the map are `continued`, not terminal. The neighbour lists read
 * UserFlowPageStats.previous / next (whole journeys, not one step), top
 * USER_FLOW_MAX_NEIGHBOURS (6), as a share of the page's sessions.
 */
export type RumUserFlowMetric =
  | "sessionsAnalysed"
  | "pagesPerSession"
  | "singlePageSessions"
  | "topLandingPage"
  | "topExitPage"
  | "pathSessions"
  | "pathAvgDuration"
  | "pathWithErrors"
  | "pageSessions"
  | "pageVisits"
  | "pageLanded"
  | "pageLeft"
  | "pageExitRate"
  | "pageErrors"
  | "pageFrustrated"
  | "loopSessions"
  | "detailTransitionSessions"
  | "detailShareOfSource"
  | "detailShareOfTarget"
  | "detailReturning"
  | "detailStepSessions"
  | "detailOfAllSessions"
  | "detailLeftHere"
  | "detailStartedHere"
  | "detailErrorsHere"
  | "detailCameFrom"
  | "detailWentNext"
  | "detailFoldedPages";

export const RUM_USER_FLOW_METRIC_DESCRIPTIONS: Record<
  RumUserFlowMetric,
  string
> = {
  sessionsAnalysed:
    "Session Replay recordings that started in the selected range and match the Sessions and Device filters; one whose pages are all hidden drops out. At most the newest 5,000 recordings are read, so on a busy range the line below says how many there were in total.",
  pagesPerSession:
    "The average number of pages in a session's journey, with the median below: half of the sessions saw that many pages or fewer. Going back to an earlier page counts again, but a reload counts once, a return within one recording chunk (about 15 seconds) is missed, and hidden pages are left out.",
  singlePageSessions:
    "The share of analysed sessions that saw only one page: they never moved to another page before the recording ended. Reloading the page does not count as moving on, and hidden pages are ignored. The line below is how many sessions that is.",
  topLandingPage:
    "The page the most analysed sessions started on, with their share of all analysed sessions below. Pages are compared by path without the query string; with Group IDs in URLs on, /orders/1 and /orders/2 are one page, /orders/:id.",
  topExitPage:
    "The page the most analysed sessions ended on - the last page recorded before the visitor left or the recording stopped - with their share below. A high share can simply be where journeys are meant to end, such as an order confirmation.",
  pathSessions:
    "How many analysed sessions followed exactly this journey from their first page to their last; the bar and percentage are their share of all analysed sessions. The 25 most common journeys are listed, and ones longer than 8 pages are compared on their first 8 and end in an ellipsis.",
  pathAvgDuration:
    "The average recorded length of the sessions on this path, from the start of their first recording chunk to the end of their last, idle time included. It covers the whole session, including any pages past the 8 shown.",
  pathWithErrors:
    "The share of sessions on this path that hit at least one error anywhere in the session: an uncaught JavaScript error, an unhandled promise rejection or a file that failed to load, as the replay recorder captured them.",
  pageSessions:
    "Analysed sessions that visited this page at least once. A session that came back to it later still counts once here.",
  pageVisits:
    "How many times the page was visited, counting returns after another page. A reload or two views in a row count once, and a return within the same recording chunk (about 15 seconds) is missed.",
  pageLanded:
    "Analysed sessions whose first recorded page was this one: they arrived on the application here.",
  pageLeft:
    "Analysed sessions whose last recorded page was this one: the visitor left, or the recording stopped, while on it.",
  pageExitRate:
    "Left divided by Sessions: the share of the sessions that visited this page and ended on it. Sessions that saw only this page are included, and it is per session, not per visit.",
  pageErrors:
    "Sessions that recorded an error while on this page: an uncaught JavaScript error, an unhandled promise rejection or a file that failed to load. An error is placed on the page the visitor was on when its recording chunk was sent, so one just before moving on can land on the next page.",
  pageFrustrated:
    "Sessions with a frustration signal on this page: a rage click (3 or more clicks within a second in one spot), a dead click (something that looks clickable did nothing for 3 seconds), an error within a second of a click, or the same page loaded 3 or more times in a minute. Placed on pages the same way as Errors.",
  loopSessions:
    "Sessions that left one of these pages for the other and came straight back, counted once per session however often they went round; the bar and percentage are their share of all analysed sessions. The 10 most common pairs are listed.",
  detailTransitionSessions:
    "Sessions that went straight from the first page to the second at these two steps of the map. The same move made at another step is counted on that step's band instead, and a band touching Other pages covers several pages folded together.",
  detailShareOfSource:
    "This band's sessions as a share of every session on the page it starts from, at that step of the map: of the people there, how many went this way next.",
  detailShareOfTarget:
    "This band's sessions as a share of every session on the page it leads to, at that step of the map: of the people there, how many came this way.",
  detailReturning:
    "The share of this band's sessions for which the page they moved to was one they had already visited earlier in the session, even before the part the map shows, such as going back to a list. Amber from 50%.",
  detailStepSessions:
    "Sessions that were on this page at this step of the map, each counted once. The line below is their share of every session with a page at this step, whichever page it was.",
  detailOfAllSessions:
    "This step's sessions on this page as a share of every session the map is drawn from: all analysed sessions, or with After a page or Before a page, only those that visited the chosen page.",
  detailLeftHere:
    "Sessions whose last recorded page was this one, at this step: the visitor left, or the recording stopped, here. The line below is their share of this step's sessions on the page, red from 50%. On the map's last step, sessions that went on further are not counted.",
  detailStartedHere:
    "Sessions whose first recorded page was this one, at this step before the chosen page: they arrived on the application here. The line below is their share of this step's sessions on the page. On the map's last step, sessions that came from further back are not counted.",
  detailErrorsHere:
    "Sessions at this step with an error recorded on this page, on this visit or another: an uncaught JavaScript error, an unhandled promise rejection or a failed file load. The line below counts frustration signals (rage, dead and error clicks, repeated reloads) the same way. Both are placed on pages as in the Pages table.",
  detailCameFrom:
    "Pages visited just before this one, across every analysed session that visited it, not only this step of the map. A session counts once per page, and the percentage is of all sessions that visited this page, so landings add nothing. The 6 most common are listed.",
  detailWentNext:
    "Pages visited just after this one, across every analysed session that visited it, not only this step of the map. A session counts once per page, and the percentage is of all sessions that visited this page, so sessions that left from here add nothing. The 6 most common are listed.",
  detailFoldedPages:
    "The less visited pages this step folds into Other pages, each with the sessions that were on it at this step and their share of the sessions in Other pages. The busiest pages keep their own place, as many as Pages per step allows; at most 50 are listed here.",
};

/*
 * The Session Replay Users table
 * (Components/SessionReplay/SessionReplayUsersTable.tsx), one row per
 * person, rolled up by SessionReplayReadService.listUsers over every
 * session that STARTED in the range (USER_ROLLUP_AGGREGATES):
 *  - Sessions: count(); "live" is countIf(not finalized) - which includes
 *    a session whose tabs have all closed but the finalizer has not yet
 *    reached (see SessionReplayPlayability: "Recording ended"); "first
 *    seen" is min(startTime) - within the range only.
 *  - Last seen: max(startTime), the START of the newest session.
 *  - Time: sum of each session's durationMs (start to last chunk end; for
 *    a live session the header's own span). The "N pages" line is the sum
 *    of pageCount, which the recorder counts as ROUTE CHANGES (history /
 *    hash navigations) - the landing page and full page loads add nothing.
 *  - Signals: sum(errorCount) and sum(rage + dead + error click + refresh
 *    rage). A live session's provisional header keeps the MAX of its
 *    chunks' counts, not the sum, until it is finalized. errorCount is
 *    ErrorRecorder's onError calls: each distinct error once (100 per page
 *    load, then one cap marker), and a repeat of a known one at most once
 *    per REPEAT_MARKER_INTERVAL_MS (5s).
 */
export type RumReplayUsersMetric = "sessions" | "lastSeen" | "time" | "signals";

export const RUM_REPLAY_USERS_METRIC_DESCRIPTIONS: Record<
  RumReplayUsersMetric,
  string
> = {
  sessions:
    "Recorded sessions from this person that started in the selected range. The line below shows how many are still live (not yet closed off, which can take a few minutes after the visitor leaves), or else when their earliest session in the range started - not necessarily their first visit ever.",
  lastSeen:
    "When this person's newest session in the selected range started, not when they were last active: someone still browsing in a session that began an hour ago shows an hour ago.",
  time: "Recorded time across these sessions, added up. Each runs from its start to its last recorded moment, idle time included; one still recording counts what it has so far. The line below counts page changes made inside the app without a full reload; a page opened by a full load is not counted.",
  signals:
    "Errors and frustration signals in these sessions, added up. Errors: uncaught JavaScript errors, unhandled promise rejections and failed file loads; an error that keeps repeating adds at most one every 5 seconds. Frustration: rage, dead and error clicks and repeated reloads. A live session can show fewer until it is closed off.",
};

/*
 * The Replay Health page
 * (Components/SessionReplay/RecordingHealthDashboard.tsx), read from
 * POST /telemetry/rum/session-replay/ingest-status (TelemetryAPI.ts):
 *  - Recorder loaded: RumApplication.lastSeenAt, which updateLastSeen
 *    stamps (throttled to once a minute) from the /config fetch, from
 *    replay uploads AND from every OTLP batch the app sends - so it is
 *    "the app talked to us", not strictly "the recorder loaded".
 *  - Chunks received: sessionReplayLastChunkReceivedAt, stamped once a
 *    chunk is durably stored (throttled to once a minute).
 *  - Sessions in 24h: uniqExact sessions with startTime in the last 24h;
 *    unplayable = finalized with no chunk or sealed recording-lost.
 *    Cached for SESSION_REPLAY_ACTIVITY_SUMMARY_CACHE_TTL_MS (30s).
 *  - Refused / dropped: Redis hashes per UTC DAY, read as today +
 *    yesterday (SessionReplayHealthCounters), so "last 24 hours" is 24-48h.
 *    A refusal is one per REQUEST; a drop is (mostly) one per chunk.
 *  - Bytes: the raw upload bodies the gate charged (SessionReplayUsage),
 *    per UTC day for the project and per UTC month for the application -
 *    and the monthly counter is only charged while a budget is set.
 */
export type RumRecordingHealthMetric =
  | "recorderLoaded"
  | "recordingAllowed"
  | "chunksReceived"
  | "sessionsLast24h"
  | "refusedAtGate"
  | "droppedAfterAcceptance"
  | "projectBytesToday"
  | "applicationBytesThisMonth";

export const RUM_RECORDING_HEALTH_METRIC_DESCRIPTIONS: Record<
  RumRecordingHealthMetric,
  string
> = {
  recorderLoaded:
    "The last time this application contacted OneUptime, written at most once a minute. A page fetching the Session Replay policy counts, but so does a replay upload or any other telemetry the app sends, so it can be recent even where the recorder is missing. Amber after 24 hours with nothing.",
  recordingAllowed:
    "Whether the replay policy lets recorders run, and the share of sessions recorded from their first moment. Sessions are picked by their id, so one is recorded throughout or not at all. With On error or frustration, a session outside that share still uploads once it hits an error or a frustration signal.",
  chunksReceived:
    "The last time a recording chunk (about 15 seconds of footage) from this application was stored, written at most once a minute; amber after 6 hours without one. When one refusal reason has 5 or more below, this shows how many uploads were refused instead.",
  sessionsLast24h:
    "Recorded sessions that started in the past 24 hours; the server can reuse its answer for up to 30 seconds. Playable is every session except those closed with no footage or whose recording was lost, so sessions still recording count as playable. The newest start can be older than 24 hours.",
  refusedAtGate:
    "Upload requests the server turned away, by reason. Each request counts once even when it carried several chunks. The counts are kept per UTC day and this adds today to all of yesterday, so it covers between 24 and 48 hours, not exactly the last 24.",
  droppedAfterAcceptance:
    "Chunks the server accepted with a 202 and then did not store, by reason; the recorder was never told. The counts are kept per UTC day and this adds today to all of yesterday, so it covers between 24 and 48 hours, not exactly the last 24.",
  projectBytesToday:
    "Replay upload bytes let through since 00:00 UTC for the whole project, all applications together, as the recorders sent them (usually compressed). The percentage is of this deployment's daily limit: amber from 80%, and at 100% recorders are told to stop until the next UTC day.",
  applicationBytesThisMonth:
    "Replay upload bytes this application sent since the 1st of the month (UTC), against its own monthly budget: amber from 80%, stopped at 100%. Only counted while a budget is set, so with none it reads 0, and bytes sent before a budget was set are not included.",
};
