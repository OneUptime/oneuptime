import { MOBILE_PASSKEY_ENROLMENT_CALLBACK_URL } from "Common/Types/Accounts/SecondStepEnrolment";
import { JSONObject } from "Common/Types/JSON";

/*
 * THE PAGE THE MOBILE APP OPENS TO SET UP A PASSKEY (#9817,
 * Common/Server/Services/MobilePasskeyEnrolmentService says how and why).
 *
 * The app opens /accounts/mobile-passkey-enrolment in the phone's browser
 * with two values in the address's fragment - never sent to a server, so in
 * no log: the hand-off's id, which reads the passkey's options once, and the
 * app's own random `state`, which the page hands back so the app knows the
 * answer is for the setup it started. The page runs the phone's prompt and
 * hands the passkey's answer back on oneuptime://passkey-enrolment - its
 * public key and signed challenge, which only the password the app holds
 * makes into a saved key - or says it was canceled, or that this browser
 * cannot create one. Nothing it hands back signs anybody in.
 */

export interface MobilePasskeyEnrolmentRequest {
  handOffId: string;
  state: string;
}

// Why the page hands back no passkey.
export type MobilePasskeyEnrolmentEnd = "access_denied" | "unsupported";

const HAND_OFF_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;
const STATE_PATTERN: RegExp = /^[A-Za-z0-9._~-]{43,128}$/;

const KEYS: ReadonlyArray<string> = ["handOff", "state"];

export default class MobilePasskeyEnrolment {
  /*
   * The request in the page's fragment ("#handOff=...&state=..."): exactly
   * those two, once each, well formed - or null, and the page asks to start
   * again from the app.
   */
  public static getRequest(hash: string): MobilePasskeyEnrolmentRequest | null {
    const params: URLSearchParams = new URLSearchParams(
      hash.startsWith("#") ? hash.slice(1) : hash,
    );

    if (
      KEYS.some((key: string): boolean => {
        return params.getAll(key).length !== 1;
      }) ||
      Array.from(params.keys()).some((key: string): boolean => {
        return !KEYS.includes(key);
      })
    ) {
      return null;
    }

    const handOffId: string = params.get("handOff") || "";
    const state: string = params.get("state") || "";

    if (
      HAND_OFF_ID_PATTERN.exec(handOffId)?.[0] !== handOffId ||
      STATE_PATTERN.exec(state)?.[0] !== state
    ) {
      return null;
    }

    return { handOffId, state };
  }

  // The passkey's answer, as the app reads it back: JSON, in base64url.
  public static encodeCredential(credential: JSONObject): string {
    const bytes: Uint8Array = new TextEncoder().encode(
      JSON.stringify(credential),
    );
    let binary: string = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/[=]+$/g, "");
  }

  // Back to the app with the passkey's answer.
  public static successCallback(
    request: MobilePasskeyEnrolmentRequest,
    serverOrigin: string,
    credential: JSONObject,
  ): string {
    const url: URL = new URL(MOBILE_PASSKEY_ENROLMENT_CALLBACK_URL);
    url.searchParams.set("state", request.state);
    url.searchParams.set("serverOrigin", serverOrigin);
    url.searchParams.set(
      "credential",
      MobilePasskeyEnrolment.encodeCredential(credential),
    );
    return url.toString();
  }

  // Back to the app with no passkey: canceled, or none can be made here.
  public static endCallback(
    request: MobilePasskeyEnrolmentRequest,
    serverOrigin: string,
    end: MobilePasskeyEnrolmentEnd,
  ): string {
    const url: URL = new URL(MOBILE_PASSKEY_ENROLMENT_CALLBACK_URL);
    url.searchParams.set("error", end);
    url.searchParams.set("state", request.state);
    url.searchParams.set("serverOrigin", serverOrigin);
    return url.toString();
  }

  public static returnToApp(callbackUrl: string): void {
    window.location.assign(callbackUrl);
  }

  /*
   * Takes the hand-off out of the address once it is read: it works once,
   * and an address bar has no business showing it.
   */
  public static forgetFragment(): void {
    try {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    } catch {
      // A browser that refuses still has an id that worked once and is gone.
    }
  }
}
