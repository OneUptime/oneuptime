import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  PASSKEY_CALLBACK_URL,
  parsePasskeyCallback,
  PasskeyRequest,
} from "./request";

export type PasskeyAuthSessionOutcome =
  | { status: "callback"; url: string }
  | { status: "cancelled" };

/*
 * One attempt in the phone's own browser that ends on a deep link back to
 * this app: passkey sign-in (oneuptime://passkey) and setting up a passkey
 * when sign-in requires a second step (oneuptime://passkey-enrolment,
 * #9817). Only the attempt's own callback finishes it - `isOwnCallback`
 * says which - so an SSO callback, a cold-start link or a late callback from
 * an older attempt never does.
 */
export interface AppAuthSessionOptions {
  // The page to open, on the server's address.
  url: string;
  // Where the page sends the browser back to: this app's scheme and host.
  callbackUrl: string;
  // Whether a link is this attempt's callback. Never throws.
  isOwnCallback: (url: string) => boolean;
  signal: AbortSignal;
  graceMs?: number | undefined;
  // What a browser that could not be opened, or came back wrong, is told.
  failureMessage: string;
}

export async function openAppAuthSession(
  options: AppAuthSessionOptions,
): Promise<PasskeyAuthSessionOutcome> {
  const { signal }: AppAuthSessionOptions = options;
  const graceMs: number = options.graceMs ?? 1500;

  if (signal.aborted) {
    return { status: "cancelled" };
  }

  let captured: string | null = null;
  const wakeups: { callback: (() => void) | null; abort: (() => void) | null } =
    { callback: null, abort: null };
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const subscription: ReturnType<typeof Linking.addEventListener> =
    Linking.addEventListener("url", (event: { url: string }): void => {
      // Other deep links and callbacks from an older attempt cannot finish this one.
      if (options.isOwnCallback(event.url)) {
        captured = event.url;
        wakeups.callback?.();
      }
    });
  const aborted: Promise<PasskeyAuthSessionOutcome> = new Promise(
    (resolve: (value: PasskeyAuthSessionOutcome) => void): void => {
      wakeups.abort = (): void => {
        resolve({ status: "cancelled" });
      };
    },
  );
  const onAbort: () => void = (): void => {
    try {
      WebBrowser.dismissAuthSession();
    } catch {
      // Some Android browsers cannot be dismissed programmatically.
    }
    wakeups.abort?.();
    wakeups.callback?.();
  };
  signal.addEventListener("abort", onAbort);

  const browse: () => Promise<PasskeyAuthSessionOutcome> =
    async (): Promise<PasskeyAuthSessionOutcome> => {
      try {
        const result: WebBrowser.WebBrowserAuthSessionResult =
          await WebBrowser.openAuthSessionAsync(
            options.url,
            options.callbackUrl,
          );

        if (signal.aborted) {
          return { status: "cancelled" };
        }
        if (result.type === "success" && result.url) {
          // Parsing is repeated by the caller before any network call.
          if (!options.isOwnCallback(result.url)) {
            throw new Error("Not this attempt's callback");
          }
          return { status: "callback", url: result.url };
        }

        // Android may report dismiss before delivering the successful deep link.
        if (!captured) {
          await new Promise<void>((resolve: () => void): void => {
            wakeups.callback = resolve;
            graceTimer = setTimeout(resolve, graceMs);
          });
        }
        return !signal.aborted && captured
          ? { status: "callback", url: captured }
          : { status: "cancelled" };
      } catch {
        if (signal.aborted) {
          return { status: "cancelled" };
        }
        if (captured) {
          return { status: "callback", url: captured };
        }
        throw new Error(options.failureMessage);
      }
    };

  try {
    return await Promise.race([browse(), aborted]);
  } finally {
    subscription.remove();
    signal.removeEventListener("abort", onAbort);
    if (graceTimer !== undefined) {
      clearTimeout(graceTimer);
    }
    wakeups.callback?.();
  }
}

/** Capture only this attempt's callback; SSO and cold-start links stay isolated. */
export async function openPasskeyAuthSession(
  request: PasskeyRequest,
  signal: AbortSignal,
  graceMs: number = 1500,
): Promise<PasskeyAuthSessionOutcome> {
  return await openAppAuthSession({
    url: request.url,
    callbackUrl: PASSKEY_CALLBACK_URL,
    isOwnCallback: (url: string): boolean => {
      try {
        parsePasskeyCallback(url, request);
        return true;
      } catch {
        return false;
      }
    },
    signal: signal,
    graceMs: graceMs,
    failureMessage:
      "Could not open or complete passkey sign-in. Please try again.",
  });
}
