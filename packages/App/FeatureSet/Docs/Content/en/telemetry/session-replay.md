# Session Replay

## Overview

Session Replay records what a real user saw in your web or React Native app and lets you play it back next to the error, trace and log data from the same session. **By default every session is recorded and uploaded as it happens**, not only the ones that broke — the sessions where nothing threw are where you find the checkout nobody completed, the form everybody abandoned and the page a customer says "looked wrong".

If you would rather store less, there are two dials and they compose:

- **Sample percentage** (100% by default) decides how many sessions are eligible at all. Halve it and you halve both the bytes stored and the end-user data at rest. The decision is made once per session from a hash of the session id, so a session is never half-recorded.
- **Capture trigger** set to _On error or frustration_ makes the recorder hold a rolling buffer in memory and upload **only when something actually goes wrong**. A recording then exists for very nearly every failed session while costing roughly 15x less than recording everyone — at the price of never being able to watch a session that did not fail.

## Prerequisites

- A RUM application — create one from _Resources → Real User Monitoring_, or let one be auto-discovered from your telemetry. See [Real User Monitoring](/docs/rum/index).
- A **Telemetry Ingestion Token** — _Project Settings → Telemetry & APM → Ingestion Keys_. Create it with the **Browser** surface; see [Set your allowed origins in production](#set-your-allowed-origins-in-production) for why.
- Session Replay is **on by default**. Settings live in two places:
  - **Per application**, under _Real User Monitoring → your application → Replay Policy_: the recording policy (masking, consent, sampling, retention, budgets), a **Recording health** summary, the privacy summary, the **Test your installation** panel and **Record a specific user's next session**.
  - Whether recordings are actually arriving has its own page, _Real User Monitoring → your application → **Health**_ (see [Recording health](#recording-health)).
  - **Project-wide**, under _Real User Monitoring → Settings → Session Replay_: the master switch that stops every application at once, and a read-only roster of every application's policy.

## Install

Add one script tag. Replace the token and the application identifier with your own — or copy the snippet the dashboard generates for you on the sessions page of a new application, which already has both filled in and offers Next.js and Google Tag Manager variants.

```html
<script
  src="https://oneuptime.com/telemetry/session-replay/v1/recorder.js"
  data-oneuptime-token="YOUR_TELEMETRY_INGESTION_KEY"
  data-oneuptime-app-identifier="storefront-web"
  crossorigin="anonymous"
  async
></script>
```

`data-oneuptime-app-identifier` must match the RUM application's identifier (the same value you use for `service.name`).

The script at `/v1/recorder.js` is a small loader. It fetches your application's policy, checks consent and Do Not Track, and only then loads `/latest/recorder.js`. Both live config and the mutable recorder response are `no-store`, so policy and recorder changes reach the next page load without waiting out a browser cache.

### Script tag attributes

| Attribute | Required | What it does |
| --- | --- | --- |
| `data-oneuptime-token` | **yes** | Your telemetry ingestion token. |
| `data-oneuptime-app-identifier` | **yes** | The RUM application's identifier. |
| `data-oneuptime-host` | no | The OneUptime origin. Derived from the script's own `src` when omitted, so you only need it when you proxy the script through your own domain. |
| `data-oneuptime-user-ref` | no | The end-user reference known at page load (a user id, never an email you would not want stored). The same thing `identify()` sets later; it is the only form that works for [Record a specific user's next session](#recording-a-specific-users-next-session). |
| `data-oneuptime-respect-do-not-track` | no | Defaults to honouring Do Not Track and Global Privacy Control. Set it to `"false"` to record regardless of the signal; see [Do Not Track](#do-not-track). |
| `data-oneuptime-debug` | no | `"true"` prints the recorder's decisions to the console. See [Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting). |
| `data-oneuptime-offline-storage` | no | Set it to `"false"` to keep chunks recorded while the visitor is offline in memory only, instead of also in the browser's IndexedDB. See [Offline mode](#offline-mode). |

The same options can be supplied on a global instead of the tag, which is what tag managers and bundled installs use:

```js
window.__ONEUPTIME_SESSION_REPLAY__ = {
  host: "https://oneuptime.com",
  token: "YOUR_TELEMETRY_INGESTION_KEY",
  appIdentifier: "storefront-web",
  userRef: "user-123", // optional
  respectDoNotTrack: true, // optional
  debug: false, // optional
  offlineStorage: true, // optional; false keeps offline chunks in memory only
};
```

### What a healthy install looks like

Open DevTools → Network and filter for `session-replay`. A working page makes:

1. **One `GET .../session-replay/v1/config`** per page load — the policy fetch.
2. **A `POST .../session-replay/v1/chunk` about every 15 seconds while the user is doing something**, or sooner when 256 KB of events have accumulated. An idle tab produces no events and therefore **no POST at all**: move the mouse or click before you judge an install from the Network tab.
3. When the tab is hidden, and again when the page goes away, **one** `POST` sent with `keepalive`. The page going away — the tab closed, reloaded or navigated to another page, or the page put into the browser's back/forward cache (every `pagehide`) — marks it final, which tells OneUptime that tab's recording is over; a page the user brings back from the back/forward cache records on as a new tab of the same session. A tab that is merely hidden stays open, so the recording continues when the user comes back to it. Its whole body stays under **56 KB** — the recorder's share of the browser's 64 KB per-origin keepalive quota — and it can carry several chunks as frames of that one request: the closing chunk, the pieces a large closing chunk was cut into (at most 48 KB of events each, so the frame header still fits), and any chunk that was still waiting to be retried. A chunk already larger than that budget when the tab is merely hidden goes out on the ordinary path instead, while the page is still alive to send it.

Under the _On error or frustration_ trigger, step 2 does not happen until a trigger fires — see [Troubleshooting](#troubleshooting).

## Install in React Native

The React Native SDK records the native view hierarchy as rrweb-compatible synthetic events, so mobile recordings open in the same session list and player as web recordings. It does **not** take screenshots. The player clearly labels the recording as a **React Native app** and its Fidelity tab explains the native surfaces that could not be represented.

The SDK supports iOS and Android React Native applications. Install it with its persistent-outbox peer dependency:

```bash
npm install @oneuptime/react-native-replay @react-native-async-storage/async-storage
```

For a bare iOS project, run your normal CocoaPods install after adding the packages; current React Native versions autolink Android without manual registration. The recorder has its own view-tree native module in addition to Async Storage, so Expo projects must use a custom development or production build (for example EAS Build or a prebuild). Expo Go cannot run this SDK because neither native module can be added to the fixed Expo Go binary.

Start the singleton once, then place the provider above the part of the app you want to record:

```tsx
import {
  OneUptimeReplay,
  OneUptimeReplayProvider,
} from "@oneuptime/react-native-replay";

OneUptimeReplay.start({
  host: "https://oneuptime.com",
  token: "YOUR_TELEMETRY_INGESTION_KEY",
  appIdentifier: "storefront-mobile",
  mobileAppIdentifier: "com.example.storefront",
  appName: "Storefront", // optional, shown in session details
  appVersion: "4.2.0", // optional, shown in session details
});

export default function App() {
  return (
    <OneUptimeReplayProvider>
      <Navigation />
    </OneUptimeReplayProvider>
  );
}
```

`appIdentifier` is the RUM application identifier. `mobileAppIdentifier` is the Android application id or iOS bundle identifier shipped in the binary, not a display name. Use the same value in the [`app://` allowlists](#set-your-allowed-origins-in-production). The SDK fetches the application's Replay Policy from `host`; sampling, trigger, consent, retention and upload budgets remain server-controlled.

The provider owns a non-collapsable native root and records its view tree and touch start/move/end events. If you already construct recorder instances yourself, pass one with `<OneUptimeReplayProvider recorder={recorder}>`. `MobileReplayRecorder` is also exported for isolated or multi-client integrations; most apps should use the singleton.

### React Native API

Import `OneUptimeReplay` directly, or call `useOneUptimeReplay()` below the provider. The singleton exposes:

| Method | What it does |
| --- | --- |
| `start(options)` | Fetch policy and start capture. Required options are `host`, `token`, `appIdentifier` and `mobileAppIdentifier`; `appName` and `appVersion` are optional display metadata, and `connectivity` is an optional network-state source for [offline mode](#offline-mode). |
| `stop()` | Flush what can be sent, stop capture and detach lifecycle handlers. |
| `identify(userRef, traits?)` | Attach the signed-in user and optional traits, subject to **Capture user identity**. |
| `setTags(tags)` / `addTag(key, value)` | Replace all searchable session tags, or add one tag without replacing the others. |
| `track(name, properties?)` | Put an application event on the replay timeline. |
| `setRoute(route)` | Record a sanitized logical screen or route after navigation. Call it from your navigator's route-change callback. |
| `captureSession(reason?)` | Under _On error or frustration_, upload the rolling buffer for an app-specific reason such as a user tapping “Report a problem”. |
| `captureError(error)` | Record a handled JavaScript error and activate error-triggered capture. |
| `grantConsent()` / `revokeConsent()` | Allow uploads, or immediately clear the in-memory buffer, stored outbox, session and visitor id. A later grant starts with fresh identifiers. |
| `getSessionId()` / `onSessionChange(listener)` | Read or subscribe to the current consented replay session id for trace and log correlation. The listener also receives `null` when capture or consent ends. |
| `getDiagnostics()` | Return recorder state and recent decisions without returning captured view content. |

The SDK listens to React Native `AppState`: backgrounding closes and drains consented events, while pre-consent footage remains only in memory. Before foreground capture resumes, the SDK refreshes policy without using a cached response. It also refreshes policy periodically while active, so disablement, consent, sampling, targeting and identity changes take effect in a long-lived app. Call `stop()` when your integration is permanently torn down; ordinary screen navigation should use `setRoute()` rather than stopping and starting the recorder.

To correlate mobile telemetry with a replay, subscribe with `onSessionChange()` and set the returned value as the `session.id` attribute in your OpenTelemetry instrumentation. Replace that attribute whenever the callback fires, including clearing it when the value is `null`. The replay SDK does not patch native networking or mutate an OpenTelemetry provider itself.

### React Native privacy and masking

Mobile capture is deliberately stricter than the web masking modes. Native UI text, accessibility values, input values and image pixels are never serialized; the server receives a structural wireframe even when the application's web masking mode would allow readable text. Caller-supplied metadata such as user references, event names, routes and searchable tags follows the API contract, so do not put secrets in those fields. Wrap an especially sensitive subtree in `<ReplayMask>` to replace that region with a privacy placeholder while preserving the surrounding layout.

Consent is not inferred from an operating-system permission or your consent banner. Under _Require explicit_, call `grantConsent()` only after your app has the required consent. Calling `revokeConsent()` drops both queued and persisted unsent data as well as the identifiers that could link a later session to the revoked one.

The mobile recorder captures view bounds and types, touch locations, logical routes, custom events and JavaScript errors. These limits are always disclosed in the player's Fidelity tab:

- Native `Image` pixels are opaque; only the frame is represented.
- `WebView` contents are outside the React Native tree. Install the web recorder inside the hosted page if it needs its own recording.
- Canvas, Skia, OpenGL, maps, camera previews, video and other custom-drawn surfaces are opaque.
- Touch paths inside `ReplayMask` or an opaque surface are not recorded. The native bridge checks the live touch target and its ancestors, and suppresses the gesture if that privacy check cannot be completed.
- Reanimated, native-driver and UI-thread animations are sampled at view-tree snapshots, not reproduced frame by frame.
- Native crashes that terminate JavaScript before it can flush need a native crash SDK; `captureError()` covers handled JavaScript errors, not process-level crash dumps.

## Identify your users

Every session is anonymous until your page says who it belongs to. Without that, the list can still group the sessions of one browser under an anonymous visitor id (see [Anonymous visitors](#anonymous-visitors) below), but nothing names the person or links their second browser to their first. Call `identify()` as soon as you know, or queue it before the script has loaded — either way it is applied before the first chunk is uploaded, so the session is searchable by user from the moment it appears:

```js
// After the script has loaded:
OneUptimeReplay.identify("user-123", { plan: "pro", tenant: "acme" });

// Or at any time, whether or not the script has loaded yet:
(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push([
  "identify",
  "user-123",
  { plan: "pro", tenant: "acme" },
]);
```

- The reference is what the session list shows and what `user:` searches match. The traits are shown in the player header and on the session's details panel.
- What `identify()` gives the recorder is uploaded with the recording only while **Capture user identity** is on for the application (the default). With it off the recorder leaves the reference and the traits out of the chunk, and the server stores **nothing at all** about the person — no reference, no keyed hash of it, no traits. Those sessions are genuinely pseudonymous, and the price of that is that they cannot be erased _by user_: an erasure request has nothing to match, so use `BySessionId`, `ByDateRange` or `ByRumApplication` instead (see [Erasing sessions](#erasing-sessions)). If honouring a per-user deletion request matters more to you than storing no identifier, leave the switch on — the stored key is a one-way keyed hash, so it is matchable but not readable, and only the separate label carries the reference itself.
- One reference does leave the browser regardless of that switch, by design: the one your page supplies **at load time** via `data-oneuptime-user-ref` or `userRef` on the init global travels as a request header on the policy fetch of every page load, because that is how [Record a specific user's next session](#recording-a-specific-users-next-session) matches a visitor before any recorder exists. The server compares it against the armed target and discards it; it is not written to the session unless identity capture is on and the recorder sends it again with the recording. A reference passed to `identify()` is never sent this way.
- Traits are capped at 20 keys, 40 characters per key and 200 per value, stringified, and passed through the application's masking mode: under _Mask all text_ they are masked before upload.
- Reading identity back in the dashboard requires the same permission as watching the recording (see [Who can watch a recording](#who-can-watch-a-recording)); other roles see "Identity hidden".

### Anonymous visitors

A page that never calls `identify()` still needs its sessions to be groupable, or a list of forty _Anonymous_ rows cannot tell you whether one person hit the same error forty times or forty people hit it once. So the recorder mints **one random visitor id per browser profile and origin** — 32 lowercase hex characters, kept in `localStorage` under `oneuptime.replay.visitor`, next to the session record, so a site served from two hostnames or ports appears as two visitors and only `identify()` joins them — and sends it as `meta.visitorId` on every chunk that carries metadata: the first chunk, the closing chunk, and the chunk after an `identify()` or `setTags()` call. The server checks the shape and stores it on the session under the same access rules as the rest of the session header. It outlives the session id on purpose: the 30-minute idle rollover and the 4-hour cap start a new session, and the new session carries the same visitor id, so two visits from the same browser a week apart sit together on the [Users page](#the-users-page) and in the player's other-sessions menu (see [The player](#the-player)).

Be precise about what it is not:

- **It is not an identity.** It is random, minted in the browser, and derived from nothing your page supplied and nothing about the device. Two browsers on one laptop, or the same person on a phone and a desktop, are two visitors; only `identify()` joins them. A private window gets a fresh id that goes when the window does, and where storage cannot be written at all (Safari private mode, blocked site data) the id lasts one page load.
- **It is not governed by Capture user identity.** That switch decides whether the reference and traits leave the browser; the visitor id is sent either way, because it names nobody. If you want no id minted at all, the answer is no recorder: turn Session Replay off for the application, or leave [Do Not Track](#do-not-track) honoured.
- **It follows the consent rules of the session id.** `revokeConsent()` removes it from storage along with the session, nothing is written while consent is withdrawn, and a later `grantConsent()` mints a new one — so a user who withdraws consent and comes back is not re-linked to the sessions they asked you to forget. Under Do Not Track or Global Privacy Control no recorder runs, so no id is minted.
- **It never travels on your own requests.** The trace context the recorder adds to requests your page makes to its own origin names the session, never the visitor (see [What your own requests carry](#what-your-own-requests-carry)); the visitor id only goes to OneUptime, on the recording.
- **It cannot be the target of an erasure request.** The request types are unchanged (see [Erasing sessions](#erasing-sessions)); a `visitor:` search narrows the list to one browser's sessions, from which you take the session ids to erase.

`OneUptimeReplay.getVisitorId()` returns the current id, or an empty string before the recorder has started, after `stop()`, and between a `revokeConsent()` and the next `grantConsent()`. Recorders built before this existed sent none, so the sessions they recorded have an empty `visitorId`: the list shows them as _Anonymous_ and the Users page files them under **Unlinked sessions**. A recorder that mints one lists `visitor-id` among its `capabilities` in `getDiagnostics()` and on the **Health** page.

## JavaScript API

The recorder publishes `window.OneUptimeReplay`. Because it loads asynchronously, anything your page calls before it has arrived should go through the command queue instead — `window.OneUptimeReplayQueue` is a plain array of `[command, ...arguments]` entries that the recorder drains the moment it starts, and it accepts every command below by name:

```js
(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push(
  ["grantConsent"],
  ["identify", "user-123", { plan: "pro" }],
  ["setTags", { build: "1.4.2" }],
  ["onSessionChange", (sessionId, tabId) => console.log(sessionId)],
);
```

`grantConsent`, `revokeConsent`, `stop`, `identify`, `setTags` and `addTag` are applied **before** the recorder starts, so a queued consent decision decides whether anything uploads at all and a queued identity rides on the very first chunk. `track`, `captureSession` and `onSessionChange` run right after it starts.

| Method | What it does |
| --- | --- |
| `identify(userRef, traits?)` | Attach the end user. `traits` is an object of string, number or boolean values (≤ 20 keys, key ≤ 40 chars, value ≤ 200 chars), masked under _Mask all text_ and only uploaded when **Capture user identity** is on. Calling it again mid-session re-sends the identity on the next chunk. |
| `track(name, properties?)` | Record a business event (`"checkout_failed"`) on the timeline. `name` ≤ 64 chars, ≤ 20 property keys with the same value caps as traits. Up to 50 per 15-second chunk; beyond that the chunk carries one "events dropped" marker with the count. |
| `setTags(tags)` / `addTag(key, value)` | Per-session tags (`{ build: "1.4.2", experiment: "new-checkout" }`), ≤ 20 tags, key ≤ 32 chars, value ≤ 128. Searchable from the session list with `tag:key=value` and shown on the session's details. `setTags` **replaces** the whole map, so a second `setTags({ experiment })` drops a `build` tag set by the first one; `addTag` sets one key and keeps the rest. Build the map in one `setTags` call, or use `addTag` as you learn each value. |
| `captureSession(reason?)` | Under _On error or frustration_, force this session to upload from its rolling buffer onwards; under _Always_ it is a no-op for uploading but the `reason` (≤ 80 chars) is still marked on the timeline. Use it from your own "report a problem" button. |
| `onSessionChange(listener)` | `listener(sessionId, tabId)` is called immediately if a session exists and again whenever the id changes — after 30 minutes idle, at the 4-hour cap, or when another tab of the same visitor rotated first. Returns an unsubscribe function. **Optional**: requests to your own origin link your backend's spans, logs and exceptions to the recording without it (see [Correlating with your other telemetry](#correlating-with-your-other-telemetry)). Use it to put `session.id` on telemetry the page produces itself, such as spans from the OpenTelemetry browser SDK; see [Your page's own browser telemetry](#your-pages-own-browser-telemetry). |
| `grantConsent()` | Under consent mode _Require explicit_, allow uploads. Nothing is uploaded before this. |
| `revokeConsent()` | Drop everything buffered and stop uploading. The recorder keeps running into memory only, so a later `grantConsent()` continues on a fresh session id. |
| `getSessionId()` | The current session id, or `null` when nothing is recording. Prefer `onSessionChange()`, which also follows rotations. |
| `getVisitorId()` | The [anonymous visitor id](#anonymous-visitors) — 32 hex characters, one per browser profile, the same across session rotations — or `""` before the recorder has started, after `stop()`, and while consent is withdrawn. Random and not an identity; not governed by **Capture user identity**. |
| `stop()` | Upload the last chunk, seal the session, and stop for the rest of the page's life. |
| `setDebug(enabled)` | Print the recorder's decisions to the console from now on. |
| `getDiagnostics()` | Everything the recorder decided, whether or not diagnostics were on. See below. |

### `getDiagnostics()`

This is the first thing to paste into a support ticket. It contains no page content by construction (see [What the diagnostics never contain](/docs/rum/session-replay-troubleshooting#what-the-diagnostics-never-contain)).

```js
copy(JSON.stringify(OneUptimeReplay.getDiagnostics(), null, 2));
```

| Field | Meaning |
| --- | --- |
| `state` | `none` (no recorder was built), `not-started`, `recording` (into memory only), `uploading`, `not-sampled` or `stopped`. |
| `stopReason` | Why it stopped, when it has: `api` (your `stop()`), `server-directive`, `transport-failure` or `chunk-cap`. |
| `bootstrapDecision` | Why the artifact did or did not build a recorder: `started`, `privacy-signal`, `directive-stop`, `already-started`, `cancelled-before-start` (a queued `revokeConsent`/`stop`) or `not-started`. |
| `decisions` | Every gate's answer: `isSampled`, `captureTrigger`, `consentMode`, `consentState`, `uploadsAllowed`, `uploadBlockedBy` (`consent`, `transport` or `null`), `lastDirective` and its reason, and `startDecision` (`recording-and-uploading`, `recording-into-memory`, `not-sampled`, `not-started`). |
| `capabilities` | What this recorder build captures: `click-events`, `web-vitals`, `custom-events`, `traits`, `tags`, `visibility`, `visitor-id`. The dashboard's **Health** page shows the same list for the newest session, so a recording from an older, long-lived page is easy to spot. |
| `tags`, `hasTraits`, `triggerReason`, `isRecording`, `isUploading`, `sessionId`, `tabId`, `visitorId`, `version` | The session's current state. `isRecording` is true only while the recorder is actually recording. `visitorId` is `null` until a recorder exists and `""` while consent is withdrawn. |
| `records` | The last 250 decisions with stable codes — including the loader's, from before the artifact existed. Every code is explained in [Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting#codes). |

## Privacy

**Masking happens at capture, on the end user's device, before anything is uploaded.** The server never receives what was masked, so a masking decision cannot be undone after the fact — and cannot be applied retroactively either. On the web, what gets masked depends on the mode; React Native always sends the stricter structural wireframe described under [React Native privacy and masking](#react-native-privacy-and-masking). The **Privacy summary** card on the application's _Replay Policy_ page restates these decisions in plain sentences for whatever you have configured.

| Control | Default | What it does |
| --- | --- | --- |
| Session Replay enabled | **on** | Per-application switch. Turn it off to stop recording for one application. |
| Masking mode | **Mask sensitive inputs only** | Passwords and card / one-time-code fields are masked. The rest of the page — static text and ordinary input values — is recorded as it looked. See the warning below. |
| Consent mode | **Not required** | Uploads start immediately. Set *Require explicit* if you need a per-session consent handshake, which most EU deployments will. |
| Capture trigger | **Always** | Every sampled session uploads from its first event. Set *On error or frustration* to upload only when something goes wrong. |
| Sample percentage | **100%** | Share of sessions eligible for recording. This is the dial for cost. Note that 0% together with *Always* records nothing at all; the policy page warns when you configure that. |
| Allowed origins | **empty (any origin)** | List your domains to restrict who may send recordings. See the warning below. |
| Capture user identity | **on** | The end-user reference and traits your page supplies are stored, so you can find a named customer's session. Turn it off to keep recordings pseudonymous — with it off nothing about the person is stored, including the key an erase-by-user request would have to match ([Identify your users](#identify-your-users)). It does not govern the [anonymous visitor id](#anonymous-visitors), which is random, names nobody and is sent either way. |
| Same-origin trace propagation | **on** | While a session uploads, requests your page makes to its own origin carry a W3C `traceparent` and a `tracestate` naming the session, so your backend's telemetry links to the recording with no code. Your backend's OpenTelemetry forwards both to every service it calls. See [What your own requests carry](#what-your-own-requests-carry). |
| Capture country | **on** | Country only, never an IP address. |
| Record canvas | **off** | Canvas and WebGL are not recorded. |
| Retention | **7 days** | Shorter than other telemetry, on purpose. 1, 14, 30 and 90 days are also available. |
| Monthly budget (GB) | **blank** | An optional ceiling on bytes ingested per calendar month for this application. Blank or 0 means no ceiling. |

### Choose a masking mode deliberately

The default records a readable page, because a wireframe is rarely enough to debug from. Be clear about what that means: **anything rendered into your page is in the recording** — an order id, an email address in a header, an error banner quoting user data — and so is anything typed into a field your markup does not declare as sensitive.

Masking happens in the browser before upload, so this cannot be repaired after the fact: tightening the mode later does not scrub recordings already taken.

The three modes, least to most private:

| Mode | Static page text | Ordinary input values | Passwords, card and OTP fields |
| --- | --- | --- | --- |
| Mask sensitive inputs only *(default)* | recorded | recorded | masked |
| Mask inputs only | recorded | masked | masked |
| Mask all text | masked | masked | masked |

Under _Mask all text_ the replay is a wireframe: text nodes, the labels the recorder attaches to clicks, `identify()` traits and `track()` properties are all masked before upload.

If your pages render personal data, either move up a mode or add **mask** / **block** selectors for the specific elements — see *Marking your own content* below. Selectors are the right tool when only a few regions are sensitive; a stricter mode is the right tool when you cannot enumerate them.

### Set your allowed origins in production

Session replay works out of the box with an empty origin allowlist, which accepts recordings from **any** origin. That is convenient for getting started and wrong for production.

Your ingestion token is shipped to the client — in page JavaScript or the mobile binary — so there are two fences, and they compose:

- **On the key.** Create the ingestion key with the **Browser** surface. For web, list its **Allowed Origins** (`https://app.example.com`, or `https://*.example.com` for one level of subdomain). For React Native, add the exact application identity as `app://com.example.storefront`. Give the key an **Expires At** too: a copied token then stops working on a date you chose rather than never.
- **On the application.** _Replay Policy → Allowed origins_ restricts who may write recordings into **this application**, whichever key they present. Add the same web origins and exact `app://` mobile identities here.

An `app://` entry is the literal prefix plus the normalized Android application id or iOS bundle identifier supplied as `mobileAppIdentifier`. Matching is case-insensitive after trimming and lowercasing a valid reverse-DNS identifier. Mobile identities do **not** accept wildcards: `app://*.example.com` is invalid. The mobile SDK sends no browser `Origin`; it sends its recorder kind and app identity in dedicated headers. If a request does carry a real `Origin`, that origin always wins — mobile headers can never be used to bypass the browser-origin check.

That mobile identity is self-asserted HTTP metadata, not Apple/Google platform attestation and not proof that the request came from your signed binary. Someone who extracts the client token can send a non-browser request with the same app-identity header. The exact `app://` entries still prevent accidental cross-app use and separate the mobile identities you intend to accept, but do not call them an authenticity boundary. Set an expiry, rotate exposed keys, and keep the rate and byte budgets enabled to bound abuse; never put a server secret in the app and treat it as recoverable protection.

A request has to pass both allowlists. For web requests, the browser-controlled `Origin` check prevents one website from reusing another site's key; for native requests, the controls above limit and compartmentalize a self-asserted identity. Set both allowlists before you point real traffic at either recorder; refused uploads show up on the **Health** page as `origin-not-allowed`.

### Always masked

Always masked regardless of mode, and not configurable:

- **Passwords**, including after a "show password" toggle. Once a field has ever been a password field it stays masked, and the type change itself is suppressed.
- **Card fields**, detected via `autocomplete` (`cc-number`, `cc-csc`, `cc-exp`), because card inputs are `type="text"` and otherwise invisible to type-based masking.
- **One-time codes** (`autocomplete="one-time-code"`).
- **File input values** — the browser exposes the real filename, and filenames are routinely personal.
- **Query strings and fragments** are dropped from every recorded URL, and identifier-shaped path segments (UUIDs, emails, long digit runs, long opaque tokens) are replaced. This is the one channel text masking does not cover: a password-reset link would otherwise land in the session list.
- **Clipboard events** are never recorded.
- **Keystroke timing** is quantised, because inter-keystroke intervals leak typed content even when the value is masked.
- **Request and response bodies and headers** are never recorded. A network row in the player carries the method, URL, status, timing, byte counts and the trace id — nothing else. (The recorder does _add_ trace context to requests to your own origin; see [What your own requests carry](#what-your-own-requests-carry).)
- **Click labels** come from an element's `aria-label` or visible text, never from a form control's value, and are dropped entirely inside masked regions.

Masked values are **not length-preserving**. A masked field is a fixed-width placeholder, so it cannot be used to infer how long a password or card number was.

### Marking your own content

```html
<!-- Not recorded at all: the element and its subtree are omitted. -->
<div class="oneuptime-block">...</div>

<!-- Recorded, but all text inside is masked. -->
<div class="oneuptime-mask">...</div>

<!-- Recorded, but input events inside are dropped. -->
<div class="oneuptime-ignore">...</div>
```

You can also add **Additional mask selectors** and **Block selectors** under your application's _Replay Policy_ settings, without changing your markup. Under the default masking mode these are the main tool for protecting content your markup does not declare as sensitive.

### What your own requests carry

The recorder never records a request's headers or body, but it does **add** trace context to some of your page's own requests, and that goes to your backend rather than to OneUptime. This is what links backend telemetry to a recording (see [Correlating with your other telemetry](#correlating-with-your-other-telemetry)):

```
traceparent: 00-<32 hex trace id>-<16 hex parent id>-01
tracestate:  oneuptime=sid:<32 hex session id>;p:<16 hex parent id>
```

- **Which requests.** `fetch` and `XMLHttpRequest` calls to the page's **own origin**, made while the session is **uploading**, except the page's own OpenTelemetry exports (`POST` requests to paths ending in `/v1/traces`, `/v1/logs` or `/v1/metrics`). Nothing is added before consent under _Require explicit_, after `revokeConsent()`, under _On error or frustration_ until a trigger fires, in a session that was not sampled, or after `stop()`. A `traceparent` or `tracestate` the request already carries is never replaced: it keeps its own, and the recorder adds only what is missing. `;p:` appears only when the recorder minted the `traceparent` itself. Requests to other origins get nothing unless you list the origin in **Trace propagation origins**, and then only a `traceparent`, which carries no session id.
- **What the session id is.** The same random 32-hex id the recording is filed under. It says nothing about the person and stays the same for the whole visit, until 30 minutes idle or the 4-hour cap start a new session, or a `revokeConsent()` followed by `grantConsent()` mints a fresh one. The [anonymous visitor id](#anonymous-visitors), the user reference and the traits never travel this way.
- **Where it goes.** Your backend's OpenTelemetry keeps `tracestate` with the trace and forwards it on every call it makes, to your other services and to any third-party API it calls with trace context, exactly as it does the trace id. OneUptime reads the member off each span at ingest, stores the session id in the span's session id column and removes the member from the trace state it stores.
- **What it links.** A backend span, log or exception that names the user (an `enduser.id` attribute, an email in a log line) is now one click from the recording, even with **Capture user identity** off: that switch decides what the recording stores, not what your backend logs. If recordings must not be linkable to who the user was, turn **Same-origin trace propagation** off as well.
- **Who can assert it.** Like any trace context, the member is written by the client. Someone who knew a session id could send it to your API and have their own requests' spans filed under that session. Session ids are random 128-bit values, so they would need the id first. The same holds for the trace a client names: a request that sends a `traceparent` for a trace it knows, next to its own session's member, brings that trace's backend rows into its session's rail and into the scope of that session's erasure. Erasure removes a trace as a whole only when it belongs to the erased sessions alone; from a trace shared with other sessions it removes only the rows stamped with the erased ids (see [Erasing sessions](#erasing-sessions)).

Switch it off per application with **Same-origin trace propagation** on the _Replay Policy_ page; see [Turning automatic linking off](#turning-automatic-linking-off).

### Consent

```js
// After the user accepts. Nothing is uploaded before this.
window.OneUptimeReplay.grantConsent();

// Drops everything buffered and stops uploading. A later grantConsent()
// continues on a fresh session.
window.OneUptimeReplay.revokeConsent();
```

Your banner usually resolves before the recorder script has loaded, so queue the decision instead of waiting for the global:

```js
(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push(["grantConsent"]);
```

Under _Require explicit_ the recorder records into memory from the first event and uploads the whole buffer once consent arrives, so the seconds before the banner was accepted are not lost. Until it arrives the **Health** page reads "waiting for consent", which is a policy answer rather than a fault.

`revokeConsent()` forgets two things, and a later `grantConsent()` mints both afresh:

- The **session id**, so a user who withdraws consent and comes back is not re-linked to the same session.
- The **[anonymous visitor id](#anonymous-visitors)**, removed from storage with the session. Nothing is written while consent is withdrawn, and `getVisitorId()` answers `""` until the next grant — so the sessions recorded after a re-grant are grouped with each other, never with the ones the user asked you to forget.

The same gate governs the [trace context the recorder adds to your own requests](#what-your-own-requests-carry): no session id is sent before `grantConsent()` or after `revokeConsent()`, and after a new grant the requests carry the new session's id, never the withdrawn one.

### Do Not Track

`navigator.doNotTrack` and `navigator.globalPrivacyControl` are honoured **before the config request is made**: a page that says nothing on its script tag stands down for a user who sends either signal, without a request being made about them just to find out whether they would have been recorded. The loader logs `privacy-signal` and nothing else happens.

The rule has one override. Set `data-oneuptime-respect-do-not-track="false"` (or `respectDoNotTrack: false` on the init global) to record regardless of the signal, if your lawful basis genuinely does not depend on it. The page's own markup is the only thing that can say so: nothing in the dashboard policy loosens it, and a page that says nothing honours the signal.

## Content Security Policy

**If your site sends a CSP, the recorder will fail silently until you allow it.** There is no error we can surface from your users' browsers, so this is the first thing to check when no recordings appear. Add OneUptime's origin to the directives you already have — do not replace them, or you lock your own scripts out of your page:

```
script-src  'self' https://oneuptime.com;
connect-src 'self' https://oneuptime.com;
```

If you self-host OneUptime, use your own host instead.

One more CSP-adjacent detail: for playback to render your styles, your stylesheets must be readable by the recorder. A cross-origin stylesheet without `crossorigin="anonymous"` cannot be read, and the session will play back unstyled with a notice explaining why.

Use the **Test your installation** panel on the application's _Replay Policy_ page to confirm the token, the policy switches and the origin allowlists from the server's side. **It cannot check your CSP** — a CSP is a header your own site sends to your own visitors, and nothing server-side ever sees it. A CSP block shows up there only indirectly: `script-src` blocks the recorder, so the panel's _Recorder loaded on your site_ row stays waiting; `connect-src` blocks the upload, so that row passes while the recording-received row below it stays waiting. Either way the browser console on the blocked page logs the refusal, and that is the only positive proof.

## Correlating with your other telemetry

Installing the recorder is enough to link a recording to your backend's traces, logs and exceptions. There is no code to add to the page or to your services.

While a session uploads, every `fetch` and `XMLHttpRequest` your page makes **to its own origin** carries the session's W3C trace context:

- a **`traceparent`**, minted by the recorder, unless the request already has one or another tracing agent on the page is set up to trace it, in which case the recorder leaves that to the agent;
- a **`tracestate`** member, `oneuptime=sid:<session id>`, unless the request already carries a `tracestate`.

The recorder leaves the `traceparent` to another agent only when that agent is configured to trace the request: the OpenTelemetry browser SDK's fetch or XMLHttpRequest instrumentation; Datadog RUM, once it has started and tracks the session, when the first entry of its `allowedTracingUrls` that matches the request's URL uses the `tracecontext` propagator (an entry without `propagatorTypes` does); an active Elastic APM RUM agent with distributed tracing on and its default `traceparent` header name (`distributedTracingHeaderName`); or New Relic with distributed tracing enabled. It still adds its `tracestate` member. With the first three, the request is linked only if that agent really sends a W3C `traceparent` with it, and Datadog sends one only in a tracked, trace-sampled Datadog session. New Relic sends its own `tracestate` with its `traceparent`, and that takes the place of the member, so New Relic's requests are never stamped with the session and link only by trace id (see [What is not linked automatically](#what-is-not-linked-automatically)). An agent that is merely loaded does not stop the recorder from minting one: Datadog RUM with no `allowedTracingUrls` entry for your origin, before it has started or its `trackingConsent` is granted, or in a session it does not track.

Same-origin requests are not CORS-preflighted, so these headers do not trip your API's CORS rules; the one exception is a [redirect to another origin](#redirects-to-another-origin).

Your backend's OpenTelemetry SDK extracts both headers, every span it records for the request inherits the trace state, and every call it makes to another service forwards it. So at ingest OneUptime stamps the session id on the spans of **every service that continues W3C trace context**, and on the exceptions recorded on those spans. OTLP log records carry no trace state, so backend logs, and exceptions reported through logs, are joined to the recording **by trace id** when you open it. When the recorder minted the `traceparent`, the member also carries its parent id (`;p:<parent id>`): that browser span is never exported, and ingest uses the id to keep your backend's entry span a root span instead of one whose parent is missing. A span that carries both the member and a `session.id` attribute is filed under the member's id, because `session.id` is also the conversation key of several LLM SDKs.

The player's **Logs**, **Traces** and **Errors** tabs then list those rows on the recording's clock, and each request's row on the **Network** tab links to its backend trace. What these headers mean for privacy is under [What your own requests carry](#what-your-own-requests-carry).

### APIs on another origin

A request to another origin gets nothing by default: adding any header turns a simple cross-origin request into a preflighted one, and an API that does not allow the header would start failing because you installed a recorder. To link one, add its origin to **Trace propagation origins** on the _Replay Policy_ page (Performance & Tracing step). Only list an origin whose API allows `traceparent` in `Access-Control-Allow-Headers`; that is the whole reason it is an explicit allowlist.

Requests to a listed origin get a `traceparent` only, with no `tracestate` and so no session id, and their backend telemetry is matched to the recording **by trace id**, through the trace ids the recording observed. Requests that already carry a `traceparent`, and `fetch` calls made with a `Request` object rather than a URL, are left untouched on this path.

### Sampling of browser-started traces

The recorder mints its `traceparent` with the sampled flag set (`-01`), because a backend that follows its parent's decision would otherwise drop every span of the request. The flip side is that the default `ParentBased` samplers keep **every** trace the recorder starts, even if your backend samples its own root traces at, say, 10%: the same-origin requests of every session that uploads, and the requests to origins in **Trace propagation origins** from every session the recorder runs in, recorded or not. Trace volume and ingest cost can rise once your pages run the recorder. `OTEL_TRACES_SAMPLER=parentbased_traceidratio` behaves the same way: its ratio applies to root spans only.

To keep ratio sampling for browser-started traces, give a ratio sampler for sampled remote parents **only to the service(s) your pages call directly**. Leave the default `ParentBased` sampler on every service those call, so they follow the first hop's decision:

```js
// Node.js
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";

const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1),
  remoteParentSampled: new TraceIdRatioBasedSampler(0.1),
});
```

```java
// Java
Sampler sampler = Sampler.parentBasedBuilder(Sampler.traceIdRatioBased(0.1))
    .setRemoteParentSampled(Sampler.traceIdRatioBased(0.1))
    .build();
```

```python
# Python
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased

sampler = ParentBased(
    root=TraceIdRatioBased(0.1),
    remote_parent_sampled=TraceIdRatioBased(0.1),
)
```

```go
// Go
sampler := sdktrace.ParentBased(
    sdktrace.TraceIDRatioBased(0.1),
    sdktrace.WithRemoteParentSampled(sdktrace.TraceIDRatioBased(0.1)),
)
```

Do not put this delegate on the services further down. `TraceIdRatioBased` hashes the trace id differently in each language SDK: JavaScript XORs its 32-bit words, Go and Python use its low 64 bits, and Java uses the absolute value of the signed low 64 bits. A downstream service in another language would drop spans from traces the first hop kept, and it would re-sample the traces that start in your backend as well. The OpenTelemetry specification recommends this sampler for root spans only. For one consistent sampling rate across services, use tail sampling in an OpenTelemetry Collector instead.

A trace your backend then drops never reaches OneUptime, so it is not linked either. Or turn [automatic linking off](#turning-automatic-linking-off). A `traceparent` set by the page's own instrumentation carries that instrumentation's decision, not the recorder's.

### Turning automatic linking off

**Same-origin trace propagation**, on the _Replay Policy_ page next to **Trace propagation origins**, is on by default for every application. Turned off, the recorder adds nothing to same-origin requests from the next page load on, and **Trace propagation origins** keeps working as before, for every origin it lists. So if you listed your own origin there (earlier versions of this page said to), remove it as well, or your own requests keep getting a `traceparent`. With diagnostics on, the recorder says which applies when it starts: `same-origin-propagation`, with `enabled` and a `reason` (see [Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting#codes)).

### Redirects to another origin

A same-origin request that your server redirects to another origin (a download redirected to a presigned S3, GCS or Azure Blob URL, an avatar served from a CDN) takes the added headers with it, and the browser then has to ask that origin's permission first with a CORS preflight. If that origin does not allow `traceparent` and `tracestate`, the request fails.

The recorder notices. When a request it added headers to fails at the network level, it stops adding them for the rest of the page load and logs `same-origin-propagation-tripped`. A `GET` or `HEAD` `fetch` without a body is retried once, exactly as your page made it, and your page gets the retry's outcome. Anything else is not retried: an `XMLHttpRequest` cannot be retried, and neither can a `fetch` with any other method or with a body, so that one request fails. To fix it for good, allow `traceparent` and `tracestate` in the other origin's CORS configuration (the bucket's `AllowedHeaders` on S3), or turn **Same-origin trace propagation** off and take your own origin out of **Trace propagation origins** if you listed it there.

### What is not linked automatically

- **Requests the recorder does not see:** document navigations and form posts, the server-side render of a page, WebSocket and server-sent events, `navigator.sendBeacon`, and requests made from Web Workers or Service Workers.
- **Requests made before the recorder starts** on each page load. The recorder loads asynchronously, often after the page's first requests have gone out.
- **Requests made while the session is not uploading:** before consent under _Require explicit_, after `revokeConsent()`, before a trigger under _On error or frustration_ (the buffered seconds before the trigger link only through a `traceparent` your page set itself), and in a session that was not sampled.
- **Requests that already carry a `tracestate`**, from Datadog RUM, Elastic RUM or your own instrumentation, and every request New Relic traces. The recorder does not write into another vendor's header. These requests still link by trace id when the recording observed their `traceparent`. New Relic, with distributed tracing on, sends its own `tracestate` with every `traceparent` it adds, in place of the member, so none of its requests is stamped with the session. Its `XMLHttpRequest` calls and its `fetch` calls made with a `Request` object still link by trace id. A `fetch` called with a URL does not link at all when New Relic loads first (its snippet goes in the page's `<head>`), because New Relic then adds its headers to a copy of the request's options that the recorder never sees.
- **Requests without a `traceparent`.** Trace state only travels with a trace, so a request your own instrumentation deliberately leaves untraced (a URL in its `ignoreUrls`) is not linked.
- **Requests another tracing agent was set up to trace but sent without a W3C `traceparent`.** When Datadog RUM tracks the session and lists the URL in `allowedTracingUrls`, or an Elastic APM RUM agent is active with distributed tracing on, the recorder leaves the `traceparent` to that agent and adds only its `tracestate` member. If the agent then sends no `traceparent`, your backend drops the lone `tracestate` and nothing links. Datadog sends one only in the sessions it trace-samples: with a `traceSampleRate` below 100 and the default `traceContextInjection: "sampled"`, the requests of its other sessions do not link. `traceSampleRate: 100` links every session Datadog tracks. `traceContextInjection: "all"` makes Datadog send a `traceparent` in those other sessions too, but flagged not sampled, so they link only if your backend keeps such traces (the default `ParentBased` sampler drops them). With diagnostics on, `same-origin-propagation` with `reason: "agent-stand-down"` names the agent the first time the recorder stands down on a page load. If the agent skipped the request for another reason (for Elastic, `fetch` or `xmlhttprequest` in its `disableInstrumentations`), configure it to send a W3C `traceparent` to your own origin.
- **Your page's own OpenTelemetry exports.** A same-origin `POST` whose path ends in `/v1/traces`, `/v1/logs` or `/v1/metrics` (the browser exporter posting through a proxy on your own origin) gets nothing from the recorder's same-origin path, so exporting your browser telemetry does not add a backend trace per batch to the recording. Other requests to such paths, such as a `GET /api/v1/logs` on your own API, are linked as usual. If your own origin is also listed in **Trace propagation origins** (earlier versions of this page said to list it), those exports still get that list's `traceparent`, so remove your origin from the list.
- **Backends that do not continue W3C trace context:** a service whose propagators leave out W3C `tracecontext` (Go's OpenTelemetry SDK propagates nothing until you call `otel.SetTextMapPropagator(propagation.TraceContext{})`; B3-only or X-Ray-only setups), and proxies or CDNs that strip `traceparent` and `tracestate` before your backend sees them.
- **APIs on another origin** that you have not listed in [Trace propagation origins](#apis-on-another-origin).
- **Pages without a real origin of their own:** sandboxed iframes, `about:blank`, `srcdoc` and `file:` pages.
- **React Native.** The SDK does not instrument networking, so link mobile telemetry yourself with `onSessionChange()` (see [React Native API](#react-native-api)).

### Your page's own browser telemetry

Backend telemetry needs none of this. If the page also runs the [OpenTelemetry browser SDK](/docs/rum/browser-setup), its own spans (document loads, route changes, the errors you report) are separate telemetry that the headers do not touch. To file them under the recording as well, stamp `session.id` on each span as it starts, using `onSessionChange`, which fires immediately when a session exists and again on every rotation:

```js
let replaySessionId = null;

(window.OneUptimeReplayQueue = window.OneUptimeReplayQueue || []).push([
  "onSessionChange",
  (sessionId) => {
    replaySessionId = sessionId;
  },
]);

// Add to the spanProcessors of your WebTracerProvider.
const replaySessionSpanProcessor = {
  onStart: (span) => {
    if (replaySessionId) {
      span.setAttribute("session.id", replaySessionId);
    }
  },
  onEnd: () => {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
};
```

A span processor stamps each span with the id that was current when the span started. Writing the id into `resource.attributes` instead would re-label spans still waiting in the export batch when the session rotated. Unlike the automatic headers, the listener is told the id as soon as the recorder starts, before consent or a trigger, so gate the stamping on your own consent state if that matters. [Browser Setup](/docs/rum/browser-setup#joining-traces-to-session-replay) shows where this goes in a full setup.

### Where the links are

An exception in the dashboard shows a **Watch what the user saw** card when a recording exists for a session that hit that error, and opens the player ten seconds before the exception with the Errors tab selected. A span's details offer **Watch session at this span**; a log row's details offer **View session replay** at the moment of the line when the log itself carries the session id, and a log linked by trace id reaches the recording through its trace. In the other direction, every network, log, trace and error row in the player links out to the trace view, the logs explorer scoped to the session at that moment, or the exception group.

## Watching a session

### The session list

_Real User Monitoring → your application → Session Replay_ lists the sessions in the selected time range (the past 24 hours by default), newest first. Whether recordings are arriving right now, and why not if they are not, is on the application's **Health** page (see [Recording health](#recording-health)); when the list is empty, its empty state names the same cause.

Each row shows:

| Column | What it shows |
| --- | --- |
| **Session** | The entry path, up to three route pills ("/cart → /checkout → /pay (3 pages)"), the short session id and when it started. A pulsing dot marks a session that is still recording. |
| **User & device** | An avatar and a name: the identified user's reference; _Visitor a1b2c3_ (the first six characters of the [anonymous visitor id](#anonymous-visitors)) for an unidentified session from a current recorder; _Anonymous_ when the session carries neither; or _Hidden_ when your role cannot read identity. Then browser, OS, device type and country. Click the name to narrow the list to that person: a `user:` token for an identified user (it appears in the search box), a `visitor:` token for a visitor, and a pseudonymous-key filter when the label is hidden from you. |
| **Activity** | Duration, pages, clicks and the idle share ("idle 40%"). Counts are only shown once they have been measured; a session that is not finalized yet reads "counting". |
| **Signals** | Errors, rage / dead / error clicks, refresh rage, traces, exception groups and _Slow_ (a performance budget fired). Each badge opens the player on the matching rail tab. A finalized session with nothing to report reads _Clean_; one that is not finalized yet _Not counted yet_. |
| **Recording** | One badge that says honestly whether there is footage to watch, plus the trigger reason ("Always-on", "Sampled (25%)", "Error", "Frustration", "Slow page", "Manual"). |
| **Actions** | **Watch**, and **from 1st error** when the session had one — it opens the player at the first error with the Errors tab selected. **Watch** is offered only where footage exists; otherwise the row reads _Signals only_. Click anywhere on a row to open it; Cmd/Ctrl-click opens a new tab. |

The Recording badge states:

| Badge | Meaning |
| --- | --- |
| **Recording now** | The session may still be recording; footage plays as it arrives and the player refreshes every 30 seconds. It changes to _Recording ended_ about a minute after every tab of the session has ended. Duration, pages and signals are counted when the session is finalized (see below). |
| **Recording ended** — finalizing | Every tab of the session has ended, so nothing more is being recorded. The footage plays now; duration, pages and signals are counted shortly, when the session is finalized and the row becomes _Playable_ or _Partial_. |
| **Playable** — expires in 6d | Footage is stored, with the date it leaves retention. |
| **Partial** — about 45s missing | Some chunks never arrived. The player skips the holes and marks them on the timeline. |
| **Metadata only** | Only the session's metadata remains — the signals, device and page list — and the footage is no longer stored. |
| **Recording lost** | A session was opened but its footage never arrived, or expired before it could be processed. The signals and counts are still accurate; there is nothing to play. |

**When a session is finalized.** A session's duration, pages and signals are counted, and its badge settles on _Playable_ or _Partial_, once nothing more will arrive for it. A tab has ended when its page went away — closed, reloaded, navigated away from, or put into the back/forward cache — or when it reached the chunk cap (480 chunks, about two hours of continuous recording), after which OneUptime accepts nothing more from it. Once every tab of a session has ended, OneUptime waits about a minute in case the next page of the same app picks the session up; if none does, the row reads **Recording ended**, and the session is usually finalized within about another minute. When the browser never says the tab ended — a mobile browser was swiped away, the browser crashed, or it discarded a background tab — the session is finalized 10–15 minutes after its last chunk instead, and reads **Recording now** until then. So does a page still running a recorder older than the one this version of OneUptime publishes when it goes into the back/forward cache: older recorders did not mark that as an end.

While the page of the list you are on shows a session that is not finalized, the list refreshes itself every 30 seconds, keeping your filters and page — only while its browser tab is visible, and for up to 10 minutes after you last loaded the list or came back to its tab; after that, **Refresh** reads it again and restarts the 10 minutes. A refresh waits while your pointer is over the list or a row has focus, so the row you are about to open cannot change under you.

**Quick filters** above the list: All, Errors, Frustration, Identified (the page called `identify()`), Playable, Slow (performance trigger), Live (not yet finalized: still recording, or ended and still being counted) and Traced (carries at least one backend trace id). **Sort** by Newest, Longest, Most errors or Most frustration. Page size is 20, 50 or 100.

**Search.** The search box takes free text and tokens, and they combine:

| Token | Matches |
| --- | --- |
| `user:jane@acme.com` | The identified user reference. Never written to the URL. |
| `visitor:<id>` | Every session from one browser, by its full [anonymous visitor id](#anonymous-visitors). Clicking a _Visitor_ name, or **Sessions** on a Users page row, sets it for you; it is written to the URL as `visitor`. |
| `url:/checkout` or `page:/checkout` | Sessions whose entry URL or any visited route starts with the path (a full `https://` URL works too). |
| `tag:build=1.4.2` | A tag set with `setTags()` / `addTag()`. Repeat the token for several tags. |
| `browser:Chrome` `os:macOS` `device:mobile` `country:DE` | Device facts. `device:` is `desktop`, `mobile` or `tablet`. |
| `trigger:error` | The trigger reason: `error`, `frustration` (or `rage`), `slow` (or `performance`), `sampled` (or `always`), `manual`. |
| `min:2m` | Minimum duration: `90`, `90s`, `2m`, `1h30m` or `1:30`. |
| `id:<sessionId>` | Narrows the list to ids with that prefix; pressing **Enter** opens the session directly. |

Bare text is routed by shape: something starting with `/` or `http` is a URL prefix, something containing `@` is a user reference, and anything else is a free-text search over the session id prefix, entry and exit URLs, visited routes, exact trace ids and — when your role may read it — the user label. Free text is capped at 200 characters and at a 30-day window; a wider range answers "narrow the range" rather than an empty list. Quote a value that contains spaces. The **Filters** button opens the same fields as a form, plus an exact-route filter the box does not cover.

The list URL carries the whole state — `signal`, `browser`, `os`, `device`, `country`, `route`, `urlPrefix`, `tag` (repeatable), `minDuration`, `trigger`, `sort`, `q`, `visitor`, `userKey`, `range` or an absolute `startTime`/`endTime` pair, and `page` — so a filtered view can be linked from an incident. The user reference is the one filter never written to the URL. The two person filters that are written name nobody on their own: `visitor` is the recorder's random id, and `userKey` is the pseudonymous key the server stores an identified user under — the filter the list applies when you click a name your role sees as _Hidden_. The raw key is never shown; its filter chip reads "pseudonymous key".

If your role cannot read end-user identity, a `user:` filter is dropped by the server and the list shows a **User filter ignored** notice rather than silently answering for everyone. The `visitor:` and pseudonymous-key filters are not gated, because neither token says who the person is.

**When every session is anonymous.** If every row on the page is unidentified, a quiet note above the list says so — _No session here is linked to a signed-in user_ — and explains that calling `OneUptimeReplay.identify()` when your page knows who is signed in groups sessions by person here and in the player, and that until then sessions from the same browser are grouped by visitor id. It links to the setup guide and to the Users page, and dismissing it silences it for the tab. It needs at least three rows before it appears, and it stays away when any row's identity is merely hidden from your role, since that row may well be an identified person.

### The Users page

The Users page is its own page beside the session list: in the side menu under **Real User Monitoring → your application → Replay Users**, at `.../session-replay-users`, and reachable from the **Users** button on the session list and from the `identify()` banner above it. It shows the same time range rolled up by person. Where the session list answers "what happened", the Users page answers "who had trouble, and how often": one row per identified user, one per [anonymous visitor](#anonymous-visitors), and at most one **Unlinked sessions** row for recordings made by a recorder that sent no visitor id. Rows are ordered by when the person was last seen. The page has no search, sort or filter controls because the rollup takes none of them; only the time range applies, and it is the one thing the two pages share — the URL carries it under the same `range` or `startTime`/`endTime` keys, so a link into either page opens the other on the same window.

A visitor row counts only the sessions in which nobody was identified; opening its sessions shows every session from that browser, including the ones recorded after the person signed in, so the list can hold more rows than the count.

| Column | What it shows |
| --- | --- |
| **User** | The avatar and name by the same rules as the session list — the reference, _Visitor a1b2c3_, or _Hidden_ — with the browser, OS and country of the person's **newest** session and, for an identified user, how many traits it carried. |
| **Sessions** | How many sessions in the range, and how many are still recording ("2 live") or, when none are, when the person was first seen. |
| **Last seen** | When their newest session started. |
| **Time** | Recorded time summed over their sessions, and the total number of pages. |
| **Signals** | Error and frustration totals across their sessions (the error badge says how many sessions they fell in); _Clean_ when there are none. |
| **Actions** | **Sessions** opens the session list filtered to that person, on the same time range — for an identified user the list shows `user:<reference>` in the search box, for a visitor `visitor:`, and the pseudonymous key when the label is hidden from you. The reference itself never travels in the URL: the link carries only the pseudonymous key, and the list looks the name up from your own browser tab. **Watch latest** opens their newest session in the player. |

Identified users are grouped by the pseudonymous key the server stores the reference under, so the rollup works for roles that cannot read identity; the label and traits are only sent to roles that can, and the row reads _Hidden_ otherwise. Visitors are grouped by visitor id. That is also the honest limit of the page: a person who browsed anonymously and then signed in on the same browser is counted under their visitor row for the sessions before `identify()` and under their user row after it. The player's other-sessions menu joins the two; the rollup does not. The **Unlinked sessions** row offers no **Sessions** filter — nothing on those sessions can select them as a group — though **Watch latest** still opens the newest of them.

The rollup is computed on the server (`POST /telemetry/rum/session-replay/users`, under the same permissions as the list) rather than by grouping the session list in the browser, because the list is paginated by keyset: a page of 20 sessions would say "3 sessions" for a person who had 30, with the other 27 on pages you had not fetched. The server rolls up the whole range and pages the people instead.

### User flows

**User Flows** is in the side menu under **Real User Monitoring → your application → User Flows**, at `.../user-flows`. It draws how people move through your application page to page, from the recordings in the selected range (a week by default): where they land, which page they go to next, where they leave, and where they go in circles.

The flow map has one column per step. A page is a box whose height is the number of sessions at that step, and a band between two boxes is as thick as the number of sessions that made that move. A red stub off a box is the sessions that left the application there; a grey fade means the journey continues past the last column. A band drawn in amber is one where most sessions were going **back** to a page they had already seen. A red dot on a box means sessions hit an error on that page. Hover a box or a band to follow its traffic through the map; click it for the detail panel.

| Control | What it does |
| --- | --- |
| **From session start** | Step 1 is each session's landing page. |
| **After a page** | Anchors the map on one page and follows sessions from the first time they reached it — "where do people go after `/pricing`?" |
| **Before a page** | Follows sessions backward from the first time they reached a page — "how do people get to `/checkout`?" The anchor is drawn on the right. |
| **Steps** / **Pages per step** | How many columns to draw and how many pages a column names before the rest are folded into **Other pages** (click it to see what it holds). |
| **Sessions** | All sessions, only sessions with errors, or only sessions with frustration signals (rage clicks, dead clicks, error clicks, refresh rage). |
| **Device** | Only desktop, mobile or tablet sessions. |
| **Group IDs in URLs** | On by default: `/orders/1042` and `/orders/1043` are one page, `/orders/:id`. Numbers, hex ids and long letter-and-digit tokens are grouped, as is every segment the recorder already replaced with `[redacted]`. |
| **Hide this page** | In a page's detail panel. Removes the page from every journey, so a login or consent interstitial stops splitting paths in two; hidden pages are listed above the map and can be shown again. |

The detail panel for a page shows how many sessions reached it at that step, how many left there, how many hit an error there, where visitors came from and went next across the whole range, up to five sessions to watch, and a link to the session list filtered to every session that visited the page. For a band it shows the share of each side and the sessions that made exactly that move.

Above the map, a few findings name the pages worth a look first: the page where the largest share of visitors hit an error, the page where the most journeys that were going somewhere end (pages almost nobody continues from, such as an order confirmation, are treated as natural ends and never named), the page with the most frustration, and the pair of pages people bounce between (A → B → A). Each finding needs at least three sessions. Click one to point the map at that page. Below the map, **Top paths** lists whole journeys by how many sessions took them, **Pages** has entries, exits, exit rate, errors and frustration for every page, and **Back and forth** lists the loops.

Every control is kept in the URL, so a map is a link you can share.

What the map is built from: each recording chunk carries the pages visited while it was open, in order, and chunks are ordered by time across tabs (the recorder starts a new tab on every full page load). A page repeated back to back — a reload, or two chunks on one page — counts once, and two visits to the same page inside a single chunk also count once, so the map shows journeys rather than exact page-view counts. Errors and frustration are attributed to the page a chunk was flushed from. The page reads the newest 5,000 recorded sessions in the range, and says so when the range held more; only recorded sessions appear, so sampling and capture triggers shape it the same way they shape the session list. The page is served by `POST /telemetry/rum/session-replay/user-flow` under the same permissions and plan as the session list.

### The player

The player opens wide by default — the RUM side menu steps aside so the stage and the events rail get the width; press `W` or use **Wide** in the header to bring it back. The header is one compact bar rather than a summary card, because every row it does not take is a row the recording gets. Its first line carries **All recordings** (back to the list with your filters intact), the user (or _Visitor a1b2c3_ for an anonymous session that carries a [visitor id](#anonymous-visitors), _Anonymous_ when it does not, _Identity hidden_ when your role cannot read identity), this person's other sessions, and the **Copy link**, **Session details**, **Wide** and **Theater** buttons. Its second line carries browser, OS, viewport and country, when the session was recorded, the short session id and the playhead as both an offset and a wall-clock time so you can cross-reference dashboards by eye.

From 1280px wide the player is sized to the window: the stage takes every pixel the header, the timeline and the transport do not, so the recording is drawn as large as the screen allows rather than inside a fixed box. It is never shorter than 720px, so on a short laptop window the page scrolls a little rather than squeezing the recording into the strip left over after the chrome — hiding the timeline's signal lanes from the transport's menu gives about another 90px back to the picture. Below that width the page falls back to ordinary flow — the stage keeps the recording's aspect ratio, capped at 70% of the window height, and the events rail stacks underneath it.

**This person's other sessions.** Beside the identity the header says **N sessions**: every session by the same person in the 30 days before this one, up to now — matched by the pseudonymous user key for an identified user, otherwise by the visitor id, and by both when the session carries both, so the sessions a user recorded before signing in on the same browser are included. Thirty days is a fixed window that keeps the lookup cheap; retention can run to 90 days, and older sessions stay reachable through the list's `user:` and `visitor:` filters. The count opens a dropdown listing them newest first — when, the entry page, browser and device, duration, an error count, a red dot for one still recording, and _Watching_ on the one on screen — and **Older** / **Newer** buttons beside it step through them; `{` and `}` do the same from the keyboard and are on the `?` shortcuts sheet. A session with no sibling in the window reads _Only session in 30 days_. A session that carries neither a user key nor a visitor id — recorded by an older recorder for a page that never identified anyone — reads _Not linked to other sessions_, because there is nothing to look its siblings up by. When a recording plays out and the same person has a newer session, the ended card over the stage offers **Next session by this user** beside **Watch again**, which opens the same recording `}` would.

Above the stage a URL bar shows the page the user was on at the playhead, with copy and open buttons, and a chip shows the recorded viewport and the scale it is drawn at. Beside them the stage fit has three settings: **Fit** scales the whole page to the stage, **Width** fills the stage's width and scrolls the recording vertically — which is how you read a tall page at full detail instead of as a thumbnail — and **1:1** draws it at recorded pixels and scrolls both ways (the chip drops the percentage there, since 1:1 is 100% by definition). `Z` steps through the three, and the setting is remembered for the next recording you open. Mobile recordings are drawn in a phone-shaped frame.

Use **Select text** in that bar to pause the replay and copy visible text from the recorded page into a bug report, search, or terminal. The page remains read-only: links cannot navigate, controls and media cannot operate, and editing, paste, cut, drag and form submission are blocked. Any inspection-time scrolling is restored on exit; starting playback, seeking or switching recorded tabs leaves selection mode first. Copying cannot reveal content that was masked or blocked at capture time; _Mask all text_ recordings still contain placeholders rather than the original words.

While the replay is paused, a screenshot dock in the bottom-right corner of the stage offers **Copy image** and **Download**. Both take the frame on the stage as a PNG — at the recorded viewport size, or up to twice that on a high-density screen, with the pointer where the stage draws it — and a thumbnail of it confirms what was taken. **Copy image** puts it on the clipboard, ready to paste into an issue or a chat; **Download** saves it as `session-replay-<session>-<offset>.png`, named after the session and the playhead (plus the tab, when the session has several). The picture is redrawn in your browser from the replay itself and nothing is fetched to make it, so a recorded image the stage could not load stays empty in the screenshot too, and content that was masked or blocked at capture time stays masked. Browsers only let a secure (`https`) page copy images; on a plain-http install **Copy image** says so and offers **Download** instead. The dock steps aside while **Select text** is on.

The controls under the stage sit on one row: play/pause, the current time and duration, −10s / +10s, a speed menu (0.25× to 8×), **Skip idle**, previous / next error, next frustration, a **?** button that lists every keyboard shortcut, and a menu for the mouse trail, rail following, the timeline's signal lanes and whether playback carries on across tabs.

**The timeline** shows what footage exists and what happened in it:

- The track is coloured by what is loaded and what is still on the server. **Gaps** — stretches the recorder never delivered — are hatched amber and labelled ("18s missing"); playback jumps over them with a two-second notice rather than playing mutations across a hole. **Idle** stretches (five seconds or more with no mouse, scroll, input or click) are hatched gray and labelled; **Skip idle** jumps past them, and a chip over the stage offers the same skip whenever the playhead is in one. A **background tab** stretch (the user switched tabs) is drawn dotted.
- The activity lane shows how much was happening per chunk. Three marker lanes show Errors (client errors, server exceptions and error logs), Network / Traces (4xx, 5xx and failed requests, slow requests, error spans) and Navigation / Frustration (route changes, rage, dead and error clicks, refresh rage). Overlapping markers cluster into a count pill. Markers drawn hollow are approximate — the chunk they belong to has not been decoded yet — and turn solid as it loads. **Hide signal lanes** in the controls menu drops the three lanes and the legend and gives that height back to the recording; the track keeps its colouring and the markers that warn a stretch cannot be played, and the choice is remembered.
- Hover for a preview of the time, the nearest route and the signals within two seconds; click a marker to seek one second before it and select it in the rail; drag to scrub; wheel to nudge by a second.

**Tabs.** A session holds one recording per tab, and the recorder starts a new tab id on every page load — so a visitor who walked through four pages arrives as four "tabs" of one session, and a visitor with two windows open adds more. The switcher in the header lists the tabs that are **still open** first, each with a green dot meaning it is still recording, and the closed ones after; every pill names the page it was on and how long it lasted ("Tab 3 · /checkout · 30s"), and a line above them counts them ("3 tabs · 1 open · 2 closed"). Switching keeps the playhead where it is on the session clock. Pills wrap onto further rows rather than scrolling sideways, and a tab with no stored footage is disabled and says so.

Past six tabs the strip stops growing: it shows the open tabs and the one you are watching, and **All 11 tabs** opens a picker listing every one of them. The picker groups them under **Open**, **Closed** and **No footage** with a count on each heading, filters as you type a page or a tab number, and gives each row the page, when the tab opened, how long it lasted, its errors and frustration signals, a bar placing the tab against the session clock so "the one that was open when it broke" is findable by position, and **Watching** on the tab on screen. Once a session has finished nothing is open any more, so the headings collapse to a single list.

**Playing a whole visit.** Because every page load is another tab, playback would otherwise stop at each page of a visit. It does not: when the tab you are watching plays out and another has later footage, the player moves to that tab and keeps playing, saying which one it went to. So a four-page visit plays end to end from one press of Play. The walk follows the session clock, enters each tab at most once, and stops when nothing follows — where the ended card offers **Watch again** and, when the same person has one, **Next session by this user**.

It never overrides you. A tab you **paused** at the end of stays paused, and choosing a tab from the switcher yourself hands the walk back to you for that stretch. To watch one page load at a time, turn it off with **Stop at the end of each tab** in the transport's overflow menu; the choice is remembered, and the **Continue in Tab 2** chip in the header and on the ended card is then how you move on — one press both switches and resumes. The chip is also what you get wherever the walk declines to move you — the paused stop above, and a tab it has already been into once. A page the user came back to through the browser's back/forward cache appears as a tab of its own.

**Live sessions.** While a session is still recording the header shows a red **Live** pill and the player fetches new footage every 30 seconds without writing extra entries to the access log. The pill goes out about a minute after every tab of the session has ended; the player keeps checking every 30 seconds until the session is finalized, so its counts appear without a reload.

**Theater and links.** `F` or **Theater** goes fullscreen with the rail kept at the side; `Esc` leaves. **Link** (or `C`) copies a URL to the current moment, including the selected row and rail tab, so a teammate opens exactly what you are looking at. The URL parameters are `t` (seconds from the start), `at` (an absolute time in Unix milliseconds — what links from logs and exceptions use; it wins over `t`), `tab`, `rail`, `signal` and `q` (a rail search).

**Details** (`I`) opens a side panel with three tabs: **Session** (the facts, trace ids and exception groups observed, the session's tags and traits), **Privacy** (the masking mode, consent state and recorder version the session was captured under) and **Fidelity** (every notice about what the recording could not capture — a cross-origin stylesheet, a canvas, an iframe, a snapshot too large to store, recorder errors — with what each means for playback).

### The events rail

Beside the stage, the rail lists everything that happened, on the recording's clock, with a sticky "now" divider that follows the playhead. Click a row to seek one second before it; expand it for the detail. Each tab shows a count once it has been fetched — never a claimed zero. `R` hides the rail and brings it back, at any width; hidden, it leaves a narrow **Events** strip at the edge that opens it again. (The collapse button in the rail's own header is a desktop affordance, so `R` is the way to do it on a narrow screen.)

| Tab | What it lists |
| --- | --- |
| **All** | Everything below, merged. |
| **Console** | `console.error` and `console.warn` output, with arguments serialised shallowly and masked. |
| **Network** | Every `fetch` and XHR: method, URL, status, duration, request and response bytes, initiator. When a backend trace for the request exists the row shows it inline: root span, service, duration, status, span count and any error logs on that trace. The recorder captures at most 500 requests per session. |
| **Nav** | Route changes, full page loads and back/forward-cache restores, with the page's LCP when it was measured. |
| **Interact** | Clicks with the element's selector and label, plus rage, dead and error clicks and refresh rage. Recordings made before click labels existed show coordinates only. |
| **Perf** | Web vitals (LCP, CLS, INP, FCP, TTFB with their ratings) and the performance-budget events that fired. |
| **Errors** | Client-side errors from the recording merged with server-side exceptions linked to the session, either stamped with its id or on one of its traces; a client error and a server exception with the same message within two seconds are cross-referenced, never collapsed. |
| **Logs** | Your backend logs on this session's traces, joined by trace id, plus any log that carries the session id itself, from the Logs explorer. See [Correlating with your other telemetry](#correlating-with-your-other-telemetry). |
| **Traces** | Your backend traces linked to this session: spans stamped with its id at ingest, and the traces its requests carried. One row per trace with a small waterfall in the detail. |

Logs, Traces and the server half of Errors are read through the same permissions as the Logs, Traces and Exceptions pages; a role without them sees a locked tab that names the permission. Server-stamped rows are placed on the recording's clock by anchoring them to the traces the recording itself observed; the rail says whether that anchoring succeeded ("server times anchored via 6 traces") or the row's time is approximate.

The rail's search box (`/`) takes free text and tokens: `status:500`, `status:>=400`, `status:5xx`, `status:failed`, `level:error`, `kind:network`, `trace:<id>`, `method:post`, `url:/api/orders`, `service:payment`. A scope toggle narrows any tab to ±30 seconds around the playhead. The rail **follows** the playhead until you scroll it; a **Resume following** chip (or `M`) turns following back on.

### Keyboard shortcuts

Press `?` in the player for this list. Shortcuts never fire while you are typing in a field.

| Keys | Action |
| --- | --- |
| `Space`, `K` | Play or pause |
| `J` / `L` | Back / forward 10 seconds |
| `ArrowLeft` / `ArrowRight` | Back / forward 5 seconds |
| `Shift + ArrowLeft` / `Shift + ArrowRight` | Back / forward 30 seconds |
| `,` / `.` | Back / forward 1 second |
| `0` … `9` | Jump to 0% through 90% of the session |
| `Home` / `End` | Jump to the start / the end |
| `<` / `>` | Slower / faster |
| `S` | Skip past the current idle stretch |
| `Shift + S` | Toggle skipping idle time |
| `E` / `Shift + E` | Next / previous error |
| `N` | Next frustration |
| `[` / `]` | Previous / next row in the current rail tab |
| `{` / `}` | Older / newer session by this user |
| `J` / `K` (rail focused) | Next / previous rail row |
| `Enter` (rail focused) | Seek to the selected rail row |
| `Escape` | Clear the selection, or close a modal |
| `F` | Theater mode |
| `W` | Wide layout |
| `M` | Follow the playhead in the rail |
| `R` | Show or hide the events rail |
| `Z` | Cycle stage fit (Fit, Width, 1:1) |
| `/` | Search the rail |
| `C` | Copy a link to this moment |
| `I` | Session details |
| `?` | Shortcuts sheet |

## Recording health

The **Health** page — _Real User Monitoring → your application → Session Replay → Health_ — answers "is anything being recorded, and if not, why?" from the server's side, and the _Replay Policy_ page repeats its one-line diagnosis above the policy. The diagnosis names one cause, quantifies it and offers one action; it never says "disconnected" without a reason. The states, in the order they are checked:

| State | What it means | What to do |
| --- | --- | --- |
| `disabled-project` | The project-wide master switch is off. | Turn it on under _RUM → Settings → Session Replay_. |
| `disabled-app` | Session replay is off for this application. | Turn it on under _Replay Policy_. |
| `budget-paused` | The application's monthly budget or the deployment's daily byte limit is spent; live recorders have been told to stop. | Raise the budget, or wait for the next day / month. |
| `refusing` | Uploads are arriving and being refused — the diagnosis says the top reason and the count in the past 24 hours, for example `origin-not-allowed` (212 uploads from an origin that is not in your allowed origins) or `not-sampled`. | Follow the reason: edit the allowed origins, raise the sample percentage, and so on. |
| `never-loaded` | No browser has ever fetched this application's policy. The script tag is not on the page, or the identifier does not match. | The setup guide on the sessions page walks through it. |
| `loaded-never-uploaded` | The recorder fetched its policy recently but no chunk has ever arrived. The detail explains it from the policy: sampling is 0%, consent mode is _Require explicit_ and the page has not granted it, the trigger is _On error or frustration_ and nothing has fired — or, with a healthy policy, a CSP or ad blocker is refusing the ingest URL. | The action matches the cause. |
| `stale` | Recorders keep fetching the policy but no chunk has arrived for more than six hours. | Same causes as above, on a page that used to work: check what changed. |
| `healthy-quiet` | No chunk for more than six hours **and** no page has fetched the policy in the past 24 hours either, with nothing switched off, over budget or being refused. No recorder is running on this application right now — a low-traffic or staging app, or a snippet that is no longer on the page. The page quantifies both silences. | If your pages are being served, check that the script tag is still on them; otherwise nothing. |
| `healthy` | Chunks are arriving: the diagnosis shows the last chunk's age, sessions today and the sample percentage. | Nothing. |
| `unknown` | The status endpoint could not be read. | Retry; check the permission error the page shows. |

Below the diagnosis, the page lays a recording out as four stages — **Recorder loaded**, **Recording allowed**, **Chunks received** and **Sessions in 24h** — each marked green, amber or red by what the server knows about it, so the first amber or red stage is where recordings stop. Under that it lists uploads refused at the gate and chunks dropped after acceptance by reason, bytes used today and this month against their limits, the policy as the recorder receives it, the published recorder artifact label and the capabilities of the newest recorder that reported. Counters that come from Valkey read **unknown** — never 0 — when Valkey is unreachable. At the bottom, **Ask the browser** takes the output of `getDiagnostics()` and explains every code in it.

## Performance capture triggers

Under the default _Always_ trigger every sampled session is uploaded, so these budgets change nothing about what is recorded — they only mark the events that exceeded them on the timeline and in the **Perf** tab. When the trigger is _On error or frustration_, they extend the trigger set to sessions that were merely *slow*. Set them on the _Replay Policy_ page (Performance & Tracing step):

| Budget | Fires when | Suggested starting point |
| --- | --- | --- |
| Largest Contentful Paint (ms) | The page's LCP exceeds the budget | 4000 — the boundary of a "poor" LCP |
| Long task (ms) | A single main-thread task blocks for at least the budget | 200+ — browsers only report tasks over 50 ms |
| Slow request (ms) | A `fetch`/XHR **succeeds** but takes at least the budget | Your API's timeout expectations |

Each budget is off at `0` (the default). Sessions captured this way appear with the trigger reason **performance** (_Slow_ in the list). Failed and cancelled requests are not counted here — a 5xx or a network failure already triggers via the error path.

Independently of the budgets, the recorder reports the Core Web Vitals of every page — LCP, CLS, INP, FCP and TTFB with their good / needs-improvement / poor rating — as **Perf** rows. Vitals never trigger an upload on their own.

INP is reported **per view**, not per page load. In a single-page app every route change (`pushState`, `replaceState`, back/forward, or a `#/` hash route) closes the current view and starts a new one, so a visit through five routes gets up to five INP rows, each labelled with its route. An interaction belongs to the view it started in: the click that navigated from `/products` to `/cart` counts towards `/products`, which is the page that was slow to respond. Each INP row also says what the slow interaction was — pointer or keyboard, the element (a structural selector such as `div#checkout > button.pay`, built like a click's and never containing text or attribute values), and how its time split into input delay, processing and presentation. A view is reported about a second after the user leaves it, or when the tab is hidden.

## Recording a specific user's next session

When a named customer reports a problem you cannot reproduce, you can arm a one-shot target instead of waiting for an error: on the application's _Replay Policy_ page → **Record a specific user's next session**, enter the same end-user reference your page supplies and click **Record next session**. That user's next visit records from its first event, labelled with trigger reason **manual**.

Honest limits, so "armed" is not misread as "guaranteed":

- Your page must supply the reference **at load time** — the `data-oneuptime-user-ref` attribute or `userRef` on the init global — because the target is matched when the policy is fetched, before the recorder artifact exists. A reference set later via `identify()` is too late for that page load, though it still makes the session searchable by `user:`.
- Consent still applies. A targeted session in _Require explicit_ mode uploads nothing until your page grants consent.
- The target expires after 24 hours, is consumed by the first matching page load, and only a keyed hash of the reference is stored server-side.

## Offline mode

Both recorders keep recording when the device loses its connection, and upload everything they recorded, in order and under the same session, when it comes back. Nothing needs configuring.

- **An outage is not a failure.** A request that never reaches OneUptime does not count against the recorder's circuit breaker or against the chunk, however long the outage lasts. Throttles from the server are waited out the same way. (The browser recorder still counts a failure before its very first successful upload, because that is also what an ad blocker refusing the upload URL looks like.)
- **It uploads as soon as it can.** The browser recorder sends nothing while the browser reports itself offline and drains the backlog on the browser's `online` event; the React Native SDK retries with a gentle backoff, again when the app returns to the foreground, and immediately if you pass a `connectivity` source such as NetInfo: `connectivity: { subscribe: (listener) => NetInfo.addEventListener((state) => listener(state.isConnected)) }`.
- **A closed tab or a killed app loses nothing.** The browser recorder also writes what it has queued to the browser's IndexedDB (database `oneuptime-session-replay`), including the last seconds of a tab closed while offline, and the next page of your application that loads with a connection uploads it. The React Native SDK keeps its queue in AsyncStorage, compressed, and uploads it on the next launch. An app launched with no connection records under the last policy it was given (at most three days old) and fetches a fresh one when it can.
- **Recordings keep their real time.** A session recorded on a flight and uploaded on landing appears in the session list at the time it happened, not the time it arrived.
- **Bounded and private.** The browser queue holds up to 240 chunks or 4 MB, the mobile outbox 240 chunks or 3 MB compressed; past that the oldest chunks are dropped and the player shows the gap. What is stored is the same masked content that would have been uploaded, is deleted after three days if it was never sent, and is deleted at once by `revokeConsent()`. A page that has not been given consent uploads nothing an earlier page stored. Set `data-oneuptime-offline-storage="false"` to keep queued chunks in memory only.

A web page that is _loaded_ while offline does not record: the recorder has to fetch your application's policy from OneUptime before it starts.

## What is not recorded

These are surfaced on the player's **Fidelity** tab rather than silently blank, so you always know what you are not seeing:

| Not captured | Why |
| --- | --- |
| Canvas / WebGL | Off by default. Opt in per application; it is expensive and can capture rendered user data. |
| Cross-origin iframes | Payment iframes stay black boxes. This is intentional. |
| Closed shadow roots | Not traversable, so not recorded rather than recorded unmasked. |
| Web fonts | Too large. Playback falls back to a system font stack. |
| `<video>` / `<audio>` | Rendered as a labelled placeholder. |
| Cross-origin stylesheets | Not readable without `crossorigin`; a notice explains it. |
| A very large DOM snapshot | A snapshot the recorder could not store is reported, and playback starts from the next one. |
| Signals past a cap | Console output, network requests and clicks are capped per session or per chunk; the rail marks where capture stopped. |
| React Native image pixels | The image frame is preserved as an opaque placeholder; user photos and downloaded pixels are not copied. |
| React Native WebViews | Outside the native view tree. Record the hosted page separately with the web recorder if needed. |
| React Native canvas and custom drawing | Skia, OpenGL, maps, camera/video previews and similar surfaces are opaque placeholders. |
| React Native animation frames | Native and UI-thread motion is sampled at snapshots rather than reproduced frame by frame. |

## Retention and deletion

Recordings are kept for **7 days** by default; 1, 14, 30 and 90 days are also available per application. The expiry is computed from the **session's start**, not from when each chunk arrived, so a session expires as a whole rather than losing its later minutes first. The session list shows the expiry on each row ("expires in 6d").

Be aware that **the session row expires with its footage**: error counts, frustration signals, device facts and the rest of the metadata share the recording's retention and are gone when it is. The spans and exceptions stamped with the session's id follow the telemetry retention of the application instead and remain searchable by session id in their own explorers; backend logs linked by trace id stay searchable by that trace id. Removal runs in the background, so for a short while after the expiry a session can still be listed while the player explains that its footage has expired; once the row is gone, a saved link answers "expired on ⟨date⟩ under the application's N-day retention".

### Erasing sessions

To satisfy a deletion request, file an erasure request through the OneUptime API — the `/rum-session-erasure-request` resource; there is no dashboard form for it yet. A request needs `CreateRumSessionErasureRequest` (or a project owner / admin) and takes:

| Field | Values |
| --- | --- |
| `requestType` | `BySessionId`, `ByIdentifiedUserKey`, `ByDateRange` or `ByRumApplication`. |
| `targetValue` | The session id, the end-user key as stored on the session (the one-way derivation of the reference — the raw reference is never accepted, by design), or the application id. Unused for a date range. |
| `startDate` / `endDate` | The window for `ByDateRange`. |
| `rumApplicationId` | The application the request applies to. |

Two honest limits on `ByIdentifiedUserKey`. The key is not shown anywhere in the dashboard: it comes back as `identifiedUserKey` on each row of the session list API (`POST /telemetry/rum/session-replay/list`), so today an erasure by user starts with a `user:` search there and a copy of that field. And a session recorded while **Capture user identity** was off has no key at all — nothing about the person was stored — so it can only be reached by session id, date range or application.

Each request records its `status` (`Pending`, `InProgress`, `Completed`, `Failed`), the `sessionsDeleted` and `chunksDeleted` counts and any `failureReason`; `ReadRumSessionErasureRequest` lets someone review them. Erasure removes the recording **and** the telemetry linked to those sessions, and any recording still in flight when the request completes is dropped rather than written. A link to an erased session answers "erased" rather than "not found". The linked telemetry is:

- every span and exception stamped with the session's id, including the backend spans stamped [automatically](#correlating-with-your-other-telemetry) in every service that forwarded the trace context, and any log that carries the id itself;
- the logs, exceptions and spans of every trace that belongs to the erased sessions alone: every stamped span in the trace carries one of their ids, and nothing in the trace started more than ten minutes before the first or after the last of those spans. That covers the backend logs of the requests your pages made to their own origin, which share a trace id with those stamped spans.

Erasure does not follow a trace id any further, so it leaves in place:

- telemetry the player matched to the recording only by a trace id the recording observed, because nothing in that trace carries the session id: requests to APIs on another origin listed in [Trace propagation origins](#apis-on-another-origin), requests that already carried a `tracestate`, and other trace ids your page set on requests that carried no session id;
- the rest of a trace shared with other sessions, or of one that started more than ten minutes before its first stamped span or continued more than ten minutes after its last (a trace id your page reuses across visitors, a long-running trace the request joined): only its rows stamped with an erased id are removed, because the others can belong to other people;
- the rest of a trace shared only by erased sessions that erasure handles in different batches. Erasure judges ownership per batch of up to 1,000 sessions, so in an erasure that covers more sessions than that (by application or by date range, typically), a trace two of them share can count as shared in each batch, and only its rows stamped with an erased id are removed.

Delete that telemetry by trace id yourself, or let telemetry retention remove it. Erasure only removes rows in this project. And a tab that is still open when its session is erased keeps sending the erased id on its requests until that session ends (30 minutes idle, or the 4-hour cap), so backend spans stamped after the erasure are not removed; telemetry retention removes them.

Because stamping reaches every service a browser request passed through, an erasure by application or by date range also removes the backend spans, logs and exceptions of that browser traffic, within the limits above, which on a busy application is a lot of rows. Erasure by user key, date range or application finds its sessions through the session list, which expires with the footage (see above); once a recording has expired, erase its telemetry with `BySessionId`, since the id is on the stamped spans, or let telemetry retention remove it.

## Who can watch a recording

Watching a recording is a separate permission from listing sessions, and neither is granted by the project-wide Viewer role. Project owners and admins hold all of them.

| Permission | Unlocks |
| --- | --- |
| `ReadRumSessionReplay` | The session list, the Users page and each session's metadata: counts, signals, device, the visitor id — but not the recording, and not who the user was. A support engineer can triage which sessions errored without playing anyone's screen back. |
| `ReadRumSessionReplayPayload` | Playing a recording back, and reading the identified user's reference and traits in the list, the player and the `user:` filter. |
| `ReadRumSessionReplayAudit` | The **Replay Access Log** — who watched what. |
| `DeleteRumSessionReplay` | Deleting recordings. |
| `CreateRumSessionErasureRequest` / `ReadRumSessionErasureRequest` | Filing and reviewing erasure requests. |

Label-based access applies: a member restricted to a set of labels can only reach applications carrying one of them, and the identity gate honours the same scope.

Every playback is recorded in an audit trail under _Real User Monitoring → your application → **Replay Access Log**_: who watched which session, when, from what IP address and user agent, for how long (reported in 15-second buckets while the player is actually playing, so "< 15s" means it was opened and closed), and the reason — the incident or exception the viewer arrived from, when there was one. Refreshing a live session does not add entries; each open of the player adds one.

## Troubleshooting

Under the default _Always_ trigger a working page posts a chunk about every 15 seconds **while the user is doing something**; an idle page posts nothing, so interact with it before deciding the install is broken. If you have set the capture trigger to _On error or frustration_, the recorder records into memory and uploads only when something goes wrong, so **a healthy page makes exactly one request to OneUptime per page load** — the config fetch — and posts nothing else until an error, a 5xx, a frustration signal or a performance budget breach happens. From a Network tab that is indistinguishable from an installation that does not work.

Two things tell you which one you are looking at. From the server's side, the application's **Health** page (see [Recording health](#recording-health)). From the browser's side, the recorder's own diagnostics:

```js
localStorage.setItem("oneuptime.sessionReplay.debug", "true");
// then reload the page
```

Every decision the recorder makes is then printed with a stable code, and

```js
OneUptimeReplay.getDiagnostics();
```

returns the last 250 of them together with the recorder's `state`, `decisions` and `capabilities` — **whether or not diagnostics were switched on when they happened**, so you do not have to reproduce the problem first. It carries no page content by construction, so it is safe to paste into a support ticket, and the **Health** page has a box that explains it for you.

[Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting) explains every code and what to do about it, and the **Test your installation** panel on the _Replay Policy_ page answers the same question from the server's side.

## Self-hosted notes

- Session Replay is **on** at the deployment level by default. Set `SESSION_REPLAY_ENABLED_BY_DEFAULT=false` to turn it off for the whole instance — recorders already running on customer pages then stop recording, not just uploading.
- Set `SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY` to bound disk use. Replay is the largest table in the system, and an unbounded configuration can push ClickHouse into capacity pruning. When the limit is spent the **Health** page reads "Uploads paused for today".
- Recordings are stored in ClickHouse. No object storage is required.
- `SESSION_REPLAY_DEBUG=true` makes every recorder this deployment serves print its decisions to the browser console. It is the one diagnostics switch that does not need somebody at the failing browser, so it is useful when a customer reports "nothing happens" on a page you cannot open a console on. It changes no policy — not sampling, not masking, not consent — but it logs on **every** page every recorder runs on, so turn it on, collect one reload, and turn it off.
