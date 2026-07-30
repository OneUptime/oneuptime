# Session Replay

## Overview

Session Replay records what a real user saw in your web app and lets you play it back next to the error, trace and log data from the same session. It is built for debugging a failure, not for marketing analytics: by default the recorder holds a rolling buffer in memory and uploads **only when something actually goes wrong**.

That default matters. It means a recording almost always exists for the sessions you care about, while sessions where nothing went wrong are never uploaded at all — roughly 15x less data stored, and 15x less of your users' screens leaving their devices.

## Prerequisites

- A RUM application — create one from _Reliability → RUM → Applications_.
- A **Telemetry Ingestion Token** — _Project Settings → Telemetry Ingestion Keys_.
- Session Replay switched on for that application in _RUM → your app → Settings → Session Replay_. It is **off by default**.

## Install

Add one script tag. Replace the token and the application identifier with your own.

```html
<script
  src="https://oneuptime.com/telemetry/session-replay/v1/recorder.js"
  data-oneuptime-token="YOUR_TELEMETRY_INGESTION_TOKEN"
  data-oneuptime-app-identifier="storefront-web"
  crossorigin="anonymous"
  async
></script>
```

`data-oneuptime-app-identifier` must match the RUM application's identifier (the same value you use for `service.name`).

The script at `/v1/recorder.js` is a small loader. It fetches your application's policy, checks consent and Do Not Track, and only then loads the pinned recorder build. That indirection is deliberate: it means a masking change you make in the dashboard reaches live browsers, and a bad recorder release can be rolled back without waiting out a browser cache.

## Privacy

**Everything is masked at capture, in the browser, before anything is uploaded.** The server never receives unmasked content, so nothing here can be undone after the fact.

| Control | Default | What it does |
| --- | --- | --- |
| Session Replay enabled | **off** | Per-application switch. Nothing is recorded until you turn it on. |
| Masking mode | **Mask all text** | Every text node and input value becomes a placeholder. Playback shows layout and interaction, not readable content. |
| Consent mode | **Require explicit** | The recorder buffers but uploads nothing until you call `grantConsent()`. |
| Capture trigger | **On error or frustration** | Upload only when something goes wrong. |
| Sample percentage | **0%** | Additional random sampling on top of the trigger. |
| Allowed origins | **empty (refused)** | You must list the domains allowed to send recordings. |
| Capture user identity | **off** | When off, users are pseudonymous. |
| Capture country | **off** | Country only, never an IP address. |
| Record canvas | **off** | Canvas and WebGL are not recorded. |
| Retention | **7 days** | Shorter than other telemetry, on purpose. |

Always masked regardless of mode, and not configurable:

- **Passwords**, including after a "show password" toggle. Once a field has ever been a password field it stays masked, and the type change itself is suppressed.
- **Card fields**, detected via `autocomplete` (`cc-number`, `cc-csc`, `cc-exp`), because card inputs are `type="text"` and otherwise invisible to type-based masking.
- **One-time codes** (`autocomplete="one-time-code"`).
- **File input values** — the browser exposes the real filename, and filenames are routinely personal.
- **Query strings and fragments** are dropped from every recorded URL, and identifier-shaped path segments (UUIDs, emails, long digit runs, long opaque tokens) are replaced. This is the one channel text masking does not cover: a password-reset link would otherwise land in the session list.
- **Clipboard events** are never recorded.
- **Keystroke timing** is quantised, because inter-keystroke intervals leak typed content even when the value is masked.

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

You can also add CSS selectors under _Settings → Session Replay_ without changing your markup.

### Consent

```js
// After the user accepts. Nothing is uploaded before this.
window.OneUptimeReplay.grantConsent();

// Drops the in-memory buffer and stops recording.
window.OneUptimeReplay.revokeConsent();
```

`navigator.doNotTrack` and `navigator.globalPrivacyControl` are honoured before the recorder loads.

## Content Security Policy

**If your site sends a CSP, the recorder will fail silently until you allow it.** There is no error we can surface from your users' browsers, so this is the first thing to check when no recordings appear.

```
script-src  'self' https://oneuptime.com;
connect-src 'self' https://oneuptime.com;
```

If you self-host OneUptime, use your own host instead.

One more CSP-adjacent detail: for playback to render your styles, your stylesheets must be readable by the recorder. A cross-origin stylesheet without `crossorigin="anonymous"` cannot be read, and the session will play back unstyled with a notice explaining why.

Use the **Test your installation** panel in _Settings → Session Replay_ to confirm the token, the origin allowlist and the CSP all line up.

## Correlating with your other telemetry

Every recording carries a session id. If you use the OpenTelemetry browser SDK, attach it so your spans and logs join up:

```js
const sessionId = window.OneUptimeReplay.getSessionId();
// Add { "session.id": sessionId } to your span attributes or resource.
```

If you are not using OpenTelemetry, you still get correlation for free: the recorder wraps `fetch` and `XMLHttpRequest`, injects a `traceparent` header, and stamps the session id on outgoing requests.

Once correlated, an exception in the dashboard shows a **Watch what the user saw** card, and the player's network lane links each failing request to its backend span.

## What is not recorded

These are surfaced on the player rather than silently blank, so you always know what you are not seeing:

| Not captured | Why |
| --- | --- |
| Canvas / WebGL | Off by default. Opt in per application; it is expensive and can capture rendered user data. |
| Cross-origin iframes | Payment iframes stay black boxes. This is intentional. |
| Closed shadow roots | Not traversable, so not recorded rather than recorded unmasked. |
| Web fonts | Too large. Playback falls back to a system font stack. |
| `<video>` / `<audio>` | Rendered as a labelled placeholder. |
| Cross-origin stylesheets | Not readable without `crossorigin`; a banner explains it. |

## Retention and deletion

Recordings are kept for **7 days** by default; 1, 14, 30 and 90 days are also available per application. Session metadata (error counts, frustration signals, device) can be kept longer than the recording itself, so trends survive after the video is gone.

To satisfy a deletion request, use _Settings → Session Replay → Erasure Requests_. You can erase by session, by identified user, by date range, or for an entire application. Erasure removes the recording **and** the correlated logs, spans and exceptions for those sessions, and any recording still in flight when the request completes is dropped rather than written.

## Who can watch a recording

Watching a recording is a separate permission from listing sessions, and neither is granted by the project-wide Viewer role. A support engineer can be given `ReadRumSessionReplay` to triage which sessions errored without being able to play anyone's screen back; `ReadRumSessionReplayPayload` is required to actually watch.

Every playback is recorded in an audit trail — who watched which session, when, and for how long — visible under the **Audit** tab and on the player itself.

## Self-hosted notes

- Session Replay is off at the deployment level by default. Set `SESSION_REPLAY_ENABLED_BY_DEFAULT=true` to allow projects to enable it.
- Set `SESSION_REPLAY_MAX_BYTES_PER_PROJECT_PER_DAY` to bound disk use. Replay is the largest table in the system, and an unbounded configuration can push ClickHouse into capacity pruning.
- Recordings are stored in ClickHouse. No object storage is required.
