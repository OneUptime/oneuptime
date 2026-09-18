/*
 * Runs an IdP login in the system auth browser and reports what actually
 * happened - on iOS and on Android, which do not behave the same way.
 *
 * `WebBrowser.openAuthSessionAsync` alone is not enough to tell a completed
 * login from a cancelled one:
 *
 * - iOS runs a native ASWebAuthenticationSession and returns `success` (with
 *   the URL) or `cancel`. That part is dependable.
 * - Android has no such API, so expo-web-browser polyfills it by racing a
 *   `Linking` "url" event against an AppState return-to-foreground. The
 *   redirect fires both, so a login that succeeded resolves as `dismiss` with
 *   no URL whenever the AppState side wins the race.
 *
 * Treating `dismiss` as a cancellation - which is what every call site in this
 * app used to do - therefore throws away a real login, intermittently, on
 * Android only. So on any non-success result we give the deep-link capture in
 * ./deepLink a short grace period to produce the URL before concluding the
 * user backed out.
 */

import * as WebBrowser from "expo-web-browser";
import { SSO_CALLBACK_URL } from "./callbackUrl";
import {
  clearPendingSsoCallbackUrl,
  consumePendingSsoCallbackUrl,
  waitForSsoCallbackUrl,
} from "./deepLink";

export type SsoAuthSessionOutcome =
  | {
      /*
       * The IdP redirected back. The URL still has to be parsed - it may carry
       * an error rather than tokens.
       */
      status: "callback";
      url: string;
    }
  | {
      // The user backed out: closed the tab, pressed cancel, hit back.
      status: "cancelled";
    }
  | {
      status: "error";
      message: string;
    };

export interface OpenSsoAuthSessionOptions {
  // Overridable so tests do not have to wait out the real grace period.
  graceMs?: number;
}

/**
 * Opens `ssoUrl` in the auth browser and resolves once the flow ends.
 *
 * Never throws: a browser that refuses to open is reported as
 * `status: "error"` so the caller can show the user something.
 */
export async function openSsoAuthSession(
  ssoUrl: string,
  options: OpenSsoAuthSessionOptions = {},
): Promise<SsoAuthSessionOutcome> {
  /*
   * Drop anything captured earlier. Without this, a callback left over from an
   * abandoned attempt would be read as the result of this one.
   */
  clearPendingSsoCallbackUrl();

  try {
    await WebBrowser.warmUpAsync();
  } catch {
    // Warm-up is an optimisation on Android and a no-op on iOS; never fatal.
  }

  try {
    const result: WebBrowser.WebBrowserAuthSessionResult =
      await WebBrowser.openAuthSessionAsync(ssoUrl, SSO_CALLBACK_URL);

    if (result.type === "success" && result.url) {
      // Nothing left pending - this same URL is very likely also in the slot.
      clearPendingSsoCallbackUrl();

      return {
        status: "callback",
        url: result.url,
      };
    }

    /*
     * Anything else - `dismiss`, `cancel`, `locked`, or a `success` with no
     * URL - might still be a completed login on Android. Ask the deep-link
     * capture before calling it a cancellation.
     */
    const captured: string | null = await waitForSsoCallbackUrl(
      options.graceMs,
    );

    if (captured) {
      return {
        status: "callback",
        url: captured,
      };
    }

    return { status: "cancelled" };
  } catch {
    /*
     * openAuthSessionAsync throws when a session is already open, and when the
     * device has no browser able to handle the URL. Even then the redirect may
     * already have landed, so check the capture before reporting failure.
     */
    const captured: string | null = consumePendingSsoCallbackUrl();

    if (captured) {
      return {
        status: "callback",
        url: captured,
      };
    }

    return {
      status: "error",
      message: "Could not open the sign-in page. Please try again.",
    };
  } finally {
    try {
      await WebBrowser.coolDownAsync();
    } catch {
      // Same as warm-up: best-effort.
    }
  }
}
