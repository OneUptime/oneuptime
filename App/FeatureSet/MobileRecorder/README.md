# `@oneuptime/react-native-replay`

Privacy-first session replay for React Native. The SDK samples the native view
hierarchy into synthetic rrweb events and sends them through OneUptime's normal
session-replay ingest pipeline. It records layout, tightly allowlisted visual
styles, navigation, touches, custom events, and JavaScript errors without
capturing screenshots or readable native text.

## Requirements

- React Native 0.73 or newer.
- `@react-native-async-storage/async-storage` installed in the application.
- A OneUptime RUM application with session replay enabled.
- The Android application ID or iOS bundle ID added to that application's
  replay origin allowlist as `app://com.example.yourapp`.

This package contains native modules. **Expo Go is not supported.** Expo apps
must use a development build or EAS build after prebuild. Bare iOS apps must
run `pod install` (or `npx pod-install`) after installation. Android and iOS
modules autolink on supported React Native versions.

```sh
npm install @oneuptime/react-native-replay \
  @react-native-async-storage/async-storage
npx pod-install
```

## Start recording

Wrap the application root so the SDK can register one non-collapsable native
root and observe bubbling touch events. The provider can start the default
client for you:

```tsx
import {
  OneUptimeReplayProvider,
  ReplayMask,
} from "@oneuptime/react-native-replay";

export default function App() {
  return (
    <OneUptimeReplayProvider
      options={{
        host: "https://oneuptime.example.com",
        token: "YOUR_TELEMETRY_INGESTION_KEY",
        appIdentifier: "YOUR_RUM_APPLICATION_IDENTIFIER",
        mobileAppIdentifier: "com.example.checkout",
        userRef: "support-user-42", // optional record-next-session target
      }}
    >
      <RootNavigator />
    </OneUptimeReplayProvider>
  );
}
```

`mobileAppIdentifier` is the installed binary's Android `applicationId` or
iOS bundle identifier. It is canonicalized to lowercase and must contain at
least two reverse-DNS labels. `appIdentifier` is the OneUptime RUM application
identifier; the two identifiers are intentionally different.

For manual lifecycle control, omit `options` from the provider and use the
singleton:

```ts
import OneUptimeReplay from "@oneuptime/react-native-replay";

await OneUptimeReplay.start({
  host: "https://oneuptime.example.com",
  token: "YOUR_TELEMETRY_INGESTION_KEY",
  appIdentifier: "YOUR_RUM_APPLICATION_IDENTIFIER",
  mobileAppIdentifier: "com.example.checkout",
  appName: "Checkout",       // optional metadata override
  appVersion: "2.4.1",       // optional metadata override
  userRef: "support-user-42", // optional targeting reference
});

await OneUptimeReplay.stop();
```

`host` must be an HTTP(S) origin, not a URL with credentials, a path, query,
or fragment. The SDK fetches policy before capturing and fails closed if the
policy request or native bridge is unavailable.

## Privacy model

Mobile replay is deliberately stricter than web replay:

- `<Text>` content and `<TextInput>` values are never read by native code and
  never appear in an event, regardless of the web masking policy.
- `<ReplayMask>` is a hard traversal boundary. The wrapper's frame becomes one
  opaque placeholder and no descendant is visited.
- Images, WebViews, Skia, Metal/OpenGL, Canvas, SurfaceView, and TextureView
  content is opaque. Only the containing frame is recorded.
- Native output is allowlisted to parent-relative geometry, canonical hex
  background/border colors, bounded border width/radius, opacity, and z-order.
  Accessibility content, arbitrary props, pixels, and developer test IDs are
  not serialized.
- Error messages and stacks can quote user input, so v1 records the JavaScript
  error type only when it is a built-in safe name and a fixed `[masked]`
  marker, never a custom name, original message, or stack.

Use `ReplayMask` for any subtree whose mere shape or presence should not be
recorded:

```tsx
<ReplayMask>
  <PaymentCard />
</ReplayMask>
```

## Consent

When policy requires explicit consent, capture stays only in the bounded
in-memory pre-roll until the host grants consent. Nothing is persisted or sent
before that call.

The first policy request is always anonymous. `grantConsent()` always refreshes
the current policy before anything is persisted or sent. If `userRef` is
supplied, the SDK only includes it in a targeting refresh after the anonymous
policy says consent is not required, or during that post-consent refresh. A
failed or disabled fresh policy stops recording rather than falling back to the
older anonymous policy.

```ts
await OneUptimeReplay.grantConsent();
await OneUptimeReplay.revokeConsent();
```

Revocation stops capture and clears the in-memory buffer, session identifier,
anonymous visitor identifier, and AsyncStorage outbox. A later grant starts a
new visit.

## Identity, tags, events, and routes

```ts
OneUptimeReplay.identify("support-user-42", {
  plan: "enterprise",
  role: "admin",
});

OneUptimeReplay.setTags({ build: "2026.09.13", experiment: "checkout-b" });
OneUptimeReplay.addTag("region", "eu-west");
OneUptimeReplay.track("checkout_opened", { cartSize: 3 });

// Call from the navigation container's state-change callback.
await OneUptimeReplay.setRoute("/checkout?payment_token=discarded");
```

Calling `identify()` before `start()` preserves that reference for the
consent-safe targeting refresh. A non-empty `userRef` passed to `start()` takes
precedence over an earlier pre-start `identify()` call. Changing or clearing
the normalized reference while recording seals the previous user's replay and
starts a new session before applying the new identity. The SDK immediately
revalidates targeting for the new reference; a target or manual trigger from
the old user never carries into the new session.

Identity and traits are sent only when the RUM application's policy enables
user-identity capture. Under mobile's mandatory `MaskAllText`, trait values,
custom-event property values, and manual-capture reasons use the same coarse
text masks as the browser recorder. Event names and the explicitly supplied
user reference stay readable. Tag values deliberately stay readable and
searchable, matching the browser contract; do not use tags for secrets. All
maps remain count/length bounded. Routes always drop query strings and
fragments and are stored as `app://com.example.checkout/checkout`. The
remaining path stays readable, so pass stable screen templates rather than
account names, order numbers, or other sensitive path values.

## Manual and error capture

```ts
await OneUptimeReplay.captureSession("support-request");

try {
  await submitOrder();
} catch (error) {
  await OneUptimeReplay.captureError(error);
  throw error;
}
```

React Native's existing global JavaScript error handler is chained only when
it can be safely restored. The SDK never takes ownership of an application
handler it cannot restore. In error-triggered mode a bounded 60-second/2 MiB
pre-roll is uploaded after a manual or JavaScript error trigger.

## Diagnostics

```ts
const diagnostics = OneUptimeReplay.getDiagnostics();
// status, sessionId, sampled, triggered, consentState, pendingEvents, events
```

Diagnostics contain recorder decisions and fixed reason codes, not view text.
Pass `debug: true` at startup to mirror those codes to the development console.

Use the current consented session ID to correlate the application's own traces
and logs with replay. The listener fires immediately when a session exists,
again on every rotation, and with `null` when capture stops or consent is
withdrawn:

```ts
const unsubscribe = OneUptimeReplay.onSessionChange((sessionId) => {
  updateOpenTelemetryResource({ "session.id": sessionId });
});

const sessionId = OneUptimeReplay.getSessionId();
unsubscribe();
```

For independent clients or tests, instantiate `new MobileReplayRecorder()` and
pass it to `<OneUptimeReplayProvider recorder={client}>`.

## Durability and lifecycle

The SDK takes a view-tree sample every 500 ms, creates a full checkout at
least every 60 seconds, and closes a chunk at 15 seconds or 256 KiB. Chunks are
gzip-compressed with `fflate.gzipSync`. Each chunk is placed in an ordered,
bounded AsyncStorage outbox before POST and removed only after a terminal
server response. AppState backgrounding records visibility, closes the current
chunk, drains the outbox only when policy and consent permit uploading, and
pauses sampling; foregrounding resumes with a fresh full snapshot.

Policy is revalidated without HTTP-cache reuse before every foreground resume,
after identity changes, and at five-minute intervals while the app remains
active. An explicit disable takes effect before more capture; a transient
network failure outside the consent transition keeps the last valid policy and
retries on the next bounded refresh cadence. Consent grants always fail closed
when a fresh policy cannot be obtained.

The SDK never sets a browser `Origin` header. It sends
`x-oneuptime-replay-recorder-kind: rn-view-tree` and the mobile app identifier;
the server validates the identifier and synthesizes its exact `app://` origin.

## Fidelity limitations

- Reanimated/UI-thread animations are sampled, not frame-accurate.
- Image pixels, WebView content, Skia, Metal/OpenGL, and other drawing surfaces
  replay as disclosed opaque rectangles.
- JavaScript errors are captured reliably. Hard native crashes may terminate
  the process before JavaScript can close or upload a chunk and are not a
  reliable session-replay trigger.
- Mobile operating systems may suspend networking immediately after an app
  enters the background. Unacknowledged chunks remain in AsyncStorage for the
  next launch.
- This is a wireframe replay, not a screenshot or video recording.
- Touches beginning in a `ReplayMask`, image, WebView, Skia/canvas, or other
  opaque surface are discarded for the entire pointer sequence. If a gesture
  crosses into one later, that touch and the remainder of its pointer sequence
  are discarded. If current native target ancestry or the coordinate basis
  cannot be verified, touch telemetry fails closed and is discarded.

## Package development

```sh
npm run compile
npm test
npm run build
npm pack --dry-run
```

`prepack` and `prepublishOnly` both build ESM, CommonJS, source maps, and TypeScript
declarations. The published package contains those artifacts plus Android and
iOS native sources, the podspec, autolinking configuration, and this README.
