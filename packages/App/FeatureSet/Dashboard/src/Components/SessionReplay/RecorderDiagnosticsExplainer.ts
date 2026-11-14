import {
  createTranslator,
  DEFAULT_LANGUAGE,
  translationKey,
  Translator,
} from "Common/Types/Translator";

/*
 * RecorderDiagnosticsExplainer: plain sentences for the JSON a customer
 * pastes from OneUptimeReplay.getDiagnostics().
 *
 * The recorder is silent by design - every gate fails closed without a
 * console line - so its diagnostics ring is the only record of WHY a page
 * recorded nothing. Each record carries a stable kebab-case `code`
 * (App/FeatureSet/BrowserRecorder/src/Debug.ts calls it "part of the
 * contract in a way the prose message is not"). This module maps every code
 * the recorder emits today to a sentence a customer can act on, picks the
 * one record that explains the outcome, and reports codes it does not know
 * rather than guessing at them.
 *
 * Pure: no React, no DOM, no fetch. The paste box on the health card and
 * the installation test both call explainRecorderDiagnostics(text).
 *
 * The code table below is the recorder's ACTUAL vocabulary, read from the
 * debugLog/debugWarn call sites across Index.ts, Loader.ts, Config.ts,
 * Recorder.ts, NetworkRecorder.ts, Transport.ts and ProductAnalytics.ts.
 * Adding a code to the recorder without adding it here makes it fall
 * through to the unknown-code copy, which
 * App/Tests/Dashboard/RecorderDiagnosticsExplainer.test.ts pins.
 *
 * Every sentence is an English key of the Dashboard's locales: the table's
 * are marked with translationKey() and looked up when a record is
 * explained, in the language of the Translator the caller hands in (the
 * paste box passes the reader's). Without one, everything is English, word
 * for word as it always was. What the recorder wrote - its codes, states,
 * reasons, versions and session ids - is kept as written.
 */

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A fixed sentence or label in the translator's language.
function translateLine(text: string, translator: Translator): string {
  return translator.translateText(text) || text;
}

export type RecorderDebugLevel = "info" | "warn";

export interface RecorderDebugCodeCopy {
  /* What happened, in the customer's terms: an English key. */
  explanation: string;
  /* What to do about it, an English key; absent when nothing needs doing. */
  action?: string;
  /*
   * True for a code that, on its own, explains why nothing recorded or
   * uploaded. The headline is built from the LAST such record.
   */
  isOutcome?: boolean;
}

export const RECORDER_DEBUG_CODE_COPY: Record<string, RecorderDebugCodeCopy> = {
  /* ---- Debug.ts ---- */
  "debug-enabled": {
    explanation: translationKey("Diagnostics were switched on for this page."),
  },

  /* ---- Loader.ts ---- */
  "loader-start": {
    explanation: translationKey("The loader script ran on the page."),
  },
  "init-options-missing": {
    explanation: translationKey(
      "The loader found no usable init options: the script tag is missing data-oneuptime-token or data-oneuptime-app-identifier, or the init global is malformed.",
    ),
    action: translationKey(
      "Compare the script tag on this page with the install snippet; both attributes are required.",
    ),
    isOutcome: true,
  },
  "artifact-requested": {
    explanation: translationKey("The loader asked for the recorder artifact."),
  },
  "artifact-load-failed": {
    explanation: translationKey(
      "The recorder artifact failed to load. On a page with a Content-Security-Policy this is almost always script-src; otherwise an ad blocker or a proxy.",
    ),
    action: translationKey(
      "Allow the OneUptime origin in script-src, then check the browser's Network tab for the recorder.js request.",
    ),
    isOutcome: true,
  },
  "artifact-api-missing": {
    explanation: translationKey(
      "The artifact loaded but did not publish its API, so the loader could not start it. This is a recorder bug or a tampered script.",
    ),
    action: translationKey(
      "Reload with cache disabled; if it persists, report it.",
    ),
    isOutcome: true,
  },
  "artifact-url-invalid": {
    explanation: translationKey(
      "The policy named a recorder version this loader will not build a URL from, so no artifact was requested.",
    ),
    action: translationKey(
      "The deployment is serving a bad recorder version; only the operator of this deployment can fix that.",
    ),
    isOutcome: true,
  },
  "directive-stop": {
    explanation: translationKey(
      "The server told this recorder to stand down: the application or project is switched off, or its budget is spent.",
    ),
    action: translationKey(
      "Check the recording switches and budgets on the application's Replay Policy page.",
    ),
    isOutcome: true,
  },
  "loader-threw": {
    explanation: translationKey(
      "The loader threw an exception. This is a recorder bug.",
    ),
    action: translationKey("Report it with this diagnostics output."),
    isOutcome: true,
  },

  /* ---- Config.ts ---- */
  "init-options-read": {
    explanation: translationKey("Init options were read successfully."),
  },
  "init-options-incomplete": {
    explanation: translationKey(
      "One init source (script tag or init global) was missing a required field and was skipped.",
    ),
    action: translationKey(
      "Only one complete source is needed; this matters when it was the only one.",
    ),
  },
  "config-fetch-start": {
    explanation: translationKey(
      "The recorder requested this application's policy.",
    ),
  },
  "config-fetch-failed": {
    explanation: translationKey(
      "The policy request never completed: a connect-src CSP rule, an ad blocker, or no network path to OneUptime.",
    ),
    action: translationKey(
      "Allow the OneUptime origin in connect-src and check the Network tab for the /config request.",
    ),
    isOutcome: true,
  },
  "config-fetch-rejected": {
    explanation: translationKey(
      "The policy endpoint refused the request: the ingestion token is wrong or revoked, or the origin is not allowed.",
    ),
    action: translationKey(
      "Confirm the token under Project Settings > Telemetry & APM > Ingestion Keys and the origin allowlists on the key and the application.",
    ),
    isOutcome: true,
  },
  "config-body-unparseable": {
    explanation: translationKey(
      "The policy endpoint answered, but not with JSON. A proxy, captive portal or CDN rule is answering instead of OneUptime.",
    ),
    action: translationKey(
      "Open the /config URL in a browser tab and see who answers.",
    ),
    isOutcome: true,
  },
  "config-unparseable": {
    explanation: translationKey(
      "The policy response was JSON but not an object. Something on the path rewrote it.",
    ),
    isOutcome: true,
  },
  "config-disabled": {
    explanation: translationKey(
      "The server says session replay is off for this application or project, so nothing is recorded.",
    ),
    action: translationKey(
      "Turn recording on for the application (Replay Policy) and the project (Settings > Session Replay).",
    ),
    isOutcome: true,
  },
  "config-recorder-version-invalid": {
    explanation: translationKey(
      "The server did not name exact lowercase latest as the recorder artifact, so no artifact can load.",
    ),
    isOutcome: true,
  },
  "config-accepted": {
    explanation: translationKey("The policy was accepted."),
  },
  "config-field-defaulted": {
    explanation: translationKey(
      "The server sent no value for one policy field, so the product default was used.",
    ),
  },
  "config-value-unrecognised": {
    explanation: translationKey(
      "This recorder build does not know a value the server sent and used the safest option instead. The recorder is older than the server.",
    ),
    action: translationKey(
      "Reload the page so it fetches the latest recorder.",
    ),
  },

  /* ---- Index.ts ---- */
  bootstrap: {
    explanation: translationKey("The recorder artifact started bootstrapping."),
  },
  "bootstrap-already-started": {
    explanation: translationKey(
      "A second start() on the same page was ignored; the first one is still in charge.",
    ),
  },
  "bootstrap-already-running": {
    explanation: translationKey(
      "bootstrap() was called again while a recorder was running and was ignored.",
    ),
  },
  "bootstrap-cancelled": {
    explanation: translationKey(
      "A queued revokeConsent() or stop() ran before start(), so no recorder was built.",
    ),
    action: translationKey(
      "Remove the queued stop, or grant consent before the page starts the recorder.",
    ),
    isOutcome: true,
  },
  "prerender-wait": {
    explanation: translationKey(
      "The browser prerendered this page before anybody opened it, so the recorder waited for the visitor to open it. A page that is never opened records nothing.",
    ),
  },
  "privacy-signal": {
    explanation: translationKey(
      "This browser sends Do Not Track or Global Privacy Control, and the policy respects it, so nothing is recorded on it.",
    ),
    action: translationKey(
      "Expected for this visitor. Test from a browser without the signal.",
    ),
    isOutcome: true,
  },
  "start-stopped": {
    explanation: translationKey(
      "start() had no usable policy and will not record anything. An earlier record says why the policy is missing.",
    ),
    isOutcome: true,
  },
  "command-queue-not-an-array": {
    explanation: translationKey(
      "window.OneUptimeReplayQueue is not an array, so commands queued before the recorder loaded were ignored.",
    ),
    action: translationKey(
      "Initialise the queue as an array, or remove the override.",
    ),
  },
  "command-queue-unknown-command": {
    explanation: translationKey(
      "A queued command was not one the recorder knows and was dropped.",
    ),
    action: translationKey(
      "Supported queue commands: grantConsent, revokeConsent, stop, captureSession, identify, track, setTags, addTag.",
    ),
  },
  "command-queue-command-failed": {
    explanation: translationKey(
      "A command queued before the recorder loaded threw while it was applied, so that one command did nothing; the record's detail names it and the error. The rest of the queue still ran.",
    ),
    action: translationKey(
      "Check the arguments your page pushes onto OneUptimeReplayQueue. A grantConsent() that failed here is the difference between a session that uploads and one that never does.",
    ),
  },
  "api-grant-consent": {
    explanation: translationKey("grantConsent() was called."),
  },
  "api-revoke-consent": {
    explanation: translationKey("revokeConsent() was called."),
  },
  "api-stop": { explanation: translationKey("stop() was called by the page.") },
  "api-capture-session": {
    explanation: translationKey("captureSession() was called."),
  },
  "api-no-recorder": {
    explanation: translationKey(
      "The page called the recorder API while no recorder was running, so the call did nothing.",
    ),
    action: translationKey(
      "Call the API after the recorder started, or use the command queue.",
    ),
  },
  "metric-analytics-off": {
    explanation: translationKey(
      "metric() was called while the application has product analytics events off, so nothing was sent.",
    ),
    action: translationKey(
      "Turn product analytics events on under Analytics Settings.",
    ),
  },

  /* ---- Recorder.ts ---- */
  "not-sampled": {
    explanation: translationKey(
      "This session was not selected by the sample percentage, so it records nothing. That is sampling working, not a fault.",
    ),
    action: translationKey(
      "Raise the sample percentage, or reload to draw a new session.",
    ),
    isOutcome: true,
  },
  recording: { explanation: translationKey("Recording started on this page.") },
  trigger: {
    explanation: translationKey(
      "A capture trigger fired (error, frustration or performance budget); this session may upload now.",
    ),
  },
  "upload-started": {
    explanation: translationKey(
      "Uploading started; the buffered pre-roll was flushed.",
    ),
  },
  "upload-blocked-consent": {
    explanation: translationKey(
      "A trigger fired but consent was never granted, so nothing was uploaded.",
    ),
    action: translationKey(
      "Call OneUptimeReplay.grantConsent() once the visitor consents.",
    ),
    isOutcome: true,
  },
  "upload-blocked-transport": {
    explanation: translationKey(
      "A trigger fired but uploading was already disabled for this page by an earlier refusal.",
    ),
    isOutcome: true,
  },
  "chunk-discarded-consent": {
    explanation: translationKey(
      "A chunk was built but consent does not allow uploading, so it was discarded.",
    ),
    action: translationKey(
      "Call OneUptimeReplay.grantConsent() once the visitor consents.",
    ),
    isOutcome: true,
  },
  "session-rotated": {
    explanation: translationKey(
      "A new session started here: the user came back after 30 minutes idle, the session reached its length cap, a different user signed in, or another tab started one first.",
    ),
  },
  "session-ended-idle": {
    explanation: translationKey(
      "Nothing happened on the page for 30 minutes, so the session ended at the last activity. Nothing more is recorded until the user comes back, which starts a new session.",
    ),
  },
  "recording-paused-idle": {
    explanation: translationKey(
      "Nobody touched the page for 5 minutes, so recording paused. Nothing is captured or uploaded until the next key, click, scroll or touch, which resumes the same session.",
    ),
  },
  "recording-resumed": {
    explanation: translationKey(
      "The user came back after recording paused for inactivity, and recording resumed in the same session on a fresh snapshot.",
    ),
  },
  /*
   * The page's own OneUptimeReplay.pause() and resume() (the Dashboard
   * pauses on every page but its first-run ones, #6834). Neither is an
   * outcome: a pause the page meant is no fault, and as the headline it
   * would outlast a resume after it.
   */
  "recording-paused-page": {
    explanation: translationKey(
      "The page paused recording with OneUptimeReplay.pause(). Nothing is captured until the page calls OneUptimeReplay.resume(); the visitor's input keeps the session open but does not resume recording.",
    ),
    action: translationKey(
      "If this page should be recorded, find where it calls OneUptimeReplay.pause().",
    ),
  },
  "recording-resumed-page": {
    explanation: translationKey(
      "The page resumed recording with OneUptimeReplay.resume(). Recording goes on in the same session from a fresh snapshot, or in a new session if that one ended while recording was paused.",
    ),
  },
  "recorder-stopped": {
    explanation: translationKey("Recording stopped on this page."),
  },
  "recorder-stopped-by-server": {
    explanation: translationKey(
      "The server told this recorder to stop, and recording ended. The reason is in the directive record before it.",
    ),
    isOutcome: true,
  },
  "recorder-stopped-transport": {
    explanation: translationKey(
      "Uploading failed for good, so recording stopped.",
    ),
    isOutcome: true,
  },
  "recorder-throttled-by-server": {
    explanation: translationKey(
      "The server asked this recorder to slow down; uploads pause and resume on their own.",
    ),
  },
  "rrweb-did-not-start": {
    explanation: translationKey(
      "The DOM recorder declined to start, so no screen was captured. This happens on pages that block MutationObserver or run in an unusual document.",
    ),
    isOutcome: true,
  },
  "rrweb-error": {
    explanation: translationKey(
      "The DOM recorder reported an internal error; the recording may skip or freeze around this point.",
    ),
  },
  "final-flush-truncated": {
    explanation: translationKey(
      "When the page closed, more footage was open than one keepalive request may carry, so the OLDEST events of that last stretch were dropped rather than minting a chunk the browser would refuse. The detail says how many events went.",
    ),
    action: translationKey(
      "Nothing to change: the alternative is losing the whole final chunk. The recording's very end is intact; the moments before it may skip.",
    ),
  },
  "envelope-trimmed": {
    explanation: translationKey(
      "One chunk's envelope was over the server's size limit, so optional fields were dropped to fit it - the record's detail lists which ones. The footage in that chunk was kept and uploaded.",
    ),
    action: translationKey(
      "Nothing to do unless a field you rely on is listed: tags and identity traits are shed first, then fidelity notices.",
    ),
  },

  /* ---- NetworkRecorder.ts ---- */
  "same-origin-propagation": {
    explanation: translationKey(
      "Whether this page's requests to its own origin carry trace context (a traceparent and a tracestate naming this session) so backend telemetry links to the recording. The detail says enabled true or false, and why: on, policy-off (the application's Same-origin trace propagation switch is off), or opaque-origin (a sandboxed frame, about:blank, srcdoc or file: page, whose requests the browser does not treat as same-origin). Even when on, nothing is added until the session is uploading with consent. A second record with reason agent-stand-down, logged once per page load, names the agent (DD_RUM, NREUM or elasticApm) that is set up to put its own traceparent on this page's own requests: Datadog RUM with a tracked session and the request's URL in allowedTracingUrls, New Relic with distributed tracing on, or an active Elastic APM agent with distributed tracing on under the traceparent header name. The recorder then leaves the traceparent to that agent and adds only its tracestate, so a request links only if that agent really adds a W3C traceparent.",
    ),
    action: translationKey(
      "If backend logs and traces should link to recordings and the reason is policy-off, turn Same-origin trace propagation on in the application's Replay Policy. With agent-stand-down, what to change depends on the named agent. DD_RUM: a request with a tracestate naming the session but no traceparent is usually a session Datadog does not trace-sample (traceSampleRate below 100); set traceSampleRate: 100 in its init (traceContextInjection: \"all\" also sends a traceparent there, but flagged not sampled, so a default ParentBased backend drops those traces anyway), and make sure the allowedTracingUrls entry for your own origin keeps the tracecontext propagator. elasticApm: make sure its fetch and xmlhttprequest instrumentations are not listed in disableInstrumentations. NREUM: nothing to change on New Relic - it already sends a traceparent, but with its own tracestate in place of the session's, so those requests are not stamped with the session and link only by trace id, when the recording saw the traceparent (XHR and Request inputs).",
    ),
  },
  "same-origin-propagation-tripped": {
    explanation: translationKey(
      "A same-origin request the recorder had added trace headers to failed at the network level - typically a redirect to another origin (a presigned download URL, a CDN) that does not allow those headers - so the recorder stopped adding them for the rest of this page load. With retried: true it was a GET or HEAD, sent again without the headers, and the page saw that result; an XMLHttpRequest cannot be retried.",
    ),
    action: translationKey(
      "Allow traceparent and tracestate in Access-Control-Allow-Headers on the redirect target, or turn Same-origin trace propagation off for this application.",
    ),
  },

  /* ---- Transport.ts ---- */
  "chunk-accepted": {
    explanation: translationKey("A chunk was accepted by the server."),
  },
  "chunk-not-recorded": {
    explanation: translationKey(
      "The server accepted the request but deliberately did not record the chunk (not sampled server-side, or a policy that no longer records).",
    ),
    isOutcome: true,
  },
  "chunk-refused": {
    explanation: translationKey(
      "The server refused one chunk; recording continued without it. The reason code the server answered is in the record's detail.",
    ),
  },
  "chunk-refused-terminal": {
    explanation: translationKey(
      "The server will refuse every chunk from this recorder, so uploading stopped. Usually a revoked token, a refused origin, or a switched-off application.",
    ),
    action: translationKey(
      "Read the reason in the record's detail; it matches the refusal counters on the health card.",
    ),
    isOutcome: true,
  },
  "chunk-rejected-terminal": {
    explanation: translationKey(
      "Uploading stopped for good: the server rejected this recorder outright.",
    ),
    isOutcome: true,
  },
  "chunk-too-large": {
    explanation: translationKey(
      "One chunk was over the per-request size limit even after compression - almost always a full snapshot of a very large DOM. Its SIZE was declared and its bytes were not uploaded, so the session survives with a gap there instead of spending the visitor's uplink on a request the server cannot accept.",
    ),
    action: translationKey(
      "The player marks the gap. If it repeats, the pages involved have an unusually large DOM; blocking a heavy region with a block selector shrinks the snapshot.",
    ),
  },
  "chunk-post-failed": {
    explanation: translationKey(
      "A chunk upload never reached the server: a connect-src CSP rule, an ad blocker, or the network.",
    ),
    action: translationKey(
      "Allow the OneUptime origin in connect-src and check the Network tab for the chunk request.",
    ),
    isOutcome: true,
  },
  "chunk-post-server-error": {
    explanation: translationKey(
      "The server could not accept a chunk (5xx); it will be retried.",
    ),
  },
  "chunk-throttled": {
    explanation: translationKey(
      "Uploads were rate limited; they pause and resume on their own.",
    ),
  },
  "chunk-retry-scheduled": {
    explanation: translationKey("Uploading will be retried after a pause."),
  },
  "chunk-retry": { explanation: translationKey("Queued chunks were retried.") },
  "chunk-abandoned": {
    explanation: translationKey(
      "One chunk failed too many times and was dropped; uploading continued. The recording has a gap there.",
    ),
  },
  "final-chunk-carried-queue": {
    explanation: translationKey(
      "Queued chunks were sent along with the final chunk on page exit.",
    ),
  },
  "final-chunk-too-large": {
    explanation: translationKey(
      "A chunk sent as the page went away was over the browser's keepalive quota. With sealed: true in the detail it was the final chunk: its events were dropped, so the last seconds before the page closed are missing, and an empty final chunk sealed the session in its place, so the session still ends with the tab instead of waiting for the idle timeout. With sealed: false it was not a final chunk: that chunk was dropped whole, nothing was sealed, and the session stays open with a gap where the chunk was.",
    ),
  },
  "final-flush-partial": {
    explanation: translationKey(
      "On page exit the browser's keepalive quota could not carry every queued chunk. The detail says how many were sent and how many were dropped; that session has a gap at the end.",
    ),
    action: translationKey(
      "Expected when a tab closes with a backlog (an offline spell, or a very busy page). Worth looking at only if it repeats on ordinary sessions.",
    ),
  },
  "chunk-held-offline": {
    explanation: translationKey(
      "The device has no connection, so this chunk is waiting instead of uploading. Recording continues, the retry costs no strike and nothing is lost; the detail says how many chunks are waiting and when the next attempt is.",
    ),
  },
  "back-online": {
    explanation: translationKey(
      "The first upload after an outage reached the server. The chunks kept while offline are being uploaded, oldest first.",
    ),
  },
  "browser-offline": {
    explanation: translationKey(
      "The browser reported that it went offline. Recording continues, and the recorder opens its offline store so the chunks of a tab closed now are kept.",
    ),
  },
  "browser-online": {
    explanation: translationKey(
      "The browser reported that it is back online, so the queued chunks are being uploaded now instead of waiting for the retry timer.",
    ),
  },
  "offline-queue-full": {
    explanation: translationKey(
      "The outage lasted longer than the upload queue can hold, so the oldest chunks were dropped to keep the newest. The recording has a gap where they were.",
    ),
    action: translationKey(
      "Expected only after a long time offline. If it happens on short outages, check whether uploads were already failing before the connection dropped.",
    ),
  },
  "offline-flush-stored": {
    explanation: translationKey(
      "The page was hidden or closed while offline, so its last chunks were saved in the browser (IndexedDB) instead of being uploaded. The next page of the application uploads them. With storeOpen: false the store had not finished opening, and a closing tab may still have lost them.",
    ),
  },
  "final-flush-deferred": {
    explanation: translationKey(
      "The request sent as the page went away could not carry every chunk, so the rest were saved in the browser for the next page to upload instead of being dropped.",
    ),
  },
  "offline-chunks-restored": {
    explanation: translationKey(
      "This page found chunks that an earlier page recorded while offline and could not send, and is uploading them ahead of its own.",
    ),
  },
  "offline-chunk-claimed-elsewhere": {
    explanation: translationKey(
      "Another tab of the same application already uploaded a chunk this tab had saved, so this tab skipped it. Nothing is missing.",
    ),
  },
  "server-directive": {
    explanation: translationKey(
      "The server changed what this recorder should do (stop, throttle or continue). The directive and its reason are in the record's detail.",
    ),
  },
  "transport-disabled": {
    explanation: translationKey("Uploading stopped for good on this page."),
    action: translationKey(
      "Fix the cause named in the records above, then reload.",
    ),
    isOutcome: true,
  },

  /*
   * ---- ProductAnalytics.ts ----
   * The product analytics events sent beside the recording. None is an
   * outcome: they say nothing about whether the page recorded.
   */
  "analytics-started": {
    explanation: translationKey(
      "The application has product analytics events on, so the recorder sends each session's start, its page views and the page's track() and metric() calls, from every session, recorded or not. The detail's userPropertyKeys counts the user properties the events keep.",
    ),
  },
  "metric-name-refused": {
    explanation: translationKey(
      "metric() was given a name it cannot send, so nothing was sent. The detail shows that name, or its type if it was not a string.",
    ),
    action: translationKey(
      'Use a name that starts with a letter and holds only letters, digits, underscores, dots, hyphens and slashes, at most 100 characters. A name starting with "oneuptime." is reserved for OneUptime\'s own metrics.',
    ),
  },
  "metric-value-refused": {
    explanation: translationKey(
      "metric() was given a value that is not a finite number, so nothing was sent. The detail names the metric.",
    ),
    action: translationKey(
      "Pass the metric's value as a finite number, such as 42.5, not as a string.",
    ),
  },
  "analytics-stopped": {
    explanation: translationKey(
      "The server will not take this page's product analytics events, so none are sent from it again. The detail gives the status and the server's reason: 204 means the application has them or Session Replay off, 403 that the page's origin is not allowed, and 400 that the recorder sent a batch the server cannot read.",
    ),
    action: translationKey(
      "For 204, turn product analytics events on under Analytics Settings and Session Replay on under Replay Policy. For 403, add this page's origin to the allowed origins under Replay Policy.",
    ),
  },
};

export const UNKNOWN_RECORDER_DEBUG_CODE_COPY: string = translationKey(
  "This code is newer than this dashboard's explanations. The troubleshooting docs list every code.",
);

export interface ExplainedRecorderRecord {
  code: string;
  level: RecorderDebugLevel;
  atUnixMs: number | null;
  /* The recorder's own short message, kept beside the explanation. */
  message: string;
  explanation: string;
  action: string | null;
  isKnown: boolean;
  detail: Record<string, string | number | boolean | null>;
}

export interface ExplainedRecorderFact {
  label: string;
  value: string;
}

export interface RecorderDiagnosticsExplanation {
  /* One sentence: what the recorder concluded on that page. */
  headline: string;
  /* Version, session, state, stop reason, decisions. */
  facts: Array<ExplainedRecorderFact>;
  records: Array<ExplainedRecorderRecord>;
  unknownCodes: Array<string>;
  capabilities: Array<string>;
  warnCount: number;
}

export type RecorderDiagnosticsResult =
  | { ok: true; explanation: RecorderDiagnosticsExplanation }
  | { ok: false; error: string };

/*
 * Explain one code, in the translator's language. Unknown codes fall back,
 * never throw.
 */
export function explainRecorderDebugCode(
  code: string,
  translator: Translator = ENGLISH,
): {
  explanation: string;
  action: string | null;
  isKnown: boolean;
} {
  const copy: RecorderDebugCodeCopy | undefined =
    Object.prototype.hasOwnProperty.call(RECORDER_DEBUG_CODE_COPY, code)
      ? RECORDER_DEBUG_CODE_COPY[code]
      : undefined;

  if (!copy) {
    return {
      explanation: translateLine(UNKNOWN_RECORDER_DEBUG_CODE_COPY, translator),
      action: null,
      isKnown: false,
    };
  }

  return {
    explanation: translateLine(copy.explanation, translator),
    action:
      copy.action === undefined ? null : translateLine(copy.action, translator),
    isKnown: true,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(row: Record<string, unknown>, key: string): string | null {
  const value: unknown = row[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

/*
 * The detail map is what the recorder redacted to primitives; we keep only
 * primitives again so a hand-edited paste cannot smuggle an object into
 * the DOM through it.
 */
function readDetail(
  value: unknown,
): Record<string, string | number | boolean | null> {
  const row: Record<string, unknown> | null = asRecord(value);
  const detail: Record<string, string | number | boolean | null> = {};

  if (!row) {
    return detail;
  }

  for (const key of Object.keys(row)) {
    const entry: unknown = row[key];

    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      detail[key] = entry;
    }
  }

  return detail;
}

function explainRecord(
  value: unknown,
  translator: Translator,
): ExplainedRecorderRecord | null {
  const row: Record<string, unknown> | null = asRecord(value);

  if (!row) {
    return null;
  }

  const code: string | null = readString(row, "code");

  if (!code) {
    return null;
  }

  const explained: {
    explanation: string;
    action: string | null;
    isKnown: boolean;
  } = explainRecorderDebugCode(code, translator);
  const at: unknown = row["atUnixMs"];

  return {
    code: code,
    level: row["level"] === "warn" ? "warn" : "info",
    atUnixMs: typeof at === "number" && Number.isFinite(at) ? at : null,
    message: readString(row, "message") ?? "",
    explanation: explained.explanation,
    action: explained.action,
    isKnown: explained.isKnown,
    detail: readDetail(row["detail"]),
  };
}

/*
 * The headline is the last OUTCOME record, because a long-lived tab's most
 * recent decision is the one that explains what it is doing now (Debug.ts
 * drops the oldest records for the same reason). When no outcome record
 * exists the recorder's own state fields decide.
 */
function buildHeadline(
  root: Record<string, unknown>,
  records: Array<ExplainedRecorderRecord>,
  translator: Translator,
): string {
  for (let index: number = records.length - 1; index >= 0; index--) {
    const record: ExplainedRecorderRecord = records[
      index
    ] as ExplainedRecorderRecord;
    const copy: RecorderDebugCodeCopy | undefined =
      RECORDER_DEBUG_CODE_COPY[record.code];

    if (copy?.isOutcome) {
      return record.explanation;
    }
  }

  if (root["isUploading"] === true) {
    return translateLine(
      "The recorder is recording and uploading on this page.",
      translator,
    );
  }

  if (root["isRecording"] === true) {
    return translateLine(
      "The recorder is recording on this page; nothing has triggered an upload yet.",
      translator,
    );
  }

  const bootstrapDecision: string | null = readString(
    root,
    "bootstrapDecision",
  );

  if (bootstrapDecision === "not-started") {
    return translateLine(
      "The recorder artifact never started on this page; the loader's records above say where it stopped.",
      translator,
    );
  }

  const stopReason: string | null = readString(root, "stopReason");

  if (stopReason) {
    // The reason is the recorder's own word, kept as written.
    return translator.translateTemplate("The recorder stopped ({{reason}}).", {
      reason: stopReason,
    });
  }

  return translateLine(
    "No outcome record was found; the records below list what the recorder did.",
    translator,
  );
}

function describeDecisions(
  value: unknown,
  translator: Translator,
): Array<ExplainedRecorderFact> {
  const decisions: Record<string, unknown> | null = asRecord(value);

  if (!decisions) {
    return [
      {
        label: translateLine("Decisions", translator),
        value: translateLine(
          "none yet: no recorder object was built on this page",
          translator,
        ),
      },
    ];
  }

  const facts: Array<ExplainedRecorderFact> = [];

  if (typeof decisions["isSampled"] === "boolean") {
    facts.push({
      label: translateLine("Sampled", translator),
      value: translateLine(
        decisions["isSampled"] ? "yes" : "no: this session records nothing",
        translator,
      ),
    });
  }

  const trigger: string | null = readString(decisions, "captureTrigger");

  if (trigger) {
    facts.push({
      label: translateLine("Capture trigger", translator),
      value: trigger,
    });
  }

  const consentMode: string | null = readString(decisions, "consentMode");
  const consentState: string | null = readString(decisions, "consentState");

  if (consentMode) {
    facts.push({
      label: translateLine("Consent", translator),
      value: consentState ? `${consentMode} (${consentState})` : consentMode,
    });
  }

  if (typeof decisions["uploadsAllowed"] === "boolean") {
    const blockedBy: string | null = readString(decisions, "uploadBlockedBy");

    let uploads: string = translateLine("allowed", translator);

    if (!decisions["uploadsAllowed"]) {
      // What blocked them is the recorder's own word, kept as written.
      uploads = blockedBy
        ? translator.translateTemplate("blocked by {{reason}}", {
            reason: blockedBy,
          })
        : translateLine("blocked", translator);
    }

    facts.push({
      label: translateLine("Uploads", translator),
      value: uploads,
    });
  }

  const lastDirective: string | null = readString(decisions, "lastDirective");

  if (lastDirective) {
    const reason: string | null = readString(decisions, "lastDirectiveReason");

    facts.push({
      label: translateLine("Last server directive", translator),
      value: reason ? `${lastDirective} (${reason})` : lastDirective,
    });
  }

  const startDecision: string | null = readString(decisions, "startDecision");

  if (startDecision) {
    facts.push({
      label: translateLine("Start decision", translator),
      value: startDecision,
    });
  }

  return facts;
}

/*
 * Accepts the whole getDiagnostics() object, or just its `records` array,
 * or a JSON string of either. Never throws: malformed input is reported as
 * an error the paste box can print. Every sentence and label it writes is
 * in the translator's language; the recorder's own words are kept as
 * written.
 */
export function explainRecorderDiagnostics(
  input: string | unknown,
  translator: Translator = ENGLISH,
): RecorderDiagnosticsResult {
  let parsed: unknown = input;

  if (typeof input === "string") {
    const trimmed: string = input.trim();

    if (trimmed.length === 0) {
      return {
        ok: false,
        error: translateLine(
          "Nothing to explain yet. Paste the output of OneUptimeReplay.getDiagnostics() from the page's console.",
          translator,
        ),
      };
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error: translateLine(
          "That is not JSON. In the console run copy(JSON.stringify(OneUptimeReplay.getDiagnostics())) and paste the result here.",
          translator,
        ),
      };
    }
  }

  let root: Record<string, unknown> = {};
  let rawRecords: unknown = null;

  if (Array.isArray(parsed)) {
    rawRecords = parsed;
  } else {
    const object: Record<string, unknown> | null = asRecord(parsed);

    if (!object) {
      return {
        ok: false,
        error: translateLine(
          "Expected the getDiagnostics() object or its records array, got something else.",
          translator,
        ),
      };
    }

    root = object;
    rawRecords = object["records"];
  }

  if (!Array.isArray(rawRecords)) {
    return {
      ok: false,
      error: translateLine(
        "No records array found. getDiagnostics() always returns one, even when diagnostics were never switched on.",
        translator,
      ),
    };
  }

  const records: Array<ExplainedRecorderRecord> = [];
  const unknownCodes: Array<string> = [];

  for (const entry of rawRecords) {
    const explained: ExplainedRecorderRecord | null = explainRecord(
      entry,
      translator,
    );

    if (!explained) {
      continue;
    }

    records.push(explained);

    if (!explained.isKnown && !unknownCodes.includes(explained.code)) {
      unknownCodes.push(explained.code);
    }
  }

  const facts: Array<ExplainedRecorderFact> = [];
  const version: string | null = readString(root, "version");

  if (version) {
    facts.push({
      label: translateLine("Recorder version", translator),
      value: version,
    });
  }

  const sessionId: string | null = readString(root, "sessionId");

  facts.push({
    label: translateLine("Session", translator),
    value:
      sessionId ??
      translateLine("none: no session was started on this page", translator),
  });

  const state: string | null = readString(root, "state");

  if (state) {
    facts.push({ label: translateLine("State", translator), value: state });
  }

  const stopReason: string | null = readString(root, "stopReason");

  if (stopReason) {
    facts.push({
      label: translateLine("Stop reason", translator),
      value: stopReason,
    });
  }

  const bootstrapDecision: string | null = readString(
    root,
    "bootstrapDecision",
  );

  if (bootstrapDecision) {
    facts.push({
      label: translateLine("Bootstrap", translator),
      value: bootstrapDecision,
    });
  }

  const triggerReason: string | null = readString(root, "triggerReason");

  if (triggerReason) {
    facts.push({
      label: translateLine("Upload trigger", translator),
      value: triggerReason,
    });
  }

  if ("decisions" in root) {
    facts.push(...describeDecisions(root["decisions"], translator));
  }

  const capabilities: Array<string> = Array.isArray(root["capabilities"])
    ? (root["capabilities"] as Array<unknown>).filter(
        (entry: unknown): entry is string => {
          return typeof entry === "string";
        },
      )
    : [];

  return {
    ok: true,
    explanation: {
      headline: buildHeadline(root, records, translator),
      facts: facts,
      records: records,
      unknownCodes: unknownCodes,
      capabilities: capabilities,
      warnCount: records.filter((record: ExplainedRecorderRecord): boolean => {
        return record.level === "warn";
      }).length,
    },
  };
}
