import * as Linking from "expo-linking";
import { Platform } from "react-native";
import {
  SSO_CALLBACK_GRACE_MS,
  clearPendingSsoCallbackUrl,
  consumeInitialSsoCallbackUrl,
  consumePendingSsoCallbackUrl,
  resetSsoCallbackCaptureForTesting,
  startSsoCallbackCapture,
  stopSsoCallbackCapture,
  waitForSsoCallbackUrl,
} from "./deepLink";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * This module is the safety net under `WebBrowser.openAuthSessionAsync`, and it
 * exists because that API loses successful logins in two different ways:
 *
 * - ANDROID: the redirect out of Chrome Custom Tabs fires both the Linking
 *   "url" event and an AppState change back to "active". expo-web-browser races
 *   them, so a completed login intermittently resolves as `dismiss` carrying no
 *   URL at all. The tokens are in the deep link that this module captured.
 *
 * - BOTH PLATFORMS: the OS can kill the app while the user is at the IdP. The
 *   redirect then cold-starts the process, the callback arrives as the launch
 *   URL, and the promise that was supposed to receive it died with the old
 *   process.
 *
 * Every assertion below therefore runs under BOTH Jest projects - "ios" and
 * "android" - and nothing here is gated on `Platform.OS`. A capture that only
 * worked on one platform would silently strand users on the other at a "login
 * failed" screen after a login that actually succeeded.
 */

jest.mock("expo-linking", () => {
  return {
    __esModule: true,
    addEventListener: jest.fn(),
    getInitialURL: jest.fn(),
  };
});

type UrlEventHandler = (event: { url: string }) => void;

// A realistic Global SSO callback: tokens plus the instance-wide SSO token.
const CALLBACK_URL: string =
  "oneuptime://sso-callback?accessToken=at-1&refreshToken=rt-1" +
  "&refreshTokenExpiresAt=2026-01-01T00%3A00%3A00.000Z&globalSsoToken=gst-1";

const SECOND_CALLBACK_URL: string =
  "oneuptime://sso-callback?accessToken=at-2&refreshToken=rt-2" +
  "&refreshTokenExpiresAt=2026-02-02T00%3A00%3A00.000Z&globalSsoToken=gst-2";

// What the same Linking stream carries when a push notification is tapped.
const INCIDENT_DEEP_LINK: string = "oneuptime://incident/project-1/incident-2";

let capturedHandlers: Array<UrlEventHandler> = [];
let removeSubscription: jest.Mock;

function addEventListenerMock(): jest.Mock {
  return Linking.addEventListener as unknown as jest.Mock;
}

function getInitialUrlMock(): jest.Mock {
  return Linking.getInitialURL as unknown as jest.Mock;
}

/** Fires a Linking "url" event at whatever this module last subscribed with. */
function emitUrlEvent(url: string): void {
  const handler: UrlEventHandler | undefined =
    capturedHandlers[capturedHandlers.length - 1];

  if (!handler) {
    throw new Error("No url listener is registered - capture was not started.");
  }

  handler({ url });
}

/*
 * Lets every already-queued promise callback run. Two ticks rather than one
 * because the module chains `.then().catch()` onto the launch-URL read.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  capturedHandlers = [];
  removeSubscription = jest.fn();

  addEventListenerMock().mockImplementation(
    (_event: string, handler: UrlEventHandler): { remove: () => void } => {
      capturedHandlers.push(handler);
      return { remove: removeSubscription };
    },
  );

  getInitialUrlMock().mockResolvedValue(null);

  // The module holds process-wide state; every test starts from a cold app.
  resetSsoCallbackCaptureForTesting();
});

describe("startSsoCallbackCapture", () => {
  test("subscribes to the app-wide url stream", () => {
    startSsoCallbackCapture();

    expect(addEventListenerMock()).toHaveBeenCalledTimes(1);
    expect(addEventListenerMock().mock.calls[0]![0]).toBe("url");
    expect(typeof addEventListenerMock().mock.calls[0]![1]).toBe("function");
  });

  test("subscribes exactly once however many times it is called", () => {
    /*
     * It is called from app startup AND from every screen that opens an auth
     * session. A second subscription would deliver each callback twice, and the
     * second delivery would look like a stale login to whoever consumed it.
     */
    startSsoCallbackCapture();
    startSsoCallbackCapture();
    startSsoCallbackCapture();

    expect(addEventListenerMock()).toHaveBeenCalledTimes(1);
    expect(getInitialUrlMock()).toHaveBeenCalledTimes(1);
  });

  test("reads the launch URL only once, even across a teardown and restart", async () => {
    /*
     * React re-mounts (StrictMode, navigator remounts) tear the listener down
     * and register it again. `getInitialURL()` keeps returning the launch URL
     * for the whole process lifetime, so re-reading it would re-deliver a
     * callback the app already signed in with - a second, duplicate login.
     */
    startSsoCallbackCapture();
    stopSsoCallbackCapture();
    startSsoCallbackCapture();

    await flushMicrotasks();

    expect(addEventListenerMock()).toHaveBeenCalledTimes(2);
    expect(getInitialUrlMock()).toHaveBeenCalledTimes(1);
  });
});

describe("capturing a url event", () => {
  beforeEach(() => {
    startSsoCallbackCapture();
  });

  test("captures an SSO callback and hands it to the caller", () => {
    emitUrlEvent(CALLBACK_URL);

    expect(consumePendingSsoCallbackUrl()).toBe(CALLBACK_URL);
  });

  test("delivers a captured callback exactly once", () => {
    /*
     * Two screens can be asking at the same time - the auth-session promise on
     * one side, a cold-start check on the other. Both acting on the same login
     * means the tokens get exchanged twice.
     */
    emitUrlEvent(CALLBACK_URL);

    expect(consumePendingSsoCallbackUrl()).toBe(CALLBACK_URL);
    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("ignores an unrelated deep link", () => {
    /*
     * The same "url" stream carries push-notification deep links. Treating one
     * as a callback would hand the SSO code a URL with no tokens in it.
     */
    emitUrlEvent(INCIDENT_DEEP_LINK);

    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("ignores a host that merely starts with sso-callback", () => {
    emitUrlEvent("oneuptime://sso-callback-other?accessToken=at-1");

    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("an unrelated deep link does not discard an already captured callback", () => {
    /*
     * A push notification arriving in the same second as the redirect must not
     * wipe the login result out from under the screen waiting on it.
     */
    emitUrlEvent(CALLBACK_URL);
    emitUrlEvent(INCIDENT_DEEP_LINK);

    expect(consumePendingSsoCallbackUrl()).toBe(CALLBACK_URL);
  });

  test("a newer callback supersedes an unconsumed older one", () => {
    /*
     * If the user backed out and logged in again, the second result is the live
     * one; the first belongs to an attempt nobody is waiting on any more.
     */
    emitUrlEvent(CALLBACK_URL);
    emitUrlEvent(SECOND_CALLBACK_URL);

    expect(consumePendingSsoCallbackUrl()).toBe(SECOND_CALLBACK_URL);
    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("accepts the trailing-slash form of the callback host", () => {
    emitUrlEvent("oneuptime://sso-callback/?error=access_denied");

    expect(consumePendingSsoCallbackUrl()).toBe(
      "oneuptime://sso-callback/?error=access_denied",
    );
  });

  test("clearPendingSsoCallbackUrl drops a captured URL", () => {
    /*
     * Called just before opening a new auth session: a leftover URL from an
     * earlier attempt would otherwise be read as the result of this one.
     */
    emitUrlEvent(CALLBACK_URL);
    clearPendingSsoCallbackUrl();

    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("clearPendingSsoCallbackUrl is harmless when nothing is pending", () => {
    expect((): void => {
      return clearPendingSsoCallbackUrl();
    }).not.toThrow();
    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });
});

describe("consumeInitialSsoCallbackUrl (the cold-start path)", () => {
  test("returns the launch URL, waiting for the asynchronous read", async () => {
    /*
     * THE POINT OF THIS FUNCTION. `getInitialURL()` is a promise, so startup
     * code that read the pending slot synchronously would run before the launch
     * URL had been read and conclude there was no callback - which is exactly
     * how an OS-killed login gets lost. The read here is deliberately still
     * unresolved when `consumeInitialSsoCallbackUrl()` is called.
     */
    let resolveInitialUrl: (url: string | null) => void = (): void => {
      return undefined;
    };

    getInitialUrlMock().mockImplementation((): Promise<string | null> => {
      return new Promise((resolve: (url: string | null) => void): void => {
        resolveInitialUrl = resolve;
      });
    });

    startSsoCallbackCapture();

    // A synchronous read at this instant sees nothing - and that is correct.
    expect(consumePendingSsoCallbackUrl()).toBeNull();

    const cold: Promise<string | null> = consumeInitialSsoCallbackUrl();

    await flushMicrotasks();
    resolveInitialUrl(CALLBACK_URL);

    await expect(cold).resolves.toBe(CALLBACK_URL);
  });

  test("returns a launch URL that only settles on a later timer tick", async () => {
    /*
     * The same guarantee against a read that resolves a whole macrotask later,
     * so passing cannot depend on how many microtasks happen to be queued.
     */
    getInitialUrlMock().mockImplementation((): Promise<string | null> => {
      return new Promise((resolve: (url: string | null) => void): void => {
        setTimeout((): void => {
          resolve(CALLBACK_URL);
        }, 25);
      });
    });

    startSsoCallbackCapture();

    await flushMicrotasks();
    expect(consumePendingSsoCallbackUrl()).toBeNull();

    await expect(consumeInitialSsoCallbackUrl()).resolves.toBe(CALLBACK_URL);
  });

  test("starts the capture itself, so later events are still heard", async () => {
    /*
     * Startup calls this before anything else; if it did not subscribe, a
     * callback arriving a moment after launch would hit no listener.
     */
    await expect(consumeInitialSsoCallbackUrl()).resolves.toBeNull();

    expect(addEventListenerMock()).toHaveBeenCalledTimes(1);

    emitUrlEvent(CALLBACK_URL);

    expect(consumePendingSsoCallbackUrl()).toBe(CALLBACK_URL);
  });

  test("resolves null when there was no launch URL", async () => {
    getInitialUrlMock().mockResolvedValue(null);

    await expect(consumeInitialSsoCallbackUrl()).resolves.toBeNull();
  });

  test("resolves null when the app was launched by an unrelated deep link", async () => {
    getInitialUrlMock().mockResolvedValue(INCIDENT_DEEP_LINK);

    await expect(consumeInitialSsoCallbackUrl()).resolves.toBeNull();
  });

  test("resolves null instead of throwing when the launch-URL read rejects", async () => {
    /*
     * A launch URL we cannot read is indistinguishable from no launch URL. An
     * escaping rejection here would happen during app startup, before any error
     * boundary exists.
     */
    getInitialUrlMock().mockRejectedValue(new Error("Linking unavailable"));

    await expect(consumeInitialSsoCallbackUrl()).resolves.toBeNull();
  });

  test("a rejected launch-URL read does not stop later events being captured", async () => {
    getInitialUrlMock().mockRejectedValue(new Error("Linking unavailable"));

    await expect(consumeInitialSsoCallbackUrl()).resolves.toBeNull();

    emitUrlEvent(CALLBACK_URL);

    expect(consumePendingSsoCallbackUrl()).toBe(CALLBACK_URL);
  });

  test("delivers the cold-start callback exactly once", async () => {
    getInitialUrlMock().mockResolvedValue(CALLBACK_URL);

    await expect(consumeInitialSsoCallbackUrl()).resolves.toBe(CALLBACK_URL);
    await expect(consumeInitialSsoCallbackUrl()).resolves.toBeNull();
  });

  test("a url event arriving before the launch read settles is not clobbered", async () => {
    /*
     * Warm start: the event fires first and `getInitialURL()` then resolves
     * null a tick later. That null must not erase the real callback.
     */
    let resolveInitialUrl: (url: string | null) => void = (): void => {
      return undefined;
    };

    getInitialUrlMock().mockImplementation((): Promise<string | null> => {
      return new Promise((resolve: (url: string | null) => void): void => {
        resolveInitialUrl = resolve;
      });
    });

    startSsoCallbackCapture();
    emitUrlEvent(CALLBACK_URL);

    resolveInitialUrl(null);

    await expect(consumeInitialSsoCallbackUrl()).resolves.toBe(CALLBACK_URL);
  });
});

describe("waitForSsoCallbackUrl", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    startSsoCallbackCapture();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("resolves straight away with an already-pending URL", async () => {
    /*
     * The normal case on both platforms: the event landed while the browser was
     * closing, so the answer is already in hand and no grace period is needed.
     */
    emitUrlEvent(CALLBACK_URL);

    await expect(waitForSsoCallbackUrl(SSO_CALLBACK_GRACE_MS)).resolves.toBe(
      CALLBACK_URL,
    );
  });

  test("consumes the pending URL it returns", async () => {
    emitUrlEvent(CALLBACK_URL);

    await expect(waitForSsoCallbackUrl(SSO_CALLBACK_GRACE_MS)).resolves.toBe(
      CALLBACK_URL,
    );

    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("resolves with a URL that arrives after the wait began", async () => {
    /*
     * THE ANDROID DISMISS RACE. `openAuthSessionAsync` has already resolved
     * `dismiss` with no URL, the caller is now sitting in this grace window,
     * and the "url" event lands a moment later carrying the tokens of a login
     * that actually succeeded. Without this the user sees "login cancelled".
     */
    const observed: { value?: string | null } = {};

    const waited: Promise<string | null> = waitForSsoCallbackUrl(1500).then(
      (url: string | null): string | null => {
        observed.value = url;
        return url;
      },
    );

    await flushMicrotasks();
    expect(observed.value).toBeUndefined();

    jest.advanceTimersByTime(1200);
    await flushMicrotasks();
    expect(observed.value).toBeUndefined();

    emitUrlEvent(CALLBACK_URL);

    await expect(waited).resolves.toBe(CALLBACK_URL);
  });

  test("a URL handed to a waiter is not also left pending", async () => {
    /*
     * Delivered exactly once: if it stayed in the pending slot as well, the
     * next auth session would open on top of a stale success.
     */
    const waited: Promise<string | null> = waitForSsoCallbackUrl(1500);

    emitUrlEvent(CALLBACK_URL);

    await expect(waited).resolves.toBe(CALLBACK_URL);
    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("resolves null once the grace period expires with nothing arriving", async () => {
    /*
     * A genuinely cancelled login. The wait has to end - a promise that never
     * settles leaves the login button spinning forever.
     */
    const observed: { value?: string | null } = {};

    const waited: Promise<string | null> = waitForSsoCallbackUrl(1500).then(
      (url: string | null): string | null => {
        observed.value = url;
        return url;
      },
    );

    jest.advanceTimersByTime(1499);
    await flushMicrotasks();
    expect(observed.value).toBeUndefined();

    jest.advanceTimersByTime(1);

    await expect(waited).resolves.toBeNull();
  });

  test("waits SSO_CALLBACK_GRACE_MS by default", async () => {
    const observed: { value?: string | null } = {};

    const waited: Promise<string | null> = waitForSsoCallbackUrl().then(
      (url: string | null): string | null => {
        observed.value = url;
        return url;
      },
    );

    jest.advanceTimersByTime(SSO_CALLBACK_GRACE_MS - 1);
    await flushMicrotasks();
    expect(observed.value).toBeUndefined();

    jest.advanceTimersByTime(1);

    await expect(waited).resolves.toBeNull();
  });

  test("does not leak the waiter once it has timed out", async () => {
    /*
     * A timed-out waiter left in the list would swallow the NEXT callback:
     * delivery clears the pending slot for whoever is waiting, and this dead
     * waiter would take it and drop it on the floor. So the late URL must end
     * up pending, not consumed by a ghost.
     */
    await expect(waitForSsoCallbackUrlAfterTimeout(1500)).resolves.toBeNull();

    expect((): void => {
      return emitUrlEvent(CALLBACK_URL);
    }).not.toThrow();

    expect(consumePendingSsoCallbackUrl()).toBe(CALLBACK_URL);
  });

  test("a fresh waiter after a timeout still receives its URL", async () => {
    await expect(waitForSsoCallbackUrlAfterTimeout(1500)).resolves.toBeNull();

    const waited: Promise<string | null> = waitForSsoCallbackUrl(1500);

    emitUrlEvent(CALLBACK_URL);

    await expect(waited).resolves.toBe(CALLBACK_URL);
  });

  test("two concurrent waiters both receive the URL", async () => {
    /*
     * The auth-session grace wait and a screen re-checking on focus can both be
     * waiting on the same login. Neither may be starved by the other.
     */
    const first: Promise<string | null> = waitForSsoCallbackUrl(1500);
    const second: Promise<string | null> = waitForSsoCallbackUrl(1500);

    emitUrlEvent(CALLBACK_URL);

    await expect(Promise.all([first, second])).resolves.toEqual([
      CALLBACK_URL,
      CALLBACK_URL,
    ]);
  });

  test("an unrelated deep link does not end the wait early", async () => {
    const observed: { value?: string | null } = {};

    const waited: Promise<string | null> = waitForSsoCallbackUrl(1500).then(
      (url: string | null): string | null => {
        observed.value = url;
        return url;
      },
    );

    emitUrlEvent(INCIDENT_DEEP_LINK);
    await flushMicrotasks();
    expect(observed.value).toBeUndefined();

    emitUrlEvent(CALLBACK_URL);

    await expect(waited).resolves.toBe(CALLBACK_URL);
  });
});

/** Runs a wait all the way to its timeout under fake timers. */
async function waitForSsoCallbackUrlAfterTimeout(
  timeoutMs: number,
): Promise<string | null> {
  const waited: Promise<string | null> = waitForSsoCallbackUrl(timeoutMs);

  await flushMicrotasks();
  jest.advanceTimersByTime(timeoutMs);

  return waited;
}

describe("stopSsoCallbackCapture", () => {
  test("removes the subscription", () => {
    startSsoCallbackCapture();
    stopSsoCallbackCapture();

    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });

  test("clears any captured callback", () => {
    /*
     * Called on sign-out. A callback surviving it would sign the next user in
     * as the previous one.
     */
    startSsoCallbackCapture();
    emitUrlEvent(CALLBACK_URL);

    stopSsoCallbackCapture();

    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("is harmless when capture was never started", () => {
    expect((): void => {
      return stopSsoCallbackCapture();
    }).not.toThrow();

    expect(removeSubscription).not.toHaveBeenCalled();
  });

  test("does not remove the subscription twice", () => {
    startSsoCallbackCapture();
    stopSsoCallbackCapture();
    stopSsoCallbackCapture();

    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });

  test("a restart subscribes again, so events are heard once more", () => {
    startSsoCallbackCapture();
    stopSsoCallbackCapture();
    startSsoCallbackCapture();

    expect(addEventListenerMock()).toHaveBeenCalledTimes(2);

    emitUrlEvent(CALLBACK_URL);

    expect(consumePendingSsoCallbackUrl()).toBe(CALLBACK_URL);
  });

  test("an in-flight wait still settles rather than hanging", async () => {
    /*
     * Stopping drops the waiter list. The timeout is what guarantees the caller
     * is not left awaiting a promise nobody can resolve any more.
     */
    jest.useFakeTimers();

    try {
      startSsoCallbackCapture();

      const waited: Promise<string | null> = waitForSsoCallbackUrl(1500);

      stopSsoCallbackCapture();

      await flushMicrotasks();
      jest.advanceTimersByTime(1500);

      await expect(waited).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe(`the capture behaves identically on ${Platform.OS}`, () => {
  /*
   * This suite name is the only thing in the file that mentions the platform,
   * and it is there so the two Jest projects are visibly running the same
   * end-to-end path. Nothing below branches on Platform.OS, because the module
   * does not either: the Android dismiss race is the reason the grace wait
   * exists, but an iOS ASWebAuthenticationSession that is dismissed at the
   * wrong moment needs exactly the same net.
   */
  test("captures a callback, hands it to a waiter, and forgets it", async () => {
    startSsoCallbackCapture();

    const waited: Promise<string | null> = waitForSsoCallbackUrl(50);

    emitUrlEvent(CALLBACK_URL);

    await expect(waited).resolves.toBe(CALLBACK_URL);
    expect(consumePendingSsoCallbackUrl()).toBeNull();

    stopSsoCallbackCapture();

    expect(removeSubscription).toHaveBeenCalledTimes(1);
  });
});
