# OneUptime Session Replay — Browser Recorder

The recorder that runs on a **customer's** website. It is the only OneUptime
bundle that executes on a third-party origin, in an end user's browser, over
content we do not own — so almost every decision in here is a privacy or a
politeness decision rather than a functional one.

## What it does

Records the DOM with [rrweb](https://github.com/rrweb-io/rrweb) into a bounded
in-memory ring buffer, and uploads **only when something actually went wrong**:
an uncaught error, an unhandled rejection, a 5xx from an instrumented request,
a frustration signal, an explicit `captureSession()`, or a deterministic
sample. That single decision cuts storage and privacy exposure by roughly 15x
versus recording everyone, and turns "a 10% chance a recording exists when an
engineer looks" into "nearly always, for the sessions that failed".

Masking happens **at capture, in the browser, before compression**. The server
never receives unmasked content, so nothing here can be repaired after the
fact.

## Installing it on a site

```html
<script
  src="https://oneuptime.com/telemetry/session-replay/v1/recorder.js"
  data-oneuptime-host="https://oneuptime.com"
  data-oneuptime-token="YOUR_TELEMETRY_INGESTION_KEY"
  data-oneuptime-app-identifier="YOUR_RUM_APP_IDENTIFIER"
  async
></script>
```

Or, if you prefer configuring before the tag loads:

```html
<script>
  window.__ONEUPTIME_SESSION_REPLAY__ = {
    host: "https://oneuptime.com",
    token: "YOUR_TELEMETRY_INGESTION_KEY",
    appIdentifier: "YOUR_RUM_APP_IDENTIFIER",
    userRef: "user-1234", // optional, hashed server-side
  };
</script>
<script
  src="https://oneuptime.com/telemetry/session-replay/v1/recorder.js"
  async
></script>
```

### Content Security Policy

A customer with `script-src 'self'` cannot load the recorder, and
`connect-src 'self'` blocks ingest. **Both fail silently**, so if you have a
CSP you need these directives:

```
script-src  https://oneuptime.com;
connect-src https://oneuptime.com;
```

If you self-host the bundle or proxy `/session-replay/*` through your own
domain, substitute your origin. Use the Dashboard's "test your installation"
panel to confirm — server telemetry cannot see a recorder that never loaded.

### Public API

Available on `window.OneUptimeReplay` once the artifact has loaded, and via a
`window.OneUptimeReplayQueue` array of `[command, argument]` pairs for calls
made before it arrives.

| call                | effect                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `grantConsent()`    | permits upload; required when the app's consent mode is `RequireExplicit`                  |
| `revokeConsent()`   | drops the buffer, clears the stored session identity, stops recording. Final for the page. |
| `captureSession()`  | uploads this session even though nothing went wrong                                        |
| `identify(userRef)` | attaches an opaque user reference (hashed server-side unless identity capture is enabled)  |
| `stop()`            | stops recording                                                                            |
| `getSessionId()`    | the current session id, or null                                                            |

## Two-stage load

`/telemetry/session-replay/v1/recorder.js` is a **~1.9 KB gzip loader stub**
served with `Cache-Control: max-age=300`. It fetches the policy, honours
`enabled` / consent / DNT / GPC, and only then injects the pinned artifact at
`/telemetry/session-replay/v<semver>/recorder.js`, which is immutable for a
year and carries an SRI hash.

This split is the whole reason a bad masking release is recoverable. Without
it, a regression is live in every customer's browser for the full cache TTL
with no remedy — they are third parties, and we cannot reach their end users.
With it, rolling back is one field in the config response, and the kill switch
stops **recording** rather than merely stopping ingest.

`public/dist/manifest.json` carries the version, the gzip sizes and the
SHA-384 integrity hashes. It is the **single source of truth** for which
version is published: read it through `Manifest.ts` (`getRecorderVersion()`,
`getRecorderIntegrity()`, `getPinnedRecorderPath()`), never from an
independently-defaulted env var. Two answers to "which version is live" cannot
be kept in step by hand, and the failure mode is silent — a loader told to
fetch a version that was never published just 404s and the page records
nothing.

`src/Config.ts` validates `recorderVersion` against
`/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/` before it will build an artifact
URL, and refuses to build one at all otherwise. The same pattern is asserted in
the build and in `Manifest.ts`; `Tests/RecorderManifest.test.ts` fails if the
three ever drift.

### The route the artifacts need

Not mounted by this package — it has no server. Whatever mounts it must serve:

| path                                              | file                    | headers                                                              |
| ------------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `/telemetry/session-replay/v1/recorder.js`        | `public/dist/loader.js` | `Cache-Control: public, max-age=300`                                 |
| `/telemetry/session-replay/v<semver>/recorder.js` | `public/dist/recorder.js` (only when `<semver>` equals the manifest's version) | `Cache-Control: public, max-age=31536000, immutable` |

Both need `Content-Type: application/javascript; charset=utf-8`,
`Access-Control-Allow-Origin: *` (the artifact is loaded cross-origin with
`crossorigin="anonymous"`, which SRI requires), and no cookies. The config
endpoint must return the manifest's `recorder.js` integrity hash as
`recorderIntegrity`, or the loader injects a script tag with no integrity
attribute and the SRI pin is inert.

## Privacy model

| control                 | behaviour                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| masking mode            | `MaskAllText` by default: every text node and every input value becomes a fixed-width placeholder. `MaskInputsOnly` is offered and labelled less safe.                                                                      |
| input values            | masked in **every** mode, including `MaskInputsOnly`                                                                                                                                                                        |
| mask width              | fixed, never derived from the value's length. rrweb's default `'*'.repeat(value.length)` is a length oracle for passwords, OTPs and card numbers.                                                                           |
| sticky password masking | once a node has ever been `type=password` or carried a sensitive `autocomplete` token it stays masked for the life of the page, **and the `type` mutation from a show-password toggle is suppressed from the event stream** |
| file inputs             | value always blanked; the DOM value is `C:\fakepath\<real filename>` and filenames are routinely personal                                                                                                                   |
| input timing            | quantised to 250 ms buckets, because inter-keystroke timing is a published side channel even for a masked field                                                                                                             |
| URLs                    | origin + path only; query and fragment dropped; uuid / object-id / email / long-digit / opaque-token path segments redacted. Applied to the chunk URL, the entry URL, rrweb `Meta` hrefs and every network event.           |
| network                 | method, scrubbed URL, status, duration, size. **Never bodies. `Authorization` and `Cookie` are never even read.**                                                                                                           |
| console                 | `error` and `warn` only, arguments masked through the text-node transform, objects described rather than serialised                                                                                                         |
| DNT / GPC               | honoured before rrweb loads. Only the page **and** the server policy both opting out can disable honouring.                                                                                                                 |
| consent                 | in `RequireExplicit` the recorder buffers but uploads nothing until `grantConsent()`; `revokeConsent()` drops everything                                                                                                    |
| copy / paste / cut      | never recorded                                                                                                                                                                                                              |
| `.oneuptime-block`      | element excluded from the DOM entirely                                                                                                                                                                                      |
| `.oneuptime-mask`       | element's text masked                                                                                                                                                                                                       |
| `.oneuptime-ignore`     | element's input events dropped                                                                                                                                                                                              |

### Known limits, stated plainly

- **Attribute values are recorded verbatim.** `data-email="..."`, a `title`
  attribute or an `href` is not masked; rrweb serialises attributes as-is and
  rewriting them across a full snapshot would cost more than it protects. Use
  `blockSelectors` or `.oneuptime-block` for elements carrying sensitive data
  attributes.
- Canvas / WebGL, cross-origin iframes, closed shadow roots, cross-origin
  stylesheets, web fonts and `<video>`/`<audio>` are not captured. Each is
  reported to the player as a machine-readable `fidelityNotices` code, so a
  viewer sees "this was not recorded" rather than an unexplained blank.
- On a hard unload, up to one flush interval (15 s) of tail can be lost, plus
  anything over the 56 KB keepalive cap.
- **No outgoing `traceparent` is injected.** `NetworkRecorder` only READS a
  traceparent the host page already set — from a `fetch` init's headers or from
  a patched `XMLHttpRequest.setRequestHeader`. For a customer who is not
  already running OpenTelemetry browser instrumentation, `envelope.traceIds` is
  therefore always empty and the span-to-replay correlation never populates:
  the recording cannot be linked to the trace of the 5xx that triggered it.
  Injecting a header is deliberately not done implicitly — adding a request
  header turns a simple cross-origin request into a preflighted one, and a
  customer's API that does not allow `traceparent` in
  `Access-Control-Allow-Headers` would start failing because they installed a
  RUM script. Closing this needs an explicit per-application origin allowlist,
  not a default.
- A session that reaches `MAX_SESSION_REPLAY_CHUNKS_PER_SESSION` (480) sends
  one final, empty chunk carrying a `truncated` fidelity notice and then stops
  recording. The notice is not yet a member of Common's
  `SessionReplayFidelityNotice` enum, so the player renders it as an unknown
  code rather than with dedicated copy.

## Implementation notes worth knowing

**rrweb 2.1.1 has no `maskAllText` option.** Text masking is driven entirely by
`maskTextClass` and `maskTextSelector`, and rrweb resolves the selector with
`element.closest()`, so `"*"` is how mask-everything is expressed. Passing a
non-existent option would have silently recorded every page in plaintext.

**`maskInputOptions` has no `creditcard` key.** rrweb keys on HTML input
_types_; card fields are `type="text"` or live in a cross-origin PSP iframe.
Card protection comes from `maskAllInputs` + `maskAllText` + the
`autocomplete` heuristic. The exact shipped option object is pinned by a
snapshot test so a fictional key fails CI.

**Chunk boundaries follow rrweb's `isCheckout` flag, never a timer.**
`checkoutEveryNms` and the flush interval are independent timers; setting both
to the same number does not put a snapshot on a chunk boundary. Reading the
second `emit` argument does, exactly — which is what makes `hasFullSnapshot`
a fact rather than a guess, and therefore what makes seeking land on a DOM the
user really saw.

**`unload` and `beforeunload` are never registered.** Both disqualify the
customer's page from the back/forward cache. A RUM vendor degrading its own
customer's Core Web Vitals in order to collect data about them has failed at
its job. Terminal flushes use `visibilitychange` and `pagehide`, branching on
`event.persisted`. Asserted by both a runtime and a source-level test.

**The terminal flush is `fetch(keepalive)`, not `sendBeacon`.** `sendBeacon`
cannot set request headers, and the ingest middleware reads the auth token
only from headers. One request, identity-encoded (compression is a promise
chain and there is no guarantee the browser keeps running microtasks for a
page it is discarding), hard-capped at 56 KB because the keepalive quota is
64 KB _combined per origin_.

**Compression is the native `CompressionStream("gzip")` with an identity
fallback — never `fflate`.** The server's entire decode vocabulary is gzip or
none; raw DEFLATE would be stored and later parsed as garbage.

**Nothing is imported from `Common` at runtime.** `Common/UI/Config.ts` reads
`window.process.env` and `Common/package.json` pulls express, typeorm, stripe
and monaco. The dependency-free pure modules under `Common/Utils/Rum/*` and
`Common/Types/Rum/*` are **inlined at build time** by an esbuild plugin that
hard-fails the build on any other `Common` import. A test greps the emitted
bundle for `process.env`, `express`, `typeorm` and `stripe`.

**The circuit breaker is permanent.** After three consecutive retryable flush
failures the recorder self-disables and releases its buffer. A recorder that
retries forever against a misconfigured origin is a battery and bandwidth bug
on someone else's site. A 413 or 422 drops that one chunk without counting
against the breaker — the chunk was the problem, not the transport — and a 429
is honoured with `Retry-After` rather than treated as a failure.

## Frustration signals

Computed here, because rrweb emits none of them. Each is emitted as an rrweb
type-5 custom event **and** counted on the chunk envelope, so the ingest worker
can populate the header columns without ever decompressing the payload.

| signal       | detection                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- |
| rage click   | 3+ clicks within 1000 ms inside a 30 px radius                                                |
| dead click   | click on a non-interactive element with no DOM mutation, navigation or request within 3000 ms |
| error click  | click followed within 1000 ms by an uncaught error or rejection                               |
| refresh rage | 3+ reloads of the same scrubbed pathname within 60 s                                          |

There is deliberately **no composite frustration score**. An unexplained 0-100
number inside an artifact presented as evidence is a liability nobody can
defend in an incident review.

## Layout

| file                         | responsibility                                                            |
| ---------------------------- | ------------------------------------------------------------------------- |
| `src/Loader.ts`              | the stub: init options, privacy signals, config fetch, artifact injection |
| `src/Index.ts`               | the artifact entry and the public `OneUptimeReplay` API                   |
| `src/Recorder.ts`            | wiring, the rrweb option object, the emit hot path, terminal flushes      |
| `src/Config.ts`              | init options and the fail-closed policy fetch                             |
| `src/Consent.ts`             | DNT/GPC and the consent state machine                                     |
| `src/Masking.ts`             | rrweb masking options and sticky per-node sensitivity                     |
| `src/SessionId.ts`           | session / tab identity and the chunk counter, over fallible storage       |
| `src/RollingBuffer.ts`       | the pre-roll ring, evicting whole checkout segments                       |
| `src/Chunker.ts`             | chunk boundaries, snapshot splitting, per-chunk counters                  |
| `src/Transport.ts`           | compression, the envelope, retries and the circuit breaker                |
| `src/ErrorRecorder.ts`       | errors and rejections — also the primary trigger                          |
| `src/NetworkRecorder.ts`     | fetch / XHR, the 5xx trigger, traceparent correlation                     |
| `src/ConsoleRecorder.ts`     | `console.error` / `console.warn` only                                     |
| `src/RouteRecorder.ts`       | SPA navigation and forced snapshots                                       |
| `src/FrustrationDetector.ts` | rage / dead / error clicks                                                |
| `Manifest.ts`                | **server-side**, not bundled: reads `public/dist/manifest.json` and is the one place the published version, SRI hash and route policy come from |

## Commands

```bash
npm install         # rrweb is pinned exactly; no caret
npm run compile     # tsc --noEmit
npm test            # jest, jsdom, runs rrweb for real
npm run build       # production bundle -> public/dist
npm run analyze     # bundle composition
```

## Bundle weight

Measured: **recorder.js 231 KB raw / 71.4 KB gzip**, **loader.js 4.9 KB raw /
1.9 KB gzip**. Both raw AND gzip budgets are enforced by the build, which fails
rather than shipping a regression — gzip being the number a customer's browser
actually pays.

The design doc's ~52 KB gzip target is not reachable, and it is worth being
precise about why rather than leaving it as an open action:

| component                    | raw       | share  |
| ---------------------------- | --------- | ------ |
| `rrweb` `record` entry point | 177.4 KB  | 78.8%  |
| this package's 15 modules    | 44.2 KB   | 19.6%  |
| inlined Common Rum modules   | 3.5 KB    | 1.6%   |

Bundled on its own, `import { record } from "rrweb"` is **182 KB raw / 57.8 KB
gzip** — already above the 52 KB target before a single line of our own code.
Everything unused is already gone: the `Replayer`, `xstate`, the `fflate`
packer, `base64-arraybuffer`, the canvas-WebGL path and the plugin system are
all tree-shaken out, verified by grepping the emitted bundle for their tokens
(zero occurrences of `Replayer`, `xstate`, `fflate`, `CanvasManager`). What
remains is rrweb's DOM serialiser, its mutation buffer and its stylesheet
handling, none of which are optional for a DOM recorder.

Our own ~13.6 KB gzip could be shaved, but not by the 19 KB the target is
short. Closing the gap would mean forking rrweb or dropping DOM fidelity;
neither is worth trading correctness for, so the budget is set at the measured
figure plus headroom instead.

`npm run analyze` prints the per-module breakdown and writes
`public/dist/metafile.json`.
