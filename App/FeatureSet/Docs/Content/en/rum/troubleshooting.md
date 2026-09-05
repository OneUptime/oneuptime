# RUM Troubleshooting

Work down this page in order. Each step rules out one layer, and the order is the one in which these actually fail.

## 1. Is the token valid?

Check this first, because it is the cheapest check and it invalidates everything below it:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

- `200` with `"valid": true` — the token resolves to a project. Move on.
- `401` — the token is missing, malformed, unknown or revoked. Create a new one in _Project Settings → Telemetry & APM → Ingestion Keys_.

The ingest endpoints answer `401` for a bad token, which is correct per the OTLP spec (non-retryable, so compliant SDKs log it rather than retry-storming) — but that log line is easy to miss in a browser console. This endpoint gives you a direct answer.

## 2. Is anything leaving the browser?

Open DevTools → Network and filter for `otlp`. You are looking for `POST /otlp/v1/traces` returning `2xx`.

**No request at all.** The SDK never initialised. Nearly always one of:

- `telemetry.ts` is not imported first. The instrumentations patch `fetch` and `XMLHttpRequest`; anything imported before them is not traced, and if the import is tree-shaken out entirely nothing runs at all. Make it the first line of your entry point.
- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait ~30 seconds, or navigate, before concluding nothing is being sent.
- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.

**Request blocked by CSP.** The console will say so explicitly. Add:

```
connect-src 'self' https://oneuptime.com;
```

**Request blocked by CORS.** The OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a genuine CORS failure here almost always means the request is not reaching OneUptime at all — a corporate proxy, an ad blocker, or a typo in the host. Check the actual request URL in the Network tab.

**`404`.** The URL is wrong. It is `/otlp/v1/traces` — the full path, including the signal. A common mistake is setting the *base* endpoint (`https://oneuptime.com/otlp`) on an exporter that expects the full signal URL, or setting the full URL on one that appends the signal itself and produces `/otlp/v1/traces/v1/traces`.

**`413`.** The batch exceeded the reverse proxy's request-body limit — 1 MB by default in front of `/otlp`. Lower `maxExportBatchSize` on the `BatchSpanProcessor` so each export is smaller:

```ts
new BatchSpanProcessor(exporter, { maxExportBatchSize: 100 });
```

A browser rarely produces batches that large unless spans carry big attributes — an unbounded stack trace or a serialised response body on a span attribute is the usual cause, and trimming that is the better fix.

## 3. The data arrives, but under **Services** instead of **RUM**

This is the most common report, and the cause is always the same: the resource has no client attributes.

OneUptime classifies a batch as RUM only if the resource carries one of:

- **Browser:** `browser.platform`, `browser.language`, or a non-empty `browser.brands`
- **Mobile:** `device.id`, `device.model.identifier`, or `device.manufacturer`

Setting `service.name` alone produces a valid backend Service. The OpenTelemetry browser SDKs do **not** add `browser.*` unless you enable the browser resource detector or set the attributes yourself — see [Browser Setup](/docs/rum/browser-setup).

Confirm what you are actually sending by inspecting the request payload in DevTools → Network → the OTLP request → Payload. `resourceSpans[0].resource.attributes` is the list that decides this. If `browser.*` is not in there, the SDK is not adding it, whatever the documentation of that SDK says.

To fix it, add the attributes and let the app be rediscovered. The Service that was already created does not convert into a RUM application — the two are separate records — so delete the stray Service once RUM telemetry starts arriving.

## 4. Nothing appears under the application

The application exists but its tabs are empty.

- **Check the time range.** The overview defaults to the past hour. A test batch from this morning is outside it.
- **Wait a minute.** Ingest is queued, and `Last Seen` is throttled to one write per minute. A single test span can take up to a minute to be reflected.
- **Check you are looking at the right project.** The token binds telemetry to a project; if you regenerated a token from a different project, the data is there, elsewhere.

## 5. The Clients tab is empty

Client rows are recorded from `browser.platform` (web) or `device.model.identifier` (mobile). Two reasons it stays empty while everything else works:

- **Safari and Firefox.** `browserDetector` reads the UA Client Hints API, which is Chromium-only. On other browsers it sets `browser.language` — enough to classify as RUM — but not `browser.platform`. Set `browser.platform` yourself if you want those clients listed.
- **A mobile SDK that only sets `device.manufacturer`.** Classification works; the Clients inventory needs `device.model.identifier` specifically.

## 6. Core Web Vitals say "No web vitals reported yet"

The card is populated only from metrics you emit. Check, in order:

1. Do you have a **metrics** pipeline at all? Traces alone will never populate this card.
2. Is the metric name one OneUptime recognises? See [Core Web Vitals](/docs/rum/web-vitals) for the list.
3. Does the metric appear on the application's **Metrics** tab? If yes, the export works and the issue is the name or the selected range. If no, the export is not arriving — go back to step 2 of this page.
4. Did the page get closed before the export interval elapsed? INP and CLS are reported on page hide; with a 30-second interval a short visit can end before the flush.

## 7. Status shows Disconnected while the app is live

Status flips to *Disconnected* after 15 minutes with no telemetry. If your app genuinely has traffic:

- A **sampler** may be dropping everything. Check you have not set an always-off or very low ratio sampler.
- The app may only emit on specific interactions that nobody triggered in the window.
- The token may have been revoked after deployment — re-run step 1.

An internal or low-traffic app with no overnight visitors is legitimately disconnected. That is not a fault.

## 8. Session Replay problems

Session replay is a separate pipeline with its own failure modes — the recorder script, the origin allowlist, consent, CSP and masking. They have their own page: [Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting).

Start there rather than here, and start by turning on the recorder's diagnostics, because most of its failure modes are deliberately silent:

```js
localStorage.setItem("oneuptime.sessionReplay.debug", "true");
// then reload the page
```

The **Recording health** card and the **Test your installation** panel on _RUM → your application → Replay Policy_ check the token, the origin allowlists and the CSP from the server's side, and say why nothing is arriving when that is the case; the console tells you the half the server cannot see.

Worth naming here: under the default capture trigger (`Always`) a session replay recorder posts a chunk roughly every 15 seconds **while the user is interacting** — an idle tab has nothing to send, so click or move the mouse first — and after that **no chunk requests at all** means something is wrong. If the application's capture trigger is set to `On error or frustration` instead, silence is expected — it uploads only when something goes wrong. Call `OneUptimeReplay.captureSession()` to force an upload and prove the path either way.

The two pipelines are independent: a working RUM application is **not** a prerequisite for the recorder to load, and a working recorder does not imply RUM telemetry is arriving. They are configured independently and can each fail alone.

## Still stuck

Collect these before asking for help — they cut a support round trip:

- The `resource.attributes` list from an actual OTLP request payload.
- The HTTP status of that request.
- The exact `service.name` you are sending, and whether an application or a service with that name exists in the project.
- Whether `/otlp/v1/validate` returns 200 for the token in the deployed build.

Then contact support@oneuptime.com, or open an issue on [GitHub](https://github.com/OneUptime/oneuptime).
