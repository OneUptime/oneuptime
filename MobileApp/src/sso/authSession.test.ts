/*
 * openSsoAuthSession - what the app is allowed to conclude from an auth
 * browser session.
 *
 * EVERY TEST IN THIS FILE RUNS TWICE: once under the "ios" Jest project and
 * once under "android", and every assertion has to hold in BOTH runs. That is
 * the whole point of this file. openSsoAuthSession deliberately does not
 * branch on Platform.OS - one code path has to survive two very different
 * browsers:
 *
 * - iOS runs a native ASWebAuthenticationSession, which reports `success` with
 *   the redirect URL, or `cancel`. Dependable.
 * - Android has no such API, so expo-web-browser polyfills it
 *   (node_modules/expo-web-browser/build/WebBrowser.js) by racing a `Linking`
 *   "url" event against an AppState return-to-foreground. The redirect out of
 *   Chrome Custom Tabs fires BOTH, so a login that completed perfectly
 *   resolves as `dismiss` with NO url whenever the AppState side wins.
 *
 * The fixtures below are therefore named for the browser that produces them,
 * but each one is asserted under both presets. Treating `dismiss` as a
 * cancellation is the bug this module exists to prevent: it throws away a real
 * Android login, intermittently, which is the worst kind of auth bug. Every
 * "the captured redirect wins" case below is guarding exactly that.
 *
 * The deep-link capture in ./deepLink is used for real here - only expo-linking
 * is faked - so these tests exercise the actual hand-off between the two
 * modules rather than a stub of it.
 */

import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { openSsoAuthSession, SsoAuthSessionOutcome } from "./authSession";
import { SSO_CALLBACK_URL } from "./callbackUrl";
import {
  consumePendingSsoCallbackUrl,
  resetSsoCallbackCaptureForTesting,
  startSsoCallbackCapture,
} from "./deepLink";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * expo-web-browser is a native module with no JS implementation off-device,
 * and it is the thing whose two platform behaviours are under test, so it is
 * faked wholesale.
 */
jest.mock("expo-web-browser", () => {
  return {
    __esModule: true,
    openAuthSessionAsync: jest.fn(),
    warmUpAsync: jest.fn(),
    coolDownAsync: jest.fn(),
  };
});

/*
 * expo-linking is faked one level lower down: ./deepLink itself is the real
 * module, and the test makes a redirect "arrive" by calling the listener
 * deepLink registered here.
 */
jest.mock("expo-linking", () => {
  return {
    __esModule: true,
    addEventListener: jest.fn(() => {
      return { remove: jest.fn() };
    }),
    getInitialURL: jest.fn(() => {
      return Promise.resolve(null);
    }),
  };
});

const SSO_URL: string =
  "https://oneuptime.com/api/global-sso/650b/login?mobile=true";

const CALLBACK_URL: string = `${SSO_CALLBACK_URL}?accessToken=access-1&refreshToken=refresh-1&refreshTokenExpiresAt=2026-09-01T00%3A00%3A00.000Z&globalSsoToken=global-1`;

const STALE_CALLBACK_URL: string = `${SSO_CALLBACK_URL}?accessToken=access-from-an-abandoned-attempt`;

/*
 * The real grace period is 1500ms. Everything here overrides it so the suite
 * does not spend a second and a half per cancellation.
 */
const GRACE_MS: number = 50;

// Comfortably inside the grace period, and comfortably outside it.
const WITHIN_GRACE_MS: number = 5;
const AFTER_GRACE_MS: number = 200;

type UrlEventHandler = (event: { url: string }) => void;

function openAuthSession(): jest.Mock {
  return WebBrowser.openAuthSessionAsync as unknown as jest.Mock;
}

function warmUp(): jest.Mock {
  return WebBrowser.warmUpAsync as unknown as jest.Mock;
}

function coolDown(): jest.Mock {
  return WebBrowser.coolDownAsync as unknown as jest.Mock;
}

/*
 * `{ type: "success" }` with no url, and `{ type: "opened" }`, are not shapes
 * the published types admit, but they are shapes the two platforms really do
 * hand back - which is precisely why they need covering.
 */
function authResult(
  type: string,
  url?: string,
): WebBrowser.WebBrowserAuthSessionResult {
  const result: Record<string, string> =
    url === undefined ? { type } : { type, url };

  return result as unknown as WebBrowser.WebBrowserAuthSessionResult;
}

/** Fires the app-wide `Linking` "url" event the redirect would fire. */
function emitCallbackUrl(url: string): void {
  const calls: Array<Array<unknown>> = (
    Linking.addEventListener as unknown as jest.Mock
  ).mock.calls;

  const handler: UrlEventHandler = calls[
    calls.length - 1
  ]![1] as UrlEventHandler;

  handler({ url });
}

let scheduledEmits: Array<Promise<void>> = [];

/*
 * Schedules a redirect for later and remembers the promise, so afterEach can
 * await it: a stray timer firing into a torn-down suite is how a green run
 * turns into an unexplained flake somewhere else.
 */
function emitCallbackUrlAfter(url: string, delayMs: number): void {
  scheduledEmits.push(
    new Promise((resolve: () => void): void => {
      setTimeout((): void => {
        emitCallbackUrl(url);
        resolve();
      }, delayMs);
    }),
  );
}

function errorOutcome(outcome: SsoAuthSessionOutcome): {
  status: "error";
  message: string;
} {
  expect(outcome.status).toBe("error");

  return outcome as { status: "error"; message: string };
}

beforeEach((): void => {
  resetSsoCallbackCaptureForTesting();
  scheduledEmits = [];

  warmUp().mockResolvedValue({});
  coolDown().mockResolvedValue({});
  openAuthSession().mockResolvedValue(authResult("cancel"));

  startSsoCallbackCapture();
});

afterEach(async (): Promise<void> => {
  await Promise.all(scheduledEmits);
  resetSsoCallbackCaptureForTesting();
});

describe("Opening the session", () => {
  test("hands the IdP URL to the browser unchanged", async (): Promise<void> => {
    await openSsoAuthSession(SSO_URL, { graceMs: GRACE_MS });

    expect(openAuthSession().mock.calls[0]![0]).toBe(SSO_URL);
  });

  test("always returns to oneuptime://sso-callback", async (): Promise<void> => {
    /*
     * Asserted as a literal as well as against the constant. This string is
     * half of a contract with the server, which appends the callback to the
     * IdP's redirect; renaming it on this side alone does not fail to compile,
     * it just means the browser never comes back to the app.
     */
    await openSsoAuthSession(SSO_URL, { graceMs: GRACE_MS });

    expect(openAuthSession().mock.calls[0]![1]).toBe(
      "oneuptime://sso-callback",
    );
    expect(openAuthSession().mock.calls[0]![1]).toBe(SSO_CALLBACK_URL);
  });

  test("warms the browser up before opening it, and cools it down after", async (): Promise<void> => {
    openAuthSession().mockResolvedValue(authResult("success", CALLBACK_URL));

    await openSsoAuthSession(SSO_URL, { graceMs: GRACE_MS });

    expect(warmUp()).toHaveBeenCalledTimes(1);
    expect(coolDown()).toHaveBeenCalledTimes(1);

    expect(warmUp().mock.invocationCallOrder[0]!).toBeLessThan(
      openAuthSession().mock.invocationCallOrder[0]!,
    );
    expect(coolDown().mock.invocationCallOrder[0]!).toBeGreaterThan(
      openAuthSession().mock.invocationCallOrder[0]!,
    );
  });

  test("cools the browser down even when the session throws", async (): Promise<void> => {
    /*
     * warmUpAsync binds to the Custom Tabs service on Android. Skipping the
     * cool-down on the failure path leaks that binding for the life of the
     * process.
     */
    openAuthSession().mockRejectedValue(
      new Error("WebBrowser is already open"),
    );

    await openSsoAuthSession(SSO_URL, { graceMs: GRACE_MS });

    expect(coolDown()).toHaveBeenCalledTimes(1);
  });

  test("a failing warm-up does not fail the login", async (): Promise<void> => {
    // Warm-up is an Android optimisation and a no-op on iOS: never fatal.
    warmUp().mockRejectedValue(new Error("no custom tabs service"));
    openAuthSession().mockResolvedValue(authResult("success", CALLBACK_URL));

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
    expect(openAuthSession()).toHaveBeenCalledTimes(1);
  });

  test("a failing cool-down does not fail the login", async (): Promise<void> => {
    /*
     * The cool-down runs in a `finally`, so an unguarded rejection there would
     * replace an already-computed successful outcome with a thrown error -
     * losing the tokens after the user had signed in.
     */
    coolDown().mockRejectedValue(new Error("nothing to cool down"));
    openAuthSession().mockResolvedValue(authResult("success", CALLBACK_URL));

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
  });
});

describe("A completed login", () => {
  test("iOS success-with-url is taken at face value", async (): Promise<void> => {
    /*
     * The dependable path: ASWebAuthenticationSession hands back the redirect
     * itself, so no deep-link capture is involved at all.
     */
    openAuthSession().mockResolvedValue(authResult("success", CALLBACK_URL));

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
  });

  test("a success leaves nothing pending for a second consumer", async (): Promise<void> => {
    /*
     * The redirect fires the app-wide listener as well, so after a native
     * success the same URL is usually sitting in the capture slot too. Left
     * there, the next screen to ask would sign the user in a second time off a
     * one-shot token.
     */
    openAuthSession().mockImplementation(async (): Promise<unknown> => {
      emitCallbackUrl(CALLBACK_URL);
      return authResult("success", CALLBACK_URL);
    });

    await openSsoAuthSession(SSO_URL, { graceMs: GRACE_MS });

    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("does not sit out the grace period when the browser answered", async (): Promise<void> => {
    /*
     * The grace period is a repair for the Android race, not a tax on every
     * login. A native success must return at once - a version that always
     * waited would add a real 1500ms stall to every sign-in on both platforms,
     * which no assertion about the returned value would catch.
     */
    openAuthSession().mockResolvedValue(authResult("success", CALLBACK_URL));

    const startedAt: number = Date.now();

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: 10000,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test("a success with NO url still counts when the redirect was captured", async (): Promise<void> => {
    /*
     * expo-web-browser's Android polyfill resolves `success` from the Linking
     * event, so it always carries a url there - but the published type allows
     * a bare `{ type }`, and a result with no url must never be read as a
     * callback to nowhere.
     */
    openAuthSession().mockImplementation(async (): Promise<unknown> => {
      emitCallbackUrl(CALLBACK_URL);
      return authResult("success");
    });

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
  });

  test("a success with NO url and nothing captured is a cancellation", async (): Promise<void> => {
    openAuthSession().mockResolvedValue(authResult("success"));

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "cancelled" });
  });
});

describe("The Android dismiss race", () => {
  test("a dismiss with no url is a callback when the redirect was captured", async (): Promise<void> => {
    /*
     * THE HEADLINE CASE. Chrome Custom Tabs redirects back to the app: the
     * Linking event and the AppState change both fire, AppState wins the race
     * inside expo-web-browser, and the promise resolves `{ type: "dismiss" }`
     * with no url - for a login that completed and issued tokens.
     *
     * This must NOT come back as cancelled. If it does, the user is dropped on
     * the sign-in screen with valid tokens in a URL nobody read, and it
     * happens only sometimes, only on Android.
     */
    openAuthSession().mockImplementation(async (): Promise<unknown> => {
      emitCallbackUrl(CALLBACK_URL);
      return authResult("dismiss");
    });

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
    expect(outcome.status).not.toBe("cancelled");
  });

  test("a redirect that lands after the promise resolved still counts", async (): Promise<void> => {
    /*
     * The other ordering of the same race: AppState resolves the promise
     * first and the "url" event arrives a few milliseconds later. The grace
     * period exists for exactly this, so the module has to be waiting rather
     * than answering immediately.
     */
    openAuthSession().mockImplementation(async (): Promise<unknown> => {
      emitCallbackUrlAfter(CALLBACK_URL, WITHIN_GRACE_MS);
      return authResult("dismiss");
    });

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
  });

  test.each(["cancel", "dismiss", "locked", "opened"])(
    "a result of %s with a captured redirect is a callback, not a cancellation",
    async (type: string): Promise<void> => {
      /*
       * Every non-success result type the two platforms can produce -
       * `cancel` and `dismiss` from iOS, `dismiss` and `opened` from the
       * Android polyfill, `locked` when iOS refuses to present the session -
       * goes through the same reconciliation. None of them is trusted over a
       * redirect that actually arrived.
       */
      openAuthSession().mockImplementation(async (): Promise<unknown> => {
        emitCallbackUrl(CALLBACK_URL);
        return authResult(type);
      });

      const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
        graceMs: GRACE_MS,
      });

      expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
    },
  );

  test("the reconciliation is one code path, not a platform branch", async (): Promise<void> => {
    /*
     * babel-preset-expo inlines Platform.OS from the preset, so this is the
     * literal "ios" in one project and "android" in the other. The expectation
     * below is identical in both runs - which is the invariant: a change that
     * made openSsoAuthSession platform-sensitive would fail exactly one of the
     * two projects.
     */
    expect(["ios", "android"]).toContain(Platform.OS);

    openAuthSession().mockImplementation(async (): Promise<unknown> => {
      emitCallbackUrl(CALLBACK_URL);
      return authResult("dismiss");
    });

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
  });
});

describe("A genuine cancellation", () => {
  test.each(["cancel", "dismiss", "locked", "opened"])(
    "a result of %s with nothing captured is a cancellation",
    async (type: string): Promise<void> => {
      /*
       * The flip side of the dismiss race: rescuing a dismissal must not mean
       * every backed-out login now looks like a success. `locked` and
       * `opened` are included because an unhandled result type must degrade to
       * "the user did not sign in", not throw.
       */
      openAuthSession().mockResolvedValue(authResult(type));

      const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
        graceMs: GRACE_MS,
      });

      expect(outcome).toEqual({ status: "cancelled" });
    },
  );

  test("a redirect arriving after the grace period does not rescue the session", async (): Promise<void> => {
    /*
     * The wait is bounded. A URL that turns up long afterwards belongs to
     * something else - a cold start, a second attempt - and the user has
     * already been told the login was cancelled.
     */
    openAuthSession().mockImplementation(async (): Promise<unknown> => {
      emitCallbackUrlAfter(CALLBACK_URL, AFTER_GRACE_MS);
      return authResult("dismiss");
    });

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "cancelled" });
  });

  test("the caller is never handed a callback without a url", async (): Promise<void> => {
    openAuthSession().mockResolvedValue(authResult("cancel"));

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome.status).toBe("cancelled");
    expect(outcome).not.toHaveProperty("url");
  });
});

describe("Stale callbacks from an earlier attempt", () => {
  test("a URL captured before the call is not read as this session's result", async (): Promise<void> => {
    /*
     * A user who starts a login, completes it while the app is backgrounded,
     * then starts another one, leaves a callback sitting in the capture slot.
     * Without the clear at the top of openSsoAuthSession, the SECOND session
     * would resolve instantly against the FIRST session's URL - signing the
     * user in with a token they abandoned, or with the wrong provider's.
     */
    emitCallbackUrl(STALE_CALLBACK_URL);
    openAuthSession().mockResolvedValue(authResult("cancel"));

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "cancelled" });
  });

  test("the stale URL is discarded rather than left pending", async (): Promise<void> => {
    emitCallbackUrl(STALE_CALLBACK_URL);
    openAuthSession().mockResolvedValue(authResult("cancel"));

    await openSsoAuthSession(SSO_URL, { graceMs: GRACE_MS });

    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("a fresh redirect during the session still wins over the stale one", async (): Promise<void> => {
    /*
     * Clearing the slot must not deafen the session to the redirect it is
     * actually waiting for.
     */
    emitCallbackUrl(STALE_CALLBACK_URL);

    openAuthSession().mockImplementation(async (): Promise<unknown> => {
      emitCallbackUrl(CALLBACK_URL);
      return authResult("dismiss");
    });

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
  });
});

describe("The browser refusing to open", () => {
  test("reports an error the user can act on, and does not throw", async (): Promise<void> => {
    /*
     * openAuthSessionAsync throws when a session is already open, and on a
     * device with no browser able to handle the URL. openSsoAuthSession is
     * documented as never throwing - a rejection here would reach a screen's
     * button handler as an unhandled rejection and leave a spinner up forever.
     */
    openAuthSession().mockRejectedValue(
      new Error("WebBrowser is already open"),
    );

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    const failure: { status: "error"; message: string } = errorOutcome(outcome);

    expect(failure.message.length).toBeGreaterThan(0);
    // The raw exception is developer text; the user gets something readable.
    expect(failure.message).not.toContain("WebBrowser is already open");
  });

  test("a throw is still a callback when the login had already completed", async (): Promise<void> => {
    /*
     * The "already open" throw usually means a previous session is still being
     * torn down - which happens right after a redirect. The tokens are in
     * hand; failing the login because the browser complained would discard
     * them.
     */
    openAuthSession().mockImplementation(async (): Promise<never> => {
      emitCallbackUrl(CALLBACK_URL);
      throw new Error("WebBrowser is already open");
    });

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    expect(outcome).toEqual({ status: "callback", url: CALLBACK_URL });
  });

  test("a throw does not resurrect a stale callback", async (): Promise<void> => {
    /*
     * The failure path consumes whatever is in the capture slot, so the clear
     * at the top of the function is what keeps an abandoned attempt from being
     * reported as this one's success.
     */
    emitCallbackUrl(STALE_CALLBACK_URL);
    openAuthSession().mockRejectedValue(new Error("no browser available"));

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    errorOutcome(outcome);
    expect(outcome).not.toHaveProperty("url");
    expect(consumePendingSsoCallbackUrl()).toBeNull();
  });

  test("a non-Error rejection is handled too", async (): Promise<void> => {
    // Native modules reject with plain strings often enough to matter.
    openAuthSession().mockRejectedValue("ERR_WEB_BROWSER_BLOCKED");

    const outcome: SsoAuthSessionOutcome = await openSsoAuthSession(SSO_URL, {
      graceMs: GRACE_MS,
    });

    const failure: { status: "error"; message: string } = errorOutcome(outcome);

    expect(typeof failure.message).toBe("string");
    expect(failure.message.length).toBeGreaterThan(0);
  });
});
