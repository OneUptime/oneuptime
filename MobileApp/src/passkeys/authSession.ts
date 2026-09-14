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

/** Capture only this attempt's callback; SSO and cold-start links stay isolated. */
export async function openPasskeyAuthSession(
  request: PasskeyRequest,
  signal: AbortSignal,
  graceMs: number = 1500,
): Promise<PasskeyAuthSessionOutcome> {
  if (signal.aborted) {
    return { status: "cancelled" };
  }

  let captured: string | null = null;
  const wakeups: { callback: (() => void) | null; abort: (() => void) | null } =
    { callback: null, abort: null };
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  const subscription: ReturnType<typeof Linking.addEventListener> =
    Linking.addEventListener("url", (event: { url: string }): void => {
      try {
        parsePasskeyCallback(event.url, request);
        captured = event.url;
        wakeups.callback?.();
      } catch {
        // Other deep links and callbacks from an older attempt cannot finish this one.
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
            request.url,
            PASSKEY_CALLBACK_URL,
          );

        if (signal.aborted) {
          return { status: "cancelled" };
        }
        if (result.type === "success" && result.url) {
          // Parsing is repeated by the exchange flow before any network call.
          parsePasskeyCallback(result.url, request);
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
        throw new Error(
          "Could not open or complete passkey sign-in. Please try again.",
        );
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
