/*
 * App-wide capture of the `oneuptime://sso-callback` deep link.
 *
 * WHY THIS EXISTS
 *
 * `WebBrowser.openAuthSessionAsync` is not a reliable way to receive the SSO
 * callback on its own, and it fails differently on each platform:
 *
 * - ANDROID. `openAuthSessionAsync` is a JS polyfill that races two promises
 *   (expo-web-browser/build/WebBrowser.js): one resolves `success` from a
 *   `Linking` "url" event, the other resolves `dismiss` from an AppState
 *   change back to "active". The redirect out of Chrome Custom Tabs triggers
 *   BOTH. When the AppState side wins, a login that completed perfectly
 *   resolves as `dismiss` with no URL, and the tokens are dropped on the
 *   floor. It is a race, so it is intermittent - the worst kind of auth bug.
 *
 * - BOTH PLATFORMS. If the OS kills the app while the user is at the IdP
 *   (routine on Android under memory pressure), the promise dies with the
 *   process. The IdP still redirects, the app cold-starts on the callback URL,
 *   and nothing is listening.
 *
 * So the deep link is captured here, independently of whoever opened the
 * browser, and screens ask this module for the result instead of trusting the
 * promise alone. The listener is additive - expo-web-browser keeps its own,
 * and React Native delivers "url" to every subscriber.
 */

import * as Linking from "expo-linking";
import { isSsoCallbackUrl } from "./callbackUrl";

/*
 * Structural, so this module does not depend on which subscription class the
 * installed expo-linking happens to return.
 */
interface RemovableSubscription {
  remove: () => void;
}

let pendingCallbackUrl: string | null = null;
let subscription: RemovableSubscription | null = null;
let waiters: Array<(url: string) => void> = [];

/*
 * Resolves once `getInitialURL()` has been read. Kept at module scope and
 * never reset, so a launch URL cannot be lost to a listener being torn down
 * and re-registered (which React does on every StrictMode remount).
 */
let initialUrlSettled: Promise<void> | null = null;

function handleIncomingUrl(url: string | null | undefined): void {
  if (!isSsoCallbackUrl(url)) {
    return;
  }

  pendingCallbackUrl = url!;

  /*
   * Hand the URL to anyone already waiting and clear the pending slot in the
   * same breath, so it is delivered exactly once.
   */
  if (waiters.length > 0) {
    const toNotify: Array<(url: string) => void> = waiters;
    waiters = [];
    pendingCallbackUrl = null;

    for (const waiter of toNotify) {
      waiter(url!);
    }
  }
}

/**
 * Starts listening for SSO callback deep links. Safe to call more than once -
 * the second call is a no-op rather than a second subscription.
 *
 * Also drains `getInitialURL()`, which is how the callback arrives when the
 * app was killed mid-login and cold-started by the redirect.
 */
export function startSsoCallbackCapture(): void {
  if (subscription) {
    return;
  }

  subscription = Linking.addEventListener(
    "url",
    (event: { url: string }): void => {
      handleIncomingUrl(event.url);
    },
  );

  if (!initialUrlSettled) {
    initialUrlSettled = Linking.getInitialURL()
      .then((url: string | null): void => {
        handleIncomingUrl(url);
      })
      .catch((): void => {
        // A launch URL we cannot read is indistinguishable from no launch URL.
      });
  }
}

/**
 * Awaits the launch-URL read, then returns a captured callback if the app was
 * cold-started by one.
 *
 * `getInitialURL()` is asynchronous, so a synchronous
 * `consumePendingSsoCallbackUrl()` immediately after startup would usually run
 * before the URL had been read and miss it. Startup code must use this.
 */
export async function consumeInitialSsoCallbackUrl(): Promise<string | null> {
  startSsoCallbackCapture();

  if (initialUrlSettled) {
    await initialUrlSettled;
  }

  return consumePendingSsoCallbackUrl();
}

/** Tears the listener down. Exists for tests and for a full sign-out. */
export function stopSsoCallbackCapture(): void {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }

  waiters = [];
  pendingCallbackUrl = null;
}

/**
 * Test-only: forgets that the launch URL was ever read, so a suite can drive
 * the cold-start path more than once.
 */
export function resetSsoCallbackCaptureForTesting(): void {
  stopSsoCallbackCapture();
  initialUrlSettled = null;
}

/**
 * Returns the captured callback URL, if any, and clears it. A callback is
 * consumed exactly once - two screens cannot both act on the same login.
 */
export function consumePendingSsoCallbackUrl(): string | null {
  const url: string | null = pendingCallbackUrl;
  pendingCallbackUrl = null;
  return url;
}

/**
 * Drops any captured callback without acting on it. Called before opening a
 * new auth session so a stale URL from an earlier attempt cannot be mistaken
 * for the result of this one.
 */
export function clearPendingSsoCallbackUrl(): void {
  pendingCallbackUrl = null;
}

/*
 * How long to keep waiting for the "url" event after the auth session promise
 * has already resolved without one. This only runs on the Android
 * dismiss-race path; the event is normally already in hand, in which case the
 * wait returns synchronously on the next tick.
 */
export const SSO_CALLBACK_GRACE_MS: number = 1500;

/**
 * Resolves with a captured callback URL, or null if none arrives within
 * `timeoutMs`.
 *
 * Call this whenever the auth session resolves as anything other than an
 * outright success: on Android that result may be a `dismiss` that actually
 * was a successful login.
 */
export function waitForSsoCallbackUrl(
  timeoutMs: number = SSO_CALLBACK_GRACE_MS,
): Promise<string | null> {
  const alreadyPending: string | null = consumePendingSsoCallbackUrl();

  if (alreadyPending) {
    return Promise.resolve(alreadyPending);
  }

  return new Promise((resolve: (url: string | null) => void): void => {
    let settled: boolean = false;

    const waiter: (url: string) => void = (url: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(url);
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout((): void => {
      if (settled) {
        return;
      }
      settled = true;
      waiters = waiters.filter((candidate: (url: string) => void): boolean => {
        return candidate !== waiter;
      });
      resolve(null);
    }, timeoutMs);

    waiters.push(waiter);
  });
}
