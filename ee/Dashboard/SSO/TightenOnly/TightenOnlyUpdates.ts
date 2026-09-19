import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";

/*
 * The two updates the identity screens may send while the Enterprise license
 * makes configuration read-only (EnterpriseLicenseMode.ReadOnly).
 *
 * The server lets exactly these through without a license, because they can
 * only tighten security (TIGHTEN_ONLY_UPDATES in
 * packages/Common/Server/Types/Database/Permissions/EditionPermission.ts):
 *
 *   { isEnabled: false }   switch an SSO / OIDC provider off, or a global
 *                          provider's attachment to a project;
 *   { bearerToken: "..." } replace a SCIM bearer token with a new one of at
 *                          least MIN_SCIM_BEARER_TOKEN_LENGTH characters.
 *
 * One more column in the same update makes it an ordinary update, which the
 * server refuses with 402 - so the payloads are built here, in one place, and
 * never by a form. ee/Tests/Server/Identity/TightenOnlyUiContract.test.ts
 * checks them against the server's rules, so the two cannot drift.
 *
 * Imports Common/Types only: both frontends bundle it, and the server-side
 * contract test imports it too.
 */

/*
 * The server's MIN_ROTATED_SCIM_BEARER_TOKEN_LENGTH. The browser cannot import
 * server code, so the value is repeated here; the contract test fails if the
 * two differ.
 */
export const MIN_SCIM_BEARER_TOKEN_LENGTH: number = 32;

/*
 * Random bytes in a new SCIM bearer token. 32 bytes (256 bits), written as 64
 * hexadecimal characters: twice the length the server asks for, and more
 * entropy than the UUID (122 random bits) the screens used to generate.
 */
export const SCIM_BEARER_TOKEN_BYTES: number = 32;

export const SCIM_BEARER_TOKEN_UNAVAILABLE_MESSAGE: string =
  "This browser cannot generate a secure bearer token. Please use a current browser and try again.";

// The part of the Web Crypto API a token needs (injectable for tests).
export interface RandomValuesSource {
  getRandomValues: (array: Uint8Array) => Uint8Array;
}

// The update that switches an identity provider (or an attachment) off.
export const buildDisableProviderUpdate: () => JSONObject = (): JSONObject => {
  return { isEnabled: false };
};

/*
 * A new SCIM bearer token from the browser's cryptographically secure random
 * number generator. crypto.getRandomValues() needs no secure context, so it
 * also works on a dashboard served over plain HTTP (crypto.randomUUID() does
 * not). There is deliberately no fallback: without Web Crypto this throws
 * rather than make a guessable secret (Common's UUID.generate() falls back to
 * Math.random, which is why it is not used here).
 */
export const generateScimBearerToken: (
  randomSource?: RandomValuesSource | undefined,
) => string = (randomSource?: RandomValuesSource | undefined): string => {
  const source: RandomValuesSource | undefined =
    randomSource || (globalThis.crypto as RandomValuesSource | undefined);

  if (!source || typeof source.getRandomValues !== "function") {
    throw new BadDataException(SCIM_BEARER_TOKEN_UNAVAILABLE_MESSAGE);
  }

  const bytes: Uint8Array = new Uint8Array(SCIM_BEARER_TOKEN_BYTES);

  source.getRandomValues(bytes);

  return Array.from(bytes, (byte: number): string => {
    return byte.toString(16).padStart(2, "0");
  }).join("");
};

/*
 * The update that replaces a SCIM bearer token. Refuses a token the server
 * would not treat as a rotation, instead of sending an update that comes back
 * as "license required".
 */
export const buildRotateBearerTokenUpdate: (
  bearerToken: string,
) => JSONObject = (bearerToken: string): JSONObject => {
  if (
    typeof bearerToken !== "string" ||
    bearerToken.trim().length < MIN_SCIM_BEARER_TOKEN_LENGTH
  ) {
    throw new BadDataException(
      `A new bearer token must be at least ${MIN_SCIM_BEARER_TOKEN_LENGTH} characters long.`,
    );
  }

  return { bearerToken: bearerToken };
};
