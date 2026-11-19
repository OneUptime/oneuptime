import * as Crypto from "expo-crypto";
import { decodeBase64Url } from "../utils/jwt";
import { passkeyServerOrigin } from "./request";

/*
 * SETTING UP A PASSKEY WHEN SIGN-IN REQUIRES A SECOND STEP (issue #9817).
 *
 * An administrator can require two-factor authentication of an account
 * with nothing set up behind it; signing in then asks for a second step to
 * be set up before the session exists. The web page offers an authenticator
 * app or a security key. This app has no WebAuthn of its own - a native
 * passkey needs the app associated with the server's domain, and a
 * self-hosted server's domain is nobody's to associate with an app in the
 * stores - so it sets up a passkey the way it signs in with one: in the
 * phone's own browser, on the server's address.
 *
 *   1. The app asks the server for the passkey's options with the email and
 *      password it holds (POST /identity/security-key-enrolment-options with
 *      `mobileHandOff`), as the web page does; the server checks everything
 *      /login checks and answers only a one-time id for the options.
 *   2. The app opens /accounts/mobile-passkey-enrolment with that id and a
 *      random `state` of its own in the address's fragment. The page reads
 *      the options with the id, runs the phone's prompt - its face,
 *      fingerprint or screen lock, or a security key - and hands the new
 *      passkey's public answer back on oneuptime://passkey-enrolment, with
 *      the same `state`.
 *   3. The app sends that answer to POST /identity/verify-security-key-
 *      enrolment with the email and password again - the very request the
 *      web makes. Only that saves the passkey, for the account the password
 *      proves, and signs in, with the backup codes shown once.
 *
 * Nothing that crosses the browser is a credential: the id reads options
 * once, and the passkey's answer is a public key and a signature over a
 * challenge, worthless without the password. The password never leaves
 * this app.
 *
 * Offered only where it can work: a server that says it offers it (one on
 * HTTPS, with this release), reached over HTTPS, on a phone whose browser
 * makes passkeys (iOS 16, Android 9 and later). Anywhere else the
 * authenticator app is the only choice, as before; and a browser that turns
 * out not to make one hands back "unsupported", and the app goes on with
 * the authenticator app.
 */

export const PASSKEY_ENROLMENT_CALLBACK_URL: string =
  "oneuptime://passkey-enrolment";

export const PASSKEY_ENROLMENT_PAGE_PATH: string =
  "/accounts/mobile-passkey-enrolment";

// The first versions whose own browser makes passkeys from a web page.
export const MINIMUM_IOS_MAJOR_FOR_PASSKEYS: number = 16;
export const MINIMUM_ANDROID_API_FOR_PASSKEYS: number = 28;

const HAND_OFF_ID_PATTERN: RegExp = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_PATTERN: RegExp = /^[A-Za-z0-9_-]+$/;

// A callback larger than any passkey's answer: anything bigger is not one.
const MAX_CREDENTIAL_LENGTH: number = 16384;

const NOT_VERIFIED_MESSAGE: string =
  "This passkey setup could not be verified. Please try again.";

export interface PasskeyEnrolmentRequest {
  serverOrigin: string;
  state: string;
  url: string;
}

// What the browser page handed back.
export type PasskeyEnrolmentCallback =
  | { status: "success"; credential: Record<string, unknown> }
  | { status: "cancelled" }
  | { status: "unsupported" };

export interface PlatformInfo {
  os: string;
  version: string | number;
}

/*
 * Whether this phone's own browser makes passkeys from a web page: iOS 16
 * and later (passkeys in its authentication session), Android 9 and later
 * (passkeys through Google Play services). Nothing else is offered one.
 */
export function canPhoneMakePasskeys(platform: PlatformInfo): boolean {
  if (platform.os === "ios") {
    const major: number = parseInt(String(platform.version), 10);
    return Number.isFinite(major) && major >= MINIMUM_IOS_MAJOR_FOR_PASSKEYS;
  }

  if (platform.os === "android") {
    const api: number = Number(platform.version);
    return Number.isFinite(api) && api >= MINIMUM_ANDROID_API_FOR_PASSKEYS;
  }

  return false;
}

/*
 * Whether to offer a passkey beside the authenticator app: the server said
 * it offers one, it is reached over HTTPS, and this phone makes passkeys.
 */
export function isPasskeyEnrolmentAvailable(data: {
  isOfferedByServer: boolean;
  serverUrl: string;
  platform: PlatformInfo;
}): boolean {
  if (!data.isOfferedByServer || !canPhoneMakePasskeys(data.platform)) {
    return false;
  }

  try {
    passkeyServerOrigin(data.serverUrl);
    return true;
  } catch {
    return false;
  }
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte: number): string => {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

/*
 * The page to open for a hand-off the server answered: on the server's own
 * address, the id and this attempt's state in the fragment, which no server
 * is sent.
 */
export async function createPasskeyEnrolmentRequest(
  serverUrl: string,
  handOffId: string,
): Promise<PasskeyEnrolmentRequest> {
  const serverOrigin: string = passkeyServerOrigin(serverUrl);

  if (HAND_OFF_ID_PATTERN.exec(handOffId)?.[0] !== handOffId) {
    throw new Error(
      "The server did not start the passkey setup. Please try again.",
    );
  }

  const state: string = hex(await Crypto.getRandomBytesAsync(32));

  return {
    serverOrigin,
    state,
    url: `${serverOrigin}${PASSKEY_ENROLMENT_PAGE_PATH}#handOff=${handOffId}&state=${state}`,
  };
}

// Whether a decoded answer is shaped like a new passkey's, and nothing more.
function readCredential(json: string): Record<string, unknown> | null {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const credential: Record<string, unknown> = value as Record<string, unknown>;
  const response: unknown = credential["response"];

  if (
    typeof credential["id"] !== "string" ||
    !BASE64URL_PATTERN.test(credential["id"]) ||
    typeof credential["rawId"] !== "string" ||
    credential["rawId"] !== credential["id"] ||
    credential["type"] !== "public-key" ||
    !response ||
    typeof response !== "object" ||
    Array.isArray(response)
  ) {
    return null;
  }

  const attestation: Record<string, unknown> = response as Record<
    string,
    unknown
  >;

  if (
    typeof attestation["attestationObject"] !== "string" ||
    !BASE64URL_PATTERN.test(attestation["attestationObject"]) ||
    typeof attestation["clientDataJSON"] !== "string" ||
    !BASE64URL_PATTERN.test(attestation["clientDataJSON"])
  ) {
    return null;
  }

  return credential;
}

/*
 * The page's answer, bound strictly to the attempt that opened it: this
 * app's scheme and host, its own keys each once, this attempt's state and
 * the server it was started on. Anything else - another attempt's, a forged
 * link - is refused before anything is sent anywhere.
 */
export function parsePasskeyEnrolmentCallback(
  url: string,
  request: PasskeyEnrolmentRequest,
): PasskeyEnrolmentCallback {
  const match: RegExpMatchArray | null = url.match(
    /^oneuptime:\/\/passkey-enrolment\/?\?([^#]+)$/,
  );

  if (!match || match[0] !== url || url.trim() !== url) {
    throw new Error(NOT_VERIFIED_MESSAGE);
  }

  const params: Map<string, string> = new Map<string, string>();

  try {
    for (const pair of match[1]!.split("&")) {
      const separator: number = pair.indexOf("=");
      if (separator < 1) {
        throw new Error("Invalid callback");
      }
      const key: string = decodeURIComponent(pair.slice(0, separator));
      const value: string = decodeURIComponent(pair.slice(separator + 1));
      if (
        params.has(key) ||
        !["credential", "state", "serverOrigin", "error"].includes(key)
      ) {
        throw new Error("Invalid callback");
      }
      params.set(key, value);
    }

    if (
      params.get("state") !== request.state ||
      params.get("serverOrigin") !== request.serverOrigin
    ) {
      throw new Error("Invalid callback");
    }

    const error: string | undefined = params.get("error");

    if (error !== undefined) {
      if (params.has("credential")) {
        throw new Error("Invalid callback");
      }
      if (error === "access_denied") {
        return { status: "cancelled" };
      }
      if (error === "unsupported") {
        return { status: "unsupported" };
      }
      throw new Error("Invalid callback");
    }

    const encoded: string = params.get("credential") || "";

    if (
      !encoded ||
      encoded.length > MAX_CREDENTIAL_LENGTH ||
      !BASE64URL_PATTERN.test(encoded)
    ) {
      throw new Error("Invalid callback");
    }

    const json: string | null = decodeBase64Url(encoded);
    const credential: Record<string, unknown> | null = json
      ? readCredential(json)
      : null;

    if (!credential) {
      throw new Error("Invalid callback");
    }

    return { status: "success", credential };
  } catch {
    throw new Error(NOT_VERIFIED_MESSAGE);
  }
}

// Whether a link is this attempt's callback: never throws.
export function isPasskeyEnrolmentCallbackFor(
  url: string,
  request: PasskeyEnrolmentRequest,
): boolean {
  try {
    parsePasskeyEnrolmentCallback(url, request);
    return true;
  } catch {
    return false;
  }
}
