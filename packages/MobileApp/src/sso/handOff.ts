/*
 * THE SSO SIGN-IN THIS APP STARTED, AND IS WAITING FOR (#9989).
 *
 * Every SSO sign-in ends on the app's deep link, oneuptime://sso-callback.
 * That is a custom scheme: any Android app can say it handles it, and
 * anybody - a web page, another app - can open it. A link that carried the
 * session would hand it to whoever received the link, and a link someone
 * else made could sign this app in to their account.
 *
 * So the app starts every SSO sign-in the way OAuth's PKCE does (RFC 7636,
 * RFC 8252), as its passkey sign-in does (../passkeys/request):
 *
 *   - it makes a random state and a random code verifier, keeps them here,
 *     and sends the server the state and the verifier's SHA-256
 *     (codeChallenge, S256) when it opens the provider's sign-in;
 *   - the server hands the sign-in back as a one-time code and that state,
 *     never a token (App/FeatureSet/Identity/Utils/MobileSso);
 *   - the app takes a deep link only with the state of the sign-in it is
 *     waiting for, and redeems its code with the verifier, which never left
 *     the phone (./session).
 *
 * The verifier is kept in the app's own storage as well as in memory: on
 * Android the OS often stops the app while the person is at their identity
 * provider, and the deep link then starts it afresh (./deepLink). Kept for
 * as long as the server keeps the sign-in's start (fifteen minutes), and
 * for one sign-in: starting another replaces it, and a callback ends it.
 *
 * A server from before #9989 still hands the session back on the link. The
 * app asks the server, when it starts, whether it hands back codes
 * (GET /identity/sign-in-methods); only a server that says it does not -
 * or cannot be asked because it is that old - may end a sign-in this app
 * started with a link that carries the session.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { fetchServerHandsBackSsoCodes } from "../api/sso";

/*
 * Deliberately a literal here and in the tests: the on-disk contract
 * between one build and the next.
 */
export const PENDING_SSO_HAND_OFF_STORAGE_KEY: string =
  "oneuptime_sso_hand_off";

// As long as the server keeps a sign-in's start (MOBILE_SSO_FLOW_TTL_SECONDS).
export const SSO_HAND_OFF_TTL_MS: number = 15 * 60 * 1000;

export interface PendingSsoHandOff {
  state: string;
  codeVerifier: string;
  // The server the sign-in started on: the one its code is redeemed at.
  serverUrl: string;
  /*
   * What that server said when the sign-in started: true when it hands
   * sign-ins back as one-time codes, so a link that carries tokens instead
   * is nobody's to take. False only for a server from before #9989.
   */
  serverHandsBackCodes: boolean;
  // Date.now() when it started.
  startedAt: number;
}

// The hand-off a start sends the server, beside ?mobile=true.
export interface SsoHandOffRequest {
  state: string;
  codeChallenge: string;
}

const HEX_VALUE_PATTERN: RegExp = /^[0-9a-f]{64}$/;

let cachedHandOff: PendingSsoHandOff | null = null;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte: number): string => {
    return byte.toString(16).padStart(2, "0");
  }).join("");
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

function isLive(handOff: PendingSsoHandOff): boolean {
  const age: number = Date.now() - handOff.startedAt;

  return age >= 0 && age < SSO_HAND_OFF_TTL_MS;
}

function parseStored(raw: string | null): PendingSsoHandOff | null {
  if (!raw) {
    return null;
  }

  try {
    const value: Record<string, unknown> = JSON.parse(raw) as Record<
      string,
      unknown
    >;

    if (
      typeof value["state"] !== "string" ||
      !HEX_VALUE_PATTERN.test(value["state"]) ||
      typeof value["codeVerifier"] !== "string" ||
      !HEX_VALUE_PATTERN.test(value["codeVerifier"]) ||
      typeof value["serverUrl"] !== "string" ||
      !value["serverUrl"] ||
      typeof value["serverHandsBackCodes"] !== "boolean" ||
      typeof value["startedAt"] !== "number" ||
      !Number.isFinite(value["startedAt"])
    ) {
      return null;
    }

    return {
      state: value["state"],
      codeVerifier: value["codeVerifier"],
      serverUrl: value["serverUrl"],
      serverHandsBackCodes: value["serverHandsBackCodes"],
      startedAt: value["startedAt"],
    };
  } catch {
    return null;
  }
}

/*
 * Starts a sign-in's hand-off: a fresh state and verifier, kept for the
 * callback (replacing any earlier sign-in's), and what the server is sent.
 */
export async function startSsoHandOff(data: {
  serverUrl: string;
  serverHandsBackCodes: boolean;
}): Promise<SsoHandOffRequest> {
  const [verifierBytes, stateBytes]: [Uint8Array, Uint8Array] =
    await Promise.all([
      Crypto.getRandomBytesAsync(32),
      Crypto.getRandomBytesAsync(32),
    ]);
  const codeVerifier: string = hex(verifierBytes);
  const state: string = hex(stateBytes);
  const digest: string = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    codeVerifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const codeChallenge: string = digest
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/, "");

  const handOff: PendingSsoHandOff = {
    state,
    codeVerifier,
    serverUrl: normalizeServerUrl(data.serverUrl),
    serverHandsBackCodes: data.serverHandsBackCodes,
    startedAt: Date.now(),
  };

  cachedHandOff = handOff;

  try {
    await AsyncStorage.setItem(
      PENDING_SSO_HAND_OFF_STORAGE_KEY,
      JSON.stringify(handOff),
    );
  } catch {
    /*
     * Kept in memory all the same: a sign-in the app is still open for
     * completes. Only one the OS stopped the app in the middle of cannot.
     */
  }

  return { state, codeChallenge };
}

/*
 * The URL that starts `ssoUrl`'s sign-in with a hand-off of its own: asks
 * its server whether it hands back codes, starts the hand-off, and adds the
 * state and the challenge to the address. `ssoUrl` is one buildSsoLoginUrl
 * made: <server>/identity/...?mobile=true.
 */
export async function beginSsoHandOff(ssoUrl: string): Promise<string> {
  const identityAt: number = ssoUrl.indexOf("/identity/");

  if (identityAt < 1) {
    throw new Error("Not an SSO sign-in address.");
  }

  const serverUrl: string = ssoUrl.slice(0, identityAt);
  const serverHandsBackCodes: boolean =
    await fetchServerHandsBackSsoCodes(serverUrl);
  const request: SsoHandOffRequest = await startSsoHandOff({
    serverUrl,
    serverHandsBackCodes,
  });

  return `${ssoUrl}${ssoUrl.includes("?") ? "&" : "?"}state=${request.state}&codeChallenge=${request.codeChallenge}&codeChallengeMethod=S256`;
}

/*
 * The sign-in the app is waiting for, from memory - where a sign-in this
 * run of the app started is - without waiting on storage. Null once it has
 * expired.
 */
export function getCachedPendingSsoHandOff(): PendingSsoHandOff | null {
  if (cachedHandOff && !isLive(cachedHandOff)) {
    cachedHandOff = null;
  }

  return cachedHandOff;
}

/*
 * The sign-in the app is waiting for: from memory, or from storage after
 * the OS stopped the app in the middle of it. Null when there is none, or
 * it has expired.
 */
export async function readPendingSsoHandOff(): Promise<PendingSsoHandOff | null> {
  const inMemory: PendingSsoHandOff | null = getCachedPendingSsoHandOff();

  if (inMemory) {
    return inMemory;
  }

  let raw: string | null = null;

  try {
    raw = await AsyncStorage.getItem(PENDING_SSO_HAND_OFF_STORAGE_KEY);
  } catch {
    return getCachedPendingSsoHandOff();
  }

  // A sign-in started while storage was read is the newer one.
  if (getCachedPendingSsoHandOff()) {
    return cachedHandOff;
  }

  const stored: PendingSsoHandOff | null = parseStored(raw);

  if (!stored || !isLive(stored)) {
    if (raw !== null) {
      await clearPendingSsoHandOff();
    }

    return null;
  }

  cachedHandOff = stored;

  return stored;
}

// Ends the sign-in the app was waiting for: its callback came, or failed.
export async function clearPendingSsoHandOff(): Promise<void> {
  cachedHandOff = null;

  try {
    await AsyncStorage.removeItem(PENDING_SSO_HAND_OFF_STORAGE_KEY);
  } catch {
    // Expires on its own, and is no use to anybody without the server's code.
  }
}

// Test-only: forgets the in-memory copy, as a cold start does.
export function forgetCachedSsoHandOffForTesting(): void {
  cachedHandOff = null;
}
