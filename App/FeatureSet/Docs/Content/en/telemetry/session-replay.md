# Session Replay

## Overview

Session Replay records what a real user saw in your web app and lets you play it back next to the error, trace and log data from the same session. **By default every session is recorded and uploaded as it happens**, not only the ones that broke — the sessions where nothing threw are where you find the checkout nobody completed, the form everybody abandoned and the page a customer says "looked wrong".

If you would rather store less, there are two dials and they compose:

- **Sample percentage** (100% by default) decides how many sessions are eligible at all. Halve it and you halve both the bytes stored and the end-user data at rest. The decision is made once per session from a hash of the session id, so a session is never half-recorded.
- **Capture trigger** set to _On error or frustration_ makes the recorder hold a rolling buffer in memory and upload **only when something actually goes wrong**. A recording then exists for very nearly every failed session while costing roughly 15x less than recording everyone — at the price of never being able to watch a session that did not fail.

## Prerequisites

- A RUM application — create one from _Resources → Real User Monitoring_, or let one be auto-discovered from your telemetry. See [Real User Monitoring](/docs/rum/index).
- A **Telemetry Ingestion Token** — _Project Settings → Telemetry & APM → Ingestion Keys_. Create it with the **Browser** surface; see [Set your allowed origins in production](#set-your-allowed-origins-in-production) for why.
- Session Replay is **on by default**. Settings live in two places:
  - **Per application**, under _Real User Monitoring → your application → Replay Policy_: the recording policy (masking, consent, sampling, retention, budgets), the **Recording health** card, the privacy summary, the **Test your installation** panel and **Record a specific user's next session**.
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

The script at `/v1/recorder.js` is a small loader. It fetches your application's policy, checks consent and Do Not Track, and only then loads the pinned recorder build. That indirection is deliberate: it means a masking change you make in the dashboard reaches live browsers within one config cache TTL (five minutes), and a bad recorder release can be rolled back without waiting out a browser cache.

### Script tag attributes

| Attribute | Required | What it does |
| --- | --- | --- |
| `data-oneuptime-token` | **yes** | Your telemetry ingestion token. |
| `data-oneuptime-app-identifier` | **yes** | The RUM application's identifier. |
| `data-oneuptime-host` | no | The OneUptime origin. Derived from the script's own `src` when omitted, so you only need it when you proxy the script through your own domain. |
| `data-oneuptime-user-ref` | no | The end-user reference known at page load (a user id, never an email you would not want stored). The same thing `identify()` sets later; it is the only form that works for [Record a specific user's next session](#recording-a-specific-users-next-session). |
| `data-oneuptime-respect-do-not-track` | no | Defaults to honouring Do Not Track and Global Privacy Control. Set it to `"false"` to record regardless of the signal; see [Do Not Track](#do-not-track). |
| `data-oneuptime-debug` | no | `"true"` prints the recorder's decisions to the console. See [Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting). |

The same options can be supplied on a global instead of the tag, which is what tag managers and bundled installs use:

```js
window.__ONEUPTIME_SESSION_REPLAY__ = {
  host: "https://oneuptime.com",
  token: "YOUR_TELEMETRY_INGESTION_KEY",
  appIdentifier: "storefront-web",
  userRef: "user-123", // optional
  respectDoNotTrack: true, // optional
  debug: false, // optional
};
```

### What a healthy install looks like

Open DevTools → Network and filter for `session-replay`. A working page makes:

1. **One `GET .../session-replay/v1/config`** per page load — the policy fetch.
2. **A `POST .../session-replay/v1/chunk` about every 15 seconds while the user is doing something**, or sooner when 256 KB of events have accumulated. An idle tab produces no events and therefore **no POST at all**: move the mouse or click before you judge an install from the Network tab.
3. When the tab is hidden or closed, **one** `POST` sent with `keepalive` that seals the recording. Its whole body stays under **56 KB** — the recorder's share of the browser's 64 KB per-origin keepalive quota — and it can carry several chunks as frames of that one request: the closing chunk, the pieces a large closing chunk was cut into (at most 48 KB of events each, so the frame header still fits), and any chunk that was still waiting to be retried. A chunk already larger than that budget when the tab is merely hidden goes out on the ordinary path instead, while the page is still alive to send it.

Under the _On error or frustration_ trigger, step 2 does not happen until a trigger fires — see [Troubleshooting](#troubleshooting).

## Identify your users

Every session is anonymous until your page says who it belongs to. Call `identify()` as soon as you know, or queue it before the script has loaded — either way it is applied before the first chunk is uploaded, so the session is searchable by user from the moment it appears:

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
| `onSessionChange(listener)` | `listener(sessionId, tabId)` is called immediately if a session exists and again whenever the id changes — after 30 minutes idle, at the 4-hour cap, or when another tab of the same visitor rotated first. Returns an unsubscribe function. This is what puts `session.id` on your OpenTelemetry resource; see [Correlating with your other telemetry](#correlating-with-your-other-telemetry). |
| `grantConsent()` | Under consent mode _Require explicit_, allow uploads. Nothing is uploaded before this. |
| `revokeConsent()` | Drop everything buffered and stop uploading. The recorder keeps running into memory only, so a later `grantConsent()` continues on a fresh session id. |
| `getSessionId()` | The current session id, or `null` when nothing is recording. Prefer `onSessionChange()`, which also follows rotations. |
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
| `capabilities` | What this recorder build captures: `click-events`, `web-vitals`, `custom-events`, `traits`, `tags`, `visibility`. The dashboard's health card shows the same list for the newest session, so an old cached artifact is easy to spot. |
| `tags`, `hasTraits`, `triggerReason`, `isRecording`, `isUploading`, `sessionId`, `tabId`, `version` | The session's current state. `isRecording` is true only while the recorder is actually recording. |
| `records` | The last 250 decisions with stable codes — including the loader's, from before the artifact existed. Every code is explained in [Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting#codes). |

## Privacy

**Masking happens at capture, in the end user's browser, before anything is uploaded.** The server never receives what was masked, so a masking decision cannot be undone after the fact — and cannot be applied retroactively either. What gets masked depends on the mode; the table below is what you get if you configure nothing. The **Privacy summary** card on the application's _Replay Policy_ page restates these five decisions in plain sentences for whatever you have configured.

| Control | Default | What it does |
| --- | --- | --- |
| Session Replay enabled | **on** | Per-application switch. Turn it off to stop recording for one application. |
| Masking mode | **Mask sensitive inputs only** | Passwords and card / one-time-code fields are masked. The rest of the page — static text and ordinary input values — is recorded as it looked. See the warning below. |
| Consent mode | **Not required** | Uploads start immediately. Set *Require explicit* if you need a per-session consent handshake, which most EU deployments will. |
| Capture trigger | **Always** | Every sampled session uploads from its first event. Set *On error or frustration* to upload only when something goes wrong. |
| Sample percentage | **100%** | Share of sessions eligible for recording. This is the dial for cost. Note that 0% together with *Always* records nothing at all; the policy page warns when you configure that. |
| Allowed origins | **empty (any origin)** | List your domains to restrict who may send recordings. See the warning below. |
| Capture user identity | **on** | The end-user reference and traits your page supplies are stored, so you can find a named customer's session. Turn it off to keep recordings pseudonymous — with it off nothing about the person is stored, including the key an erase-by-user request would have to match ([Identify your users](#identify-your-users)). |
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

Your ingestion token lives in plain sight in your page's JavaScript — that is unavoidable for a browser recorder — so there are two fences, and they compose:

- **On the key.** Create the ingestion key with the **Browser** surface and list its **Allowed Origins** (`https://app.example.com`, or `https://*.example.com` for one level of subdomain). A Browser key refuses a request from an unlisted origin, or with no `Origin` header at all. Give it an **Expires At** too: a scraped copy of the token then stops working on a date you chose rather than never.
- **On the application.** _Replay Policy → Allowed origins_ restricts which origins may write recordings into **this application**, whichever key they present. Once set, an exact-origin match is required and a request presenting no `Origin` header is refused.

A request has to pass both. The rate limit and daily byte budget bound how *much* an attacker could write; only the allowlists say anything about whether a recording is genuine. Set at least one of them before you point real traffic at the recorder; refused uploads show up on the **Recording health** card as `origin-not-allowed`.

### Always masked

Always masked regardless of mode, and not configurable:

- **Passwords**, including after a "show password" toggle. Once a field has ever been a password field it stays masked, and the type change itself is suppressed.
- **Card fields**, detected via `autocomplete` (`cc-number`, `cc-csc`, `cc-exp`), because card inputs are `type="text"` and otherwise invisible to type-based masking.
- **One-time codes** (`autocomplete="one-time-code"`).
- **File input values** — the browser exposes the real filename, and filenames are routinely personal.
- **Query strings and fragments** are dropped from every recorded URL, and identifier-shaped path segments (UUIDs, emails, long digit runs, long opaque tokens) are replaced. This is the one channel text masking does not cover: a password-reset link would otherwise land in the session list.
- **Clipboard events** are never recorded.
- **Keystroke timing** is quantised, because inter-keystroke intervals leak typed content even when the value is masked.
- **Request and response bodies and headers** are never recorded. A network row in the player carries the method, URL, status, timing, byte counts and the trace id — nothing else.
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

Under _Require explicit_ the recorder records into memory from the first event and uploads the whole buffer once consent arrives, so the seconds before the banner was accepted are not lost. Until it arrives the **Recording health** card reads "waiting for consent", which is a policy answer rather than a fault.

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

Every recording carries a session id, and the join key between a recording and your OpenTelemetry data is the `session.id` attribute on your resource. Put it there with `onSessionChange`, which fires immediately when a session exists and again on every rotation, so the attribute follows the id:

```js
OneUptimeReplay.onSessionChange((sessionId, tabId) => {
  resource.attributes["session.id"] = sessionId;
  resource.attributes["session.tab.id"] = tabId;
});
```

With that in place the player's **Logs** and **Traces** tabs list your backend logs and spans that carried the id, placed on the recording's clock, and every log line, span and exception in the dashboard links back to the exact moment in the replay. If you cannot change the resource, `getSessionId()` returns the current id for span attributes. [Browser Setup](/docs/rum/browser-setup#joining-traces-to-session-replay) shows where this goes in an OpenTelemetry browser SDK setup.

**Linking browser requests to backend traces.** By default the recorder only *observes* a `traceparent` header your page's own instrumentation already set on `fetch` or `XMLHttpRequest` requests — read from `init.headers` or from a `Request` object — and it does **not** inject one, because adding a header turns a simple cross-origin request into a preflighted one, and an API that does not allow `traceparent` would start failing because you installed a recorder.

If you want recordings linked to backend traces **without** a browser tracing SDK, add your API's origin to **Trace propagation origins** on the _Replay Policy_ page (Performance & Tracing step). The recorder then generates a W3C `traceparent` header for requests to exactly those origins, and the network row in the player links to the backend trace of the request. Only list an origin whose API allows `traceparent` in `Access-Control-Allow-Headers` — that is the whole reason it is an explicit allowlist. Requests that already carry a `traceparent`, and `fetch` calls made with a `Request` object rather than a URL, are left untouched (a `Request` carries its own header state, and rebuilding one to add a header risks dropping a one-shot body).

**Where the links are.** An exception in the dashboard shows a **Watch what the user saw** card when a recording exists for a session that hit that error, and opens the player ten seconds before the exception with the Errors tab selected. A log row's details offer **View session replay** at the moment of the line; a span's details offer **Watch session at this span**. In the other direction, every network, log, trace and error row in the player links out to the trace view, the logs explorer scoped to the session at that moment, or the exception group.

## Watching a session

### The session list

_Real User Monitoring → your application → Session Replay_ lists the sessions in the selected time range (the past 24 hours by default), newest first. A line above the list — the **recording health strip** — says whether recordings are arriving right now, and why not if they are not (see [Recording health](#recording-health)).

Each row shows:

| Column | What it shows |
| --- | --- |
| **Session** | The entry path, up to three route pills ("/cart → /checkout → /pay (3 pages)"), the short session id and when it started. A pulsing dot marks a session that is still recording. |
| **User & device** | The identified user or _Anonymous_ ("Hidden" if your role cannot read identity), then browser, OS, device type and country. |
| **Activity** | Duration, pages, clicks and the idle share ("idle 40%"). Counts are only shown once they have been measured; a live session reads "counting". |
| **Signals** | Errors, rage / dead / error clicks, refresh rage, traces, exception groups and _Slow_ (a performance budget fired). Each badge opens the player on the matching rail tab. A finished session with nothing to report reads _Clean_; a live one _Not counted yet_. |
| **Recording** | One badge that says honestly whether there is footage to watch, plus the trigger reason ("Always-on", "Sampled (25%)", "Error", "Frustration", "Slow page", "Manual"). |
| **Actions** | **Watch**, and **from 1st error** when the session had one — it opens the player at the first error with the Errors tab selected. **Watch** is offered only where footage exists; otherwise the row reads _Signals only_. Click anywhere on a row to open it; Cmd/Ctrl-click opens a new tab. |

The Recording badge states:

| Badge | Meaning |
| --- | --- |
| **Recording now** | The session is still open; footage plays as it arrives and the player refreshes every 30 seconds. Duration, pages and signals are counted when it closes, about 10 minutes after the last chunk. |
| **Playable** — expires in 6d | Footage is stored, with the date it leaves retention. |
| **Partial** — about 45s missing | Some chunks never arrived. The player skips the holes and marks them on the timeline. |
| **Metadata only** | Only the session's metadata remains — the signals, device and page list — and the footage is no longer stored. |
| **Recording lost** | A session was opened but its footage never arrived, or expired before it could be processed. The signals and counts are still accurate; there is nothing to play. |

**Quick filters** above the list: All, Errors, Frustration, Identified (the page called `identify()`), Playable, Slow (performance trigger), Live (not yet finalized) and Traced (carries at least one backend trace id). **Sort** by Newest, Longest, Most errors or Most frustration. Page size is 20, 50 or 100.

**Search.** The search box takes free text and tokens, and they combine:

| Token | Matches |
| --- | --- |
| `user:jane@acme.com` | The identified user reference. Never written to the URL. |
| `url:/checkout` or `page:/checkout` | Sessions whose entry URL or any visited route starts with the path (a full `https://` URL works too). |
| `tag:build=1.4.2` | A tag set with `setTags()` / `addTag()`. Repeat the token for several tags. |
| `browser:Chrome` `os:macOS` `device:mobile` `country:DE` | Device facts. `device:` is `desktop`, `mobile` or `tablet`. |
| `trigger:error` | The trigger reason: `error`, `frustration` (or `rage`), `slow` (or `performance`), `sampled` (or `always`), `manual`. |
| `min:2m` | Minimum duration: `90`, `90s`, `2m`, `1h30m` or `1:30`. |
| `id:<sessionId>` | Narrows the list to ids with that prefix; pressing **Enter** opens the session directly. |

Bare text is routed by shape: something starting with `/` or `http` is a URL prefix, something containing `@` is a user reference, and anything else is a free-text search over the session id prefix, entry and exit URLs, visited routes, exact trace ids and — when your role may read it — the user label. Free text is capped at 200 characters and at a 30-day window; a wider range answers "narrow the range" rather than an empty list. Quote a value that contains spaces. The **Filters** button opens the same fields as a form, plus an exact-route filter the box does not cover.

The list URL carries the whole state — `signal`, `browser`, `os`, `device`, `country`, `route`, `urlPrefix`, `tag` (repeatable), `minDuration`, `trigger`, `sort`, `q`, `range` or an absolute `startTime`/`endTime` pair, and `page` — so a filtered view can be linked from an incident. The user reference is the one filter never written to the URL.

If your role cannot read end-user identity, a `user:` filter is dropped by the server and the list shows a **User filter ignored** notice rather than silently answering for everyone.

### The player

The player opens wide by default — the RUM side menu steps aside so the stage and the events rail get the width; press `W` or use **Wide** in the header to bring it back. The header shows the user (or _Anonymous_ / _Identity hidden_), browser, OS, viewport and country, the session start, and the playhead as both an offset and a wall-clock time so you can cross-reference dashboards by eye. **Sessions** takes you back to the list with your filters intact.

Above the stage a URL bar shows the page the user was on at the playhead, with copy and open buttons, and a chip shows the recorded viewport and the scale it is drawn at, with a **Fit / 1:1** toggle. Mobile recordings are drawn in a phone-shaped frame.

The controls under the stage: play/pause, the current time and duration, −10s / +10s, a speed menu (0.25× to 8×), **Skip idle**, previous / next error, next frustration, a **?** button that lists every keyboard shortcut, and a menu for the mouse trail and rail following.

**The timeline** shows what footage exists and what happened in it:

- The track is coloured by what is loaded and what is still on the server. **Gaps** — stretches the recorder never delivered — are hatched amber and labelled ("18s missing"); playback jumps over them with a two-second notice rather than playing mutations across a hole. **Idle** stretches (five seconds or more with no mouse, scroll, input or click) are hatched gray and labelled; **Skip idle** jumps past them, and a chip over the stage offers the same skip whenever the playhead is in one. A **background tab** stretch (the user switched tabs) is drawn dotted.
- The activity lane shows how much was happening per chunk. Three marker lanes show Errors (client errors, server exceptions and error logs), Network / Traces (4xx, 5xx and failed requests, slow requests, error spans) and Navigation / Frustration (route changes, rage, dead and error clicks, refresh rage). Overlapping markers cluster into a count pill. Markers drawn hollow are approximate — the chunk they belong to has not been decoded yet — and turn solid as it loads.
- Hover for a preview of the time, the nearest route and the signals within two seconds; click a marker to seek one second before it and select it in the rail; drag to scrub; wheel to nudge by a second.

**Tabs.** A visitor with several tabs open records one recording per tab under one session. Pills in the header switch between them, keeping the playhead on the session clock ("Tab 2 · 30s · opened 2:14"); a tab with no stored footage is disabled and says so. When the tab you are watching ends while another has later footage, a **Continue in Tab 2** chip appears.

**Live sessions.** While a session is still recording the header shows a red **Live** pill and the player fetches new footage every 30 seconds without writing extra entries to the access log.

**Theater and links.** `F` or **Theater** goes fullscreen with the rail kept at the side; `Esc` leaves. **Link** (or `C`) copies a URL to the current moment, including the selected row and rail tab, so a teammate opens exactly what you are looking at. The URL parameters are `t` (seconds from the start), `at` (an absolute time in Unix milliseconds — what links from logs and exceptions use; it wins over `t`), `tab`, `rail`, `signal` and `q` (a rail search).

**Details** (`I`) opens a side panel with three tabs: **Session** (the facts, trace ids and exception groups observed, the session's tags and traits), **Privacy** (the masking mode, consent state and recorder version the session was captured under) and **Fidelity** (every notice about what the recording could not capture — a cross-origin stylesheet, a canvas, an iframe, a snapshot too large to store, recorder errors — with what each means for playback).

### The events rail

Beside the stage, the rail lists everything that happened, on the recording's clock, with a sticky "now" divider that follows the playhead. Click a row to seek one second before it; expand it for the detail. Each tab shows a count once it has been fetched — never a claimed zero.

| Tab | What it lists |
| --- | --- |
| **All** | Everything below, merged. |
| **Console** | `console.error` and `console.warn` output, with arguments serialised shallowly and masked. |
| **Network** | Every `fetch` and XHR: method, URL, status, duration, request and response bytes, initiator. When a backend trace for the request exists the row shows it inline: root span, service, duration, status, span count and any error logs on that trace. The recorder captures at most 500 requests per session. |
| **Nav** | Route changes, full page loads and back/forward-cache restores, with the page's LCP when it was measured. |
| **Interact** | Clicks with the element's selector and label, plus rage, dead and error clicks and refresh rage. Recordings made before click labels existed show coordinates only. |
| **Perf** | Web vitals (LCP, CLS, INP, FCP, TTFB with their ratings) and the performance-budget events that fired. |
| **Errors** | Client-side errors from the recording merged with server-side exceptions that carried the session id; a client error and a server exception with the same message within two seconds are cross-referenced, never collapsed. |
| **Logs** | Your backend logs that carried this session's id, from the Logs explorer. |
| **Traces** | Your backend traces that carried this session's id, one row per trace with a small waterfall in the detail. |

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
| `J` / `K` (rail focused) | Next / previous rail row |
| `Enter` (rail focused) | Seek to the selected rail row |
| `Escape` | Clear the selection, or close a modal |
| `F` | Theater mode |
| `W` | Wide layout |
| `M` | Follow the playhead in the rail |
| `/` | Search the rail |
| `C` | Copy a link to this moment |
| `I` | Session details |
| `?` | Shortcuts sheet |

## Recording health

The **recording health strip** on the sessions page and the **Recording health** card on the application's _Replay Policy_ page answer "is anything being recorded, and if not, why?" from the server's side. The diagnosis names one cause, quantifies it and offers one action; it never says "disconnected" without a reason. The states, in the order they are checked:

| State | What it means | What to do |
| --- | --- | --- |
| `disabled-project` | The project-wide master switch is off. | Turn it on under _RUM → Settings → Session Replay_. |
| `disabled-app` | Session replay is off for this application. | Turn it on under _Replay Policy_. |
| `budget-paused` | The application's monthly budget or the deployment's daily byte limit is spent; live recorders have been told to stop. | Raise the budget, or wait for the next day / month. |
| `refusing` | Uploads are arriving and being refused — the strip says the top reason and the count in the past 24 hours, for example `origin-not-allowed` (212 uploads from an origin that is not in your allowed origins) or `not-sampled`. | Follow the reason: edit the allowed origins, raise the sample percentage, and so on. |
| `never-loaded` | No browser has ever fetched this application's policy. The script tag is not on the page, or the identifier does not match. | The setup guide on the sessions page walks through it. |
| `loaded-never-uploaded` | The recorder fetched its policy recently but no chunk has ever arrived. The detail explains it from the policy: sampling is 0%, consent mode is _Require explicit_ and the page has not granted it, the trigger is _On error or frustration_ and nothing has fired — or, with a healthy policy, a CSP or ad blocker is refusing the ingest URL. | The action matches the cause. |
| `stale` | Recorders keep fetching the policy but no chunk has arrived for more than six hours. | Same causes as above, on a page that used to work: check what changed. |
| `healthy-quiet` | No chunk for more than six hours **and** no page has fetched the policy in the past 24 hours either, with nothing switched off, over budget or being refused. No recorder is running on this application right now — a low-traffic or staging app, or a snippet that is no longer on the page. The card quantifies both silences. | If your pages are being served, check that the script tag is still on them; otherwise nothing. |
| `healthy` | Chunks are arriving: the strip shows the last chunk's age, sessions today and the sample percentage. | Nothing. |
| `unknown` | The status endpoint could not be read. | Retry; check the permission error the card shows. |

The card also lists refusals and drops by reason, bytes used today and this month against their limits, the published recorder version and the capabilities of the newest recorder that reported. Counters that come from Redis read **unknown** — never 0 — when Redis is unreachable. Below it, a textarea takes the output of `getDiagnostics()` and explains every code in it.

## Performance capture triggers

Under the default _Always_ trigger every sampled session is uploaded, so these budgets change nothing about what is recorded — they only mark the events that exceeded them on the timeline and in the **Perf** tab. When the trigger is _On error or frustration_, they extend the trigger set to sessions that were merely *slow*. Set them on the _Replay Policy_ page (Performance & Tracing step):

| Budget | Fires when | Suggested starting point |
| --- | --- | --- |
| Largest Contentful Paint (ms) | The page's LCP exceeds the budget | 4000 — the boundary of a "poor" LCP |
| Long task (ms) | A single main-thread task blocks for at least the budget | 200+ — browsers only report tasks over 50 ms |
| Slow request (ms) | A `fetch`/XHR **succeeds** but takes at least the budget | Your API's timeout expectations |

Each budget is off at `0` (the default). Sessions captured this way appear with the trigger reason **performance** (_Slow_ in the list). Failed and cancelled requests are not counted here — a 5xx or a network failure already triggers via the error path.

Independently of the budgets, the recorder reports the Core Web Vitals of every page — LCP, CLS, INP, FCP and TTFB with their good / needs-improvement / poor rating — as **Perf** rows. Vitals never trigger an upload on their own.

## Recording a specific user's next session

When a named customer reports a problem you cannot reproduce, you can arm a one-shot target instead of waiting for an error: on the application's _Replay Policy_ page → **Record a specific user's next session**, enter the same end-user reference your page supplies and click **Record next session**. That user's next visit records from its first event, labelled with trigger reason **manual**.

Honest limits, so "armed" is not misread as "guaranteed":

- Your page must supply the reference **at load time** — the `data-oneuptime-user-ref` attribute or `userRef` on the init global — because the target is matched when the policy is fetched, before the recorder artifact exists. A reference set later via `identify()` is too late for that page load, though it still makes the session searchable by `user:`.
- Consent still applies. A targeted session in _Require explicit_ mode uploads nothing until your page grants consent.
- The target expires after 24 hours, is consumed by the first matching page load, and only a keyed hash of the reference is stored server-side.

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

## Retention and deletion

Recordings are kept for **7 days** by default; 1, 14, 30 and 90 days are also available per application. The expiry is computed from the **session's start**, not from when each chunk arrived, so a session expires as a whole rather than losing its later minutes first. The session list shows the expiry on each row ("expires in 6d").

Be aware that **the session row expires with its footage**: error counts, frustration signals, device facts and the rest of the metadata share the recording's retention and are gone when it is. The logs, spans and exceptions of that session follow the telemetry retention of the application instead and remain searchable by session id in their own explorers. Removal runs in the background, so for a short while after the expiry a session can still be listed while the player explains that its footage has expired; once the row is gone, a saved link answers "expired on ⟨date⟩ under the application's N-day retention".

### Erasing sessions

To satisfy a deletion request, file an erasure request through the OneUptime API — the `/rum-session-erasure-request` resource; there is no dashboard form for it yet. A request needs `CreateRumSessionErasureRequest` (or a project owner / admin) and takes:

| Field | Values |
| --- | --- |
| `requestType` | `BySessionId`, `ByIdentifiedUserKey`, `ByDateRange` or `ByRumApplication`. |
| `targetValue` | The session id, the end-user key as stored on the session (the one-way derivation of the reference — the raw reference is never accepted, by design), or the application id. Unused for a date range. |
| `startDate` / `endDate` | The window for `ByDateRange`. |
| `rumApplicationId` | The application the request applies to. |

Two honest limits on `ByIdentifiedUserKey`. The key is not shown anywhere in the dashboard: it comes back as `identifiedUserKey` on each row of the session list API (`POST /telemetry/rum/session-replay/list`), so today an erasure by user starts with a `user:` search there and a copy of that field. And a session recorded while **Capture user identity** was off has no key at all — nothing about the person was stored — so it can only be reached by session id, date range or application.

Each request records its `status` (`Pending`, `InProgress`, `Completed`, `Failed`), the `sessionsDeleted` and `chunksDeleted` counts and any `failureReason`; `ReadRumSessionErasureRequest` lets someone review them. Erasure removes the recording **and** the correlated logs, spans and exceptions for those sessions, and any recording still in flight when the request completes is dropped rather than written. A link to an erased session answers "erased" rather than "not found".

## Who can watch a recording

Watching a recording is a separate permission from listing sessions, and neither is granted by the project-wide Viewer role. Project owners and admins hold all of them.

| Permission | Unlocks |
| --- | --- |
| `ReadRumSessionReplay` | The session list and each session's metadata: counts, signals, device — but not the recording, and not who the user was. A support engineer can triage which sessions errored without playing anyone's screen back. |
| `ReadRumSessionReplayPayload` | Playing a recording back, and reading the identified user's reference and traits in the list, the player and the `user:` filter. |
| `ReadRumSessionReplayAudit` | The **Replay Access Log** — who watched what. |
| `DeleteRumSessionReplay` | Deleting recordings. |
| `CreateRumSessionErasureRequest` / `ReadRumSessionErasureRequest` | Filing and reviewing erasure requests. |

Label-based access applies: a member restricted to a set of labels can only reach applications carrying one of them, and the identity gate honours the same scope.

Every playback is recorded in an audit trail under _Real User Monitoring → your application → **Replay Access Log**_: who watched which session, when, from what IP address and user agent, for how long (reported in 15-second buckets while the player is actually playing, so "< 15s" means it was opened and closed), and the reason — the incident or exception the viewer arrived from, when there was one. Refreshing a live session does not add entries; each open of the player adds one.

## Troubleshooting

Under the default _Always_ trigger a working page posts a chunk about every 15 seconds **while the user is doing something**; an idle page posts nothing, so interact with it before deciding the install is broken. If you have set the capture trigger to _On error or frustration_, the recorder records into memory and uploads only when something goes wrong, so **a healthy page makes exactly one request to OneUptime per page load** — the config fetch — and posts nothing else until an error, a 5xx, a frustration signal or a performance budget breach happens. From a Network tab that is indistinguishable from an installation that does not work.

Two things tell you which one you are looking at. From the server's side, the **Recording health** strip above the session list and the card on the _Replay Policy_ page (see [Recording health](#recording-health)). From the browser's side, the recorder's own diagnostics:

```js
localStorage.setItem("oneuptime.sessionReplay.debug", "true");
// then reload the page
```

Every decision the recorder makes is then printed with a stable code, and

```js
OneUptimeReplay.getDiagnostics();
```

returns the last 250 of them together with the recorder's `state`, `decisions` and `capabilities` — **whether or not diagnostics were switched on when they happened**, so you do not have to reproduce the problem first. It carries no page content by construction, so it is safe to paste into a support ticket, and the health card has a box that explains it for you.

[Session Replay Troubleshooting](/docs/rum/session-replay-troubleshooting) explains every code and what to do about it, and the **Test your installation** panel on the _Replay Policy_ page answers the same question from the server's side.

## Self-hosted notes

- Session Replay is **on** at the deployment level by default. Set `SESSION_REPLAY_ENABLED_BY_DEFAULT=false` to turn it off for the whole instance — recorders already running on customer pages then stop recording, not just uploading.
- Set `SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY` to bound disk use. Replay is the largest table in the system, and an unbounded configuration can push ClickHouse into capacity pruning. When the limit is spent the health card reads "Uploads paused for today".
- Recordings are stored in ClickHouse. No object storage is required.
- `SESSION_REPLAY_DEBUG=true` makes every recorder this deployment serves print its decisions to the browser console. It is the one diagnostics switch that does not need somebody at the failing browser, so it is useful when a customer reports "nothing happens" on a page you cannot open a console on. It changes no policy — not sampling, not masking, not consent — but it logs on **every** page every recorder runs on, so turn it on, collect one reload, and turn it off.
