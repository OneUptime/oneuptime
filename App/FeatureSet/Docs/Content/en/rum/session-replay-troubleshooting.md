# Session Replay Troubleshooting

By default session replay records **every** session and uploads it as it goes, so a healthy instrumented page posts a chunk roughly every 15 seconds. If you see no requests to OneUptime in the Network tab at all, something below is the reason.

The one configuration where silence is normal is capture trigger `OnErrorOrFrustration`: the recorder then holds a rolling buffer in memory and uploads **only when something goes wrong**, which is indistinguishable from a broken install until a trigger fires. Check which one you are on before hunting anything else — the `config-accepted` line below prints it.

The recorder can tell you which of the two you are looking at. Turn on diagnostics, reload once, and read the console.

## Turn on diagnostics

Pick whichever switch you can reach. They are equivalent.

**In the browser that is failing** — no redeploy, works in production, survives reloads:

```js
localStorage.setItem("oneuptime.sessionReplay.debug", "true");
// then reload the page
```

Turn it off again with:

```js
localStorage.removeItem("oneuptime.sessionReplay.debug");
```

**With a link** — for a non-technical reporter, or a page you cannot open a console on. Add `oneuptime_debug=1` to the URL. It also works in the fragment, which survives a server that strips unknown query parameters:

```
https://your-app.example.com/checkout?oneuptime_debug=1
https://your-app.example.com/checkout#oneuptime_debug=1
```

**On the script tag** — for a staging environment where you want it on for everyone:

```html
<script
  src="https://oneuptime.com/telemetry/session-replay/v1/recorder.js"
  data-oneuptime-token="YOUR_TELEMETRY_INGESTION_KEY"
  data-oneuptime-app-identifier="YOUR_RUM_APP_IDENTIFIER"
  data-oneuptime-debug="true"
  async
></script>
```

**From the init global**, if you configure the recorder that way:

```js
window.__ONEUPTIME_SESSION_REPLAY__ = {
  host: "https://oneuptime.com",
  token: "YOUR_TELEMETRY_INGESTION_KEY",
  appIdentifier: "YOUR_RUM_APP_IDENTIFIER",
  debug: true,
};
```

**From the OneUptime deployment**, which is the only switch that does not need somebody at the failing browser. Set `SESSION_REPLAY_DEBUG=true` and restart. Every recorder this instance serves then logs, on every page it runs on — so turn it on, collect one reload, and turn it off. It changes no policy: not sampling, not masking, not consent. See [Session Replay](/docs/telemetry/session-replay) for the other deployment settings.

**At runtime**, once the recorder has loaded:

```js
OneUptimeReplay.setDebug(true);
```

Output looks like this:

```
[OneUptime Session Replay] loader-start: Loader running.
[OneUptime Session Replay] init-options-read: Init options read. {host: "https://oneuptime.com", appIdentifier: "checkout-web", …}
[OneUptime Session Replay] config-fetch-start: Requesting the policy. {url: "https://oneuptime.com/telemetry/session-replay/v1/config", …}
[OneUptime Session Replay] config-accepted: Policy accepted. {captureTrigger: "Always", samplePercentage: 100, …}
[OneUptime Session Replay] recording: Recording and uploading …
```

## Get the timeline without turning anything on first

The recorder keeps its last 250 decisions **whether or not diagnostics are switched on**. If the problem already happened, you do not need to reproduce it with logging enabled — ask for this instead:

```js
copy(JSON.stringify(OneUptimeReplay.getDiagnostics(), null, 2));
```

That returns the recorder version, the session id, whether it is recording, whether it is uploading, the trigger reason, and the full record list — including the records from the **loader stub**, which runs before the recorder artifact exists and is where most stand-downs are decided. It contains no page content by construction; see [What the diagnostics never contain](#what-the-diagnostics-never-contain).

**If `OneUptimeReplay is not defined`**, the recorder artifact never loaded — which is itself the answer to a good half the codes below, and exactly when you most want the timeline. The records are still there, on a global the loader stub writes to before the artifact exists:

```js
copy(JSON.stringify(window.__ONEUPTIME_SESSION_REPLAY_DEBUG__.records, null, 2));
```

Paste either one into your support ticket. It is usually enough on its own.

## When silence is normal: the error-triggered policy

This section applies only if `config-accepted` printed `captureTrigger: "OnErrorOrFrustration"`. Under the default `Always` policy the recorder posts as it records, and silence means something is genuinely wrong — keep reading past this section.

If the console says this:

```
[OneUptime Session Replay] recording: Recording into memory. Nothing uploads until a trigger fires - call OneUptimeReplay.captureSession() to force one.
```

…then the recorder is working. Under an error-triggered policy — capture trigger `OnErrorOrFrustration`, sample percentage `0` — a healthy page makes exactly **one** request to OneUptime per page load (the config fetch) and posts nothing else until an error, a 5xx, a frustration signal or a performance budget breach happens.

To prove the whole path end to end, force an upload:

```js
OneUptimeReplay.captureSession();
```

You should immediately see a `POST /telemetry/session-replay/v1/chunk` in the Network tab and a `chunk-accepted` line in the console. If you do, the installation is correct and the replay will appear in the dashboard within a minute or so.

A `202` with `chunk-accepted` is the one to look for. A **`204`** logs `chunk-not-recorded` instead: the request was fine and the server chose not to store it — over budget, not sampled, or the application is switched off. That is a policy answer, not an installation fault, and the `server-directive` line beside it says which.

To go back to recording every session, set the capture trigger to **Always** and a sample percentage above 0 in _RUM → Session Replay Settings_. That is the shipped default.

## Codes

Every line carries a stable `code`. Look yours up here.

### Startup

| code                            | what it means                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loader-start`                  | The recorder script ran. If you do **not** see this and diagnostics are on, the script itself never executed — check the `<script>` request in the Network tab and your CSP `script-src`.                                                          |
| `init-options-read`             | Options were found. Check the `host` and `appIdentifier` in the detail: `appIdentifier` must match the RUM application exactly, and `host` must be your OneUptime origin, not your own app's.                                                     |
| `init-options-incomplete`       | A required option is missing. The detail says which of `hasHost` / `hasToken` / `hasAppIdentifier` is false. If `hasHost` is false, the script tag has no `src` the host can be derived from — add `data-oneuptime-host`.                          |
| `privacy-signal`                | The browser sends Do Not Track or Global Privacy Control and both this page and the server honour it. Nothing is recorded and no config request is made. This is not a fault. Only set `data-oneuptime-respect-do-not-track="false"` if your lawful basis genuinely does not depend on the signal. |
| `init-options-missing`          | Nothing on the page to read: no `script[data-oneuptime-token]` tag and no `window.__ONEUPTIME_SESSION_REPLAY__`. The marker attribute is misspelled, the snippet went into a different document, or a tag manager dropped it.                       |
| `loader-threw`                  | A bug in the recorder itself, not in your configuration. Please report it with the diagnostics output.                                                                                                                                             |

### Policy

| code                               | what it means                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `config-fetch-start`               | About to request the policy. The `url` in the detail is the exact URL — check it resolves from a browser.                                             |
| `config-fetch-rejected`            | The endpoint answered non-2xx. See [config fetch statuses](#config-fetch-statuses) below.                                                             |
| `config-fetch-failed`              | The request never completed at all: CSP `connect-src`, an ad blocker, DNS, TLS, offline, or a 5-second timeout. The browser usually logs its own line next to this one. |
| `config-body-unparseable`          | The endpoint answered 2xx with a body that is not JSON at all. Distinct from `config-fetch-failed`: the request *did* complete, so something on the path — a proxy, a captive portal, an SSO interstitial — answered instead of OneUptime. |
| `config-unparseable`               | The body *was* valid JSON but not an object — `null`, a string, an array. A rewriting proxy, or a server answering a different route.                 |
| `config-disabled`                  | The server says replay is off here. **The `disabledReason` in the detail is the answer** — see [disabledReason](#disabledreason) below.               |
| `config-recorder-version-invalid`  | The policy carried a `recorderVersion` that is not a plain semver, so no artifact URL could be built. A rewriting proxy or a tampered response — a deployment with no build reports `config-disabled` with `recorder-not-built` instead. |
| `config-accepted`                  | The policy was accepted. The detail is the whole policy — `captureTrigger`, `samplePercentage`, `consentMode`, `maskingMode`.                         |
| `config-value-unrecognised`        | The server sent a value this recorder build does not know, so it fell back to the **safest** one — which may not be the one your dashboard shows. Usually a recorder pinned to an older version than the server. |
| `directive-stop`                   | The server told this recorder to stand down. Check the application's ingest status for a budget, a rate limit or a kill switch.                       |

#### config fetch statuses

| status | fix                                                                                                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`  | The ingestion token is wrong, revoked or from a different project. Create one in _Project Settings → Telemetry & APM → Ingestion Keys_ and confirm it with `GET /otlp/v1/validate`. |
| `400`  | `data-oneuptime-app-identifier` is missing.                                                                                                                  |
| `404`  | The path did not resolve on the OneUptime origin. This is nearly always a wrong `data-oneuptime-host` — or a reverse proxy in front of OneUptime that does not forward `/telemetry/*`. |
| `5xx`  | A server-side fault; check the OneUptime app logs.                                                                                                           |

#### disabledReason

| value                       | what to do                                                                                                                                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not-enabled-for-application` | Session replay is off for this RUM application, the identifier does not match one, or the project is not allowed replay. Check _RUM → your application → Session Replay Settings_.                                                            |
| `recorder-not-built`        | **The deployment has no recorder artifact.** Nothing on the customer's page can fix this. The build that produces `App/FeatureSet/BrowserRecorder/public/dist/manifest.json` did not run, or its output did not reach the running image. Rebuild and redeploy the OneUptime app. This is the usual answer on a self-hosted install where replay has never worked at all. |
| `disabled-by-default`       | `SESSION_REPLAY_ENABLED_BY_DEFAULT=false` on this deployment. Set it to `true` — and set `SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY` first if you are self-hosting, because replay is the fattest table you have.                            |
| `ingest-disabled`           | `SESSION_REPLAY_INGEST_ENABLED=false` on this deployment.                                                                                                                                                                                     |
| `policy-unavailable`        | The server could not resolve the policy — usually Redis or Postgres. It fails closed on purpose. Check the OneUptime app logs.                                                                                                                 |
| `not-reported`              | The server is older than this field. Use the Dashboard's **Test your installation** panel in _RUM → Session Replay Settings_ instead.                                                                                                          |

### The artifact

| code                     | what it means                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifact-requested`     | The pinned recorder bundle is being injected. The `url` is the exact one.                                                                                                                                |
| `artifact-load-failed`   | It did not load. In order of likelihood: a CSP `script-src` that does not allow your OneUptime origin, an SRI mismatch (a proxy rewriting the bundle), or a 404 because the pinned version is not published. |
| `artifact-url-invalid`   | The policy named a version that is not a plain semver, so no URL was built. A tampered or proxied config response.                                                                                        |
| `artifact-api-missing`   | The bundle loaded but did not publish `window.OneUptimeReplay` — another script on the page overwrote it.                                                                                                 |
| `bootstrap`              | The recorder artifact is starting.                                                                                                                                                                       |
| `bootstrap-already-started` | Two copies of the snippet on one page. Remove one.                                                                                                                                                    |
| `bootstrap-already-running` | `bootstrap()` was called again while a recorder was already running. Harmless; usually a duplicated integration.                                                                                       |
| `bootstrap-cancelled`    | A `revokeConsent()` or `stop()` queued on `window.OneUptimeReplayQueue` ran before the recorder started, so this session is not recorded. Correct if your banner had already been declined.                |
| `start-stopped`          | `start()` got no usable policy on the self-hosted-bundle path. The specific reason is on the `config-*` line just above it.                                                                               |
| `rrweb-did-not-start`    | The DOM recorder declined to start. Please report it.                                                                                                                                                    |

### Recording and upload

| code                        | what it means                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not-sampled`               | This session lost the sample draw, so **nothing at all** is recorded. Sampling is deterministic in the session id, so reloading will not help this session. Raise the sample percentage.                              |
| `recording`                 | Recording. Read the detail: `uploading: true` is the normal state under the default `Always` trigger. `uploading: false` with `captureTrigger: "OnErrorOrFrustration"` is the other healthy, no-requests state.        |
| `trigger`                   | Something worth keeping happened. The `reason` is one of `error`, `frustration`, `performance`, `sampled` or `manual`.                                                                                                |
| `upload-started`            | The buffered pre-roll is being flushed. Chunk POSTs start here.                                                                                                                                                      |
| `upload-blocked-consent`    | A trigger fired and nothing was uploaded because consent was never granted. Under consent mode `RequireExplicit` your page must call `OneUptimeReplay.grantConsent()` once your banner is accepted.                    |
| `chunk-discarded-consent`   | The same cause, one layer down: a complete chunk was thrown away.                                                                                                                                                     |
| `chunk-accepted`            | A chunk landed and was stored. The installation works.                                                                                                                                                               |
| `chunk-not-recorded`        | The server took the request and deliberately did not record it — over budget, not sampled, application disabled, or the per-session chunk cap. The `server-directive` line next to it carries the reason. The installation is correct; the policy or the budget is not what you expect. |
| `chunk-post-failed`         | The POST never reached the server. CSP `connect-src`, an ad blocker, or CORS on the ingest origin.                                                                                                                    |
| `chunk-post-server-error`   | The server answered 5xx. The recorder retries; `consecutiveFailures` against `maxFlushFailures` in the detail says how close it is to giving up.                                                                      |
| `final-chunk-too-large`     | The last chunk of the session was over the 56 KB the recorder allows itself for a page-hide flush — deliberately under the browser's 64 KB combined keepalive quota — and was dropped, so the recording ends a few seconds early. Nothing else is lost. |
| `upload-blocked-transport`  | A trigger fired after uploading had already been disabled for this page. The `transport-disabled` line above it says why.                                                                                             |
| `chunk-rejected-terminal`   | Uploading has stopped for good. `status: 401` is a bad token; `status: 403` is an origin not on the application's allowlist; `status: 404` is a wrong host. Fix and reload — the recorder does not retry on its own.   |
| `chunk-refused`             | One chunk was refused (too large, or unparseable) and the recording continued without it.                                                                                                                            |
| `chunk-throttled`           | Rate limited. Uploads pause and resume on their own.                                                                                                                                                                 |
| `transport-disabled`        | The circuit breaker tripped after repeated failures. The `reason` says which.                                                                                                                                        |
| `server-directive`          | The server changed what the recorder should do mid-session. The `reason` is a closed vocabulary — `budget-exhausted`, `not-sampled`, `rate-limited`, `session-chunk-cap`.                                             |
| `recorder-stopped-by-server`| The server told the recorder to stop. Usually the daily byte budget.                                                                                                                                                 |
| `recorder-throttled-by-server` | The server asked the recorder to slow down. Uploads resume on their own; nothing to do.                                                                                                                           |
| `recorder-stopped-transport`| Uploading failed permanently, so recording stopped and the buffer was released. The `reason` is the same one `transport-disabled` reported.                                                                           |
| `recorder-stopped`          | Recording ended, with the session's totals: `droppedEvents`, `droppedChunks`, `flushFailures`. All three should be 0 on a healthy session.                                                                            |
| `session-rotated`           | The session rolled over (30 minutes idle, or 4 hours long). The recording continues under a new id.                                                                                                                  |
| `command-queue-not-an-array`| `window.OneUptimeReplayQueue` is not an array, so every command queued on it was ignored. It must be an array of `[command, argument]` pairs.                                                                         |
| `command-queue-unknown-command` | A queued command name was not recognised — check the spelling against the [public API](/docs/telemetry/session-replay).                                                                                           |

### Calls your page made

These record what your own code asked the recorder to do. They are useful for confirming that a consent banner or a manual capture actually reached the recorder, and when.

| code                   | what it means                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api-capture-session`  | `captureSession()` was called.                                                                                                                                       |
| `api-grant-consent`    | `grantConsent()` was called.                                                                                                                                         |
| `api-revoke-consent`   | `revokeConsent()` was called. Everything buffered was dropped and recording stopped — this is final for the page.                                                     |
| `api-stop`             | `stop()` was called.                                                                                                                                                 |
| `api-no-recorder`      | One of the calls above ran while no recorder was active — usually because it ran before the recorder artifact loaded. Push `[command, argument]` pairs onto `window.OneUptimeReplayQueue` instead, and they are applied as soon as it arrives. |

## No request at all in the Network tab

Work down this list; it is ordered by how often each one is the answer.

1. **Filter for `session-replay`, not for the app identifier.** The config request is a `GET`, and it is the only request a healthy non-triggered session makes.
2. **Is there a `GET .../session-replay/v1/config`?**
   - **No, and no `loader-start` in the console** → the script never executed. Check that the `<script>` element is in the DOM, that its request succeeded, and your CSP `script-src`.
   - **No, but `privacy-signal` is in the console** → Do Not Track or GPC. Working as designed.
   - **Yes, non-2xx** → see [config fetch statuses](#config-fetch-statuses).
3. **Is there no chunk `POST`?** Read the `recording` line. Under the default `Always` trigger `uploading` should be `true` and chunks should post about every 15 seconds; `uploading: false` under `OnErrorOrFrustration` is normal — call `OneUptimeReplay.captureSession()` to force one and confirm the path works.
4. **Still nothing after `captureSession()`?** Look for `upload-blocked-consent` (call `grantConsent()`), `not-sampled`, or `transport-disabled`.

## The session list says "N chunks missing", or the player draws gaps

A recording is uploaded as a numbered sequence of chunks per tab. The finalizer reports any index that never arrived as a missing chunk, and the player draws a gap wherever the sequence skips — deliberately, because the alternative is playing mutations across a hole and rendering a DOM the user never saw.

So the number is always telling the truth. What it means depends on where the hole is:

- **A hole at the very end** is the usual, benign one: the browser was closed or navigated away mid-flush. Look for `final-chunk-too-large` in the console.
- **A hole in the middle** is a chunk the server refused or never received. `chunk-refused`, `chunk-post-failed` and `chunk-not-recorded` in the console each name a different cause, and the `server-directive` line beside them carries the server's reason.
- **The same gap in the same place on every session, on a page with a large DOM**, was a defect in recorders up to 12.0.x. An rrweb full-page snapshot bigger than the 256 KB flush threshold was cut into fragments the ingest worker could never parse, so the snapshot — and every chunk index it occupied — was dropped, on every page load. Nothing on the customer's page could work around it. Upgrade OneUptime; browsers pick up the new recorder within one config cache TTL (5 minutes). Recordings already taken stay as they are.

## The RUM application says "Disconnected"

The status pill and Last Seen on _Real User Monitoring → your application_ report when telemetry last arrived for that application. Session replay counts: both a recorder fetching its policy and an accepted chunk refresh it, so an application instrumented with the replay snippet alone stays Connected. In older versions only OpenTelemetry RUM telemetry did, so a replay-only application read "Disconnected" with a Last Seen days old while its recorders were working perfectly.

"Connected" therefore means *something* is reporting — not that everything is. Page views, error rate, p95 duration and clients come from the OpenTelemetry browser SDK, which is a separate install; when those read zero while recordings are arriving, the application's Overview page says so directly.

## RUM telemetry is separate

Session replay and RUM traces are two independent pipelines with two independent failure modes. A working recorder does not imply RUM telemetry is arriving, and a working RUM application is not a prerequisite for the recorder to load.

If your **OTLP** requests are missing from the Network tab, that is the OpenTelemetry browser SDK on your page, not this recorder — see [RUM Troubleshooting](/docs/rum/troubleshooting), which covers the SDK-side causes in order.

## What the diagnostics never contain

The diagnostics carry no page content, and this is enforced rather than promised:

- The detail on every record is restricted **at the type level** to strings, numbers, booleans and null. A DOM node, a Response or any other object handed in from untyped JavaScript is replaced with `<object omitted>` before the record is created, not merely before it is printed.
- String values are truncated.
- URLs that appear in records are either OneUptime's own endpoints or already scrubbed of query strings and fragments by the same scrubber the recording itself uses.

So the output of `getDiagnostics()` is safe to paste into a support ticket. It is not safe to leave diagnostics switched **on** for every visitor of a production site — not for privacy reasons, but because it is noise in your end users' consoles.

## Still stuck

Collect these before asking for help:

- The output of `OneUptimeReplay.getDiagnostics()`.
- The status of the `session-replay/v1/config` request.
- What the Dashboard's **Test your installation** panel says (_RUM → Session Replay Settings_). It answers from the server's side, which is the half a browser cannot see.

Then contact support@oneuptime.com, or open an issue on [GitHub](https://github.com/OneUptime/oneuptime).
